/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import type {
  PermissionsSnapshot,
  PermissionsSnapshotRecorderOptions,
  SnapshotComparisonResult,
  RoleAssumption,
} from './types';
import type { PermissionsCollector } from './sdk-interceptor';
import { getGlobalCollector, resetGlobalCollector } from './sdk-interceptor';

/**
 * Default snapshot file extension.
 */
const SNAPSHOT_EXTENSION = '.permissions.snap';

/**
 * Generates the snapshot file path for a given test name.
 */
function getSnapshotFilePath(testName: string, directory: string): string {
  // Sanitize test name for use as a file name
  const sanitizedName = testName.replace(/[^a-zA-Z0-9-_]/g, '-');
  return path.join(directory, `${sanitizedName}${SNAPSHOT_EXTENSION}`);
}

/**
 * Compares two arrays of role assumptions.
 * Role assumptions are considered equal if they have the same roleArn (ignoring timestamp).
 */
function compareRoleAssumptions(
  current: RoleAssumption[],
  expected: RoleAssumption[],
): { added: RoleAssumption[]; removed: RoleAssumption[] } {
  const currentRoles = new Set(current.map(r => r.roleArn));
  const expectedRoles = new Set(expected.map(r => r.roleArn));

  const added = current.filter(r => !expectedRoles.has(r.roleArn));
  const removed = expected.filter(r => !currentRoles.has(r.roleArn));

  return { added, removed };
}

/**
 * Compares two snapshots and returns the differences.
 */
export function compareSnapshots(
  current: PermissionsSnapshot,
  expected: PermissionsSnapshot,
): SnapshotComparisonResult {
  const currentPermissions = new Set(current.permissions);
  const expectedPermissions = new Set(expected.permissions);

  const addedActions = current.permissions.filter(p => !expectedPermissions.has(p));
  const removedActions = expected.permissions.filter(p => !currentPermissions.has(p));

  const roleComparison = compareRoleAssumptions(
    current.roleAssumptions,
    expected.roleAssumptions,
  );

  const match =
    addedActions.length === 0 &&
    removedActions.length === 0 &&
    roleComparison.added.length === 0 &&
    roleComparison.removed.length === 0;

  return {
    match,
    addedActions,
    removedActions,
    addedRoleAssumptions: roleComparison.added,
    removedRoleAssumptions: roleComparison.removed,
  };
}

/**
 * Formats a snapshot comparison result as a human-readable string.
 */
export function formatComparisonResult(result: SnapshotComparisonResult): string {
  if (result.match) {
    return 'Permissions snapshot matches.';
  }

  const lines: string[] = ['Permissions snapshot does not match:'];

  if (result.addedActions.length > 0) {
    lines.push('');
    lines.push('Added IAM actions:');
    result.addedActions.forEach(action => lines.push(`  + ${action}`));
  }

  if (result.removedActions.length > 0) {
    lines.push('');
    lines.push('Removed IAM actions:');
    result.removedActions.forEach(action => lines.push(`  - ${action}`));
  }

  if (result.addedRoleAssumptions.length > 0) {
    lines.push('');
    lines.push('Added role assumptions:');
    result.addedRoleAssumptions.forEach(role =>
      lines.push(`  + ${role.roleArn} (session: ${role.sessionName})`),
    );
  }

  if (result.removedRoleAssumptions.length > 0) {
    lines.push('');
    lines.push('Removed role assumptions:');
    result.removedRoleAssumptions.forEach(role =>
      lines.push(`  - ${role.roleArn} (session: ${role.sessionName})`),
    );
  }

  return lines.join('\n');
}

/**
 * Manages recording and comparing permissions snapshots for integration tests.
 */
export class PermissionsSnapshotRecorder {
  private readonly options: Required<PermissionsSnapshotRecorderOptions>;
  private readonly collector: PermissionsCollector;

  constructor(options: PermissionsSnapshotRecorderOptions) {
    this.options = {
      testName: options.testName,
      snapshotDirectory: options.snapshotDirectory || process.cwd(),
      failOnMismatch: options.failOnMismatch ?? true,
      updateSnapshots: options.updateSnapshots ?? false,
    };
    this.collector = getGlobalCollector();
  }

  /**
   * Starts recording permissions for a test.
   * This clears any previously recorded permissions.
   */
  public startRecording(): void {
    resetGlobalCollector();
    console.log(`[Permissions Snapshot] Started recording for test: ${this.options.testName}`);
  }

  /**
   * Stops recording and creates a snapshot from the collected data.
   */
  public stopRecording(): PermissionsSnapshot {
    const snapshot: PermissionsSnapshot = {
      testName: this.options.testName,
      createdAt: new Date().toISOString(),
      actions: this.collector.getActions(),
      roleAssumptions: this.collector.getRoleAssumptions(),
      permissions: this.collector.getPermissions(),
    };

    console.log(
      `[Permissions Snapshot] Stopped recording. Captured ${snapshot.permissions.length} unique permissions.`,
    );

    return snapshot;
  }

  /**
   * Gets the path to the snapshot file.
   */
  public getSnapshotPath(): string {
    return getSnapshotFilePath(this.options.testName, this.options.snapshotDirectory);
  }

  /**
   * Loads an existing snapshot from disk.
   * @returns The loaded snapshot, or undefined if no snapshot exists.
   */
  public loadSnapshot(): PermissionsSnapshot | undefined {
    const snapshotPath = this.getSnapshotPath();

    if (!fs.existsSync(snapshotPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(snapshotPath, 'utf-8');
      return JSON.parse(content) as PermissionsSnapshot;
    } catch (error) {
      console.warn(`[Permissions Snapshot] Failed to load snapshot: ${error}`);
      return undefined;
    }
  }

  /**
   * Saves a snapshot to disk.
   */
  public saveSnapshot(snapshot: PermissionsSnapshot): void {
    const snapshotPath = this.getSnapshotPath();

    // Ensure directory exists
    const dir = path.dirname(snapshotPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write snapshot with pretty formatting
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');

    console.log(`[Permissions Snapshot] Saved snapshot to: ${snapshotPath}`);
  }

  /**
   * Validates the current recording against an existing snapshot.
   *
   * @returns The comparison result.
   * @throws If failOnMismatch is true and the snapshot doesn't match.
   */
  public validate(): SnapshotComparisonResult {
    const currentSnapshot = this.stopRecording();
    const existingSnapshot = this.loadSnapshot();

    if (!existingSnapshot) {
      console.log('[Permissions Snapshot] No existing snapshot found. Creating new snapshot.');
      this.saveSnapshot(currentSnapshot);
      return {
        match: true,
        addedActions: [],
        removedActions: [],
        addedRoleAssumptions: [],
        removedRoleAssumptions: [],
      };
    }

    const result = compareSnapshots(currentSnapshot, existingSnapshot);

    if (!result.match) {
      const message = formatComparisonResult(result);
      console.log(message);

      if (this.options.updateSnapshots) {
        console.log('[Permissions Snapshot] Updating snapshot due to updateSnapshots option.');
        this.saveSnapshot(currentSnapshot);
      } else if (this.options.failOnMismatch) {
        throw new PermissionsSnapshotError(message, result, currentSnapshot, existingSnapshot);
      }
    } else {
      console.log('[Permissions Snapshot] Snapshot matches.');
    }

    return result;
  }

  /**
   * Generates a permissions document from all recorded snapshots in a directory.
   * This can be used to create public documentation about required permissions.
   */
  public static generatePermissionsDocument(snapshotDirectory: string): PermissionsDocument {
    const files = fs.readdirSync(snapshotDirectory).filter(f => f.endsWith(SNAPSHOT_EXTENSION));

    const allPermissions = new Set<string>();
    const allRoles = new Set<string>();
    const testPermissions: Record<string, string[]> = {};

    for (const file of files) {
      const filePath = path.join(snapshotDirectory, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const snapshot = JSON.parse(content) as PermissionsSnapshot;

      testPermissions[snapshot.testName] = snapshot.permissions;

      for (const permission of snapshot.permissions) {
        allPermissions.add(permission);
      }

      for (const role of snapshot.roleAssumptions) {
        allRoles.add(role.roleArn);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      totalTests: files.length,
      uniquePermissions: Array.from(allPermissions).sort(),
      uniqueRoles: Array.from(allRoles).sort(),
      permissionsByTest: testPermissions,
    };
  }
}

/**
 * A document summarizing all permissions across multiple tests.
 */
export interface PermissionsDocument {
  /**
   * When this document was generated.
   */
  readonly generatedAt: string;

  /**
   * Total number of tests included.
   */
  readonly totalTests: number;

  /**
   * All unique permissions across all tests.
   */
  readonly uniquePermissions: string[];

  /**
   * All unique roles assumed across all tests.
   */
  readonly uniqueRoles: string[];

  /**
   * Permissions grouped by test name.
   */
  readonly permissionsByTest: Record<string, string[]>;
}

/**
 * Error thrown when a permissions snapshot doesn't match.
 */
export class PermissionsSnapshotError extends Error {
  constructor(
    message: string,
    public readonly comparisonResult: SnapshotComparisonResult,
    public readonly currentSnapshot: PermissionsSnapshot,
    public readonly expectedSnapshot: PermissionsSnapshot,
  ) {
    super(message);
    this.name = 'PermissionsSnapshotError';
  }
}
