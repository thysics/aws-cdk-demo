/**
 * Permissions Snapshot Recorder and Comparator
 *
 * This module provides functionality to record, save, load, and compare
 * IAM permissions snapshots for CLI integration tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PermissionsSnapshot,
  PermissionsSnapshotRecorderOptions,
  SnapshotComparisonResult,
  SnapshotComparisonOptions,
  IamAction,
  AssumedRole,
} from './types';
import { SdkInterceptorManager } from './sdk-interceptor';

/**
 * Current version of the snapshot format
 */
export const SNAPSHOT_FORMAT_VERSION = '1.0.0';

/**
 * Default snapshot file extension
 */
export const SNAPSHOT_EXTENSION = '.permissions.snap.json';

/**
 * Records and manages IAM permissions snapshots for integration tests
 *
 * @example
 * ```typescript
 * const recorder = new PermissionsSnapshotRecorder({
 *   testName: 'my-integration-test',
 * });
 *
 * // Start recording
 * recorder.start();
 *
 * // ... run your test ...
 *
 * // Stop and save
 * const snapshot = recorder.stop();
 * await recorder.save();
 *
 * // Or compare with existing snapshot
 * const result = await recorder.compareWithBaseline();
 * if (!result.match) {
 *   throw new Error(`Permissions snapshot changed:\n${result.summary}`);
 * }
 * ```
 */
export class PermissionsSnapshotRecorder {
  private readonly testName: string;
  private readonly snapshotDirectory: string;
  private readonly options: PermissionsSnapshotRecorderOptions;
  private readonly interceptorManager: SdkInterceptorManager;
  private isRecording: boolean = false;
  private currentSnapshot: PermissionsSnapshot | null = null;

  constructor(options: PermissionsSnapshotRecorderOptions) {
    this.testName = options.testName;
    this.snapshotDirectory = options.snapshotDirectory ?? path.join(process.cwd(), '.permissions-snapshots');
    this.options = options;

    // Create the interceptor manager with the provided options
    this.interceptorManager = new SdkInterceptorManager({
      excludeServices: options.excludeServices,
      excludeActions: options.excludeActions,
      captureResources: options.captureResources,
    });
  }

  /**
   * Get the SDK interceptor plugin to apply to AWS SDK clients
   *
   * This plugin must be applied to all SDK clients that should be tracked.
   *
   * @example
   * ```typescript
   * const recorder = new PermissionsSnapshotRecorder({ testName: 'test' });
   * const s3Client = new S3Client({});
   * s3Client.middlewareStack.use(recorder.getInterceptorPlugin());
   * ```
   */
  public getInterceptorPlugin() {
    return this.interceptorManager.getPlugin();
  }

  /**
   * Start recording IAM actions
   */
  public start(): void {
    if (this.isRecording) {
      throw new Error('Recording is already in progress');
    }
    this.isRecording = true;
    this.interceptorManager.clear();
    this.currentSnapshot = null;
  }

  /**
   * Stop recording and create the snapshot
   */
  public stop(): PermissionsSnapshot {
    if (!this.isRecording) {
      throw new Error('Recording is not in progress');
    }
    this.isRecording = false;

    this.currentSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: this.testName,
      createdAt: new Date().toISOString(),
      actions: this.interceptorManager.getUniqueActions(),
      assumedRoles: this.interceptorManager.getUniqueAssumedRoles(),
    };

    return this.currentSnapshot;
  }

  /**
   * Get the current snapshot (must call stop() first)
   */
  public getSnapshot(): PermissionsSnapshot {
    if (!this.currentSnapshot) {
      throw new Error('No snapshot available. Call stop() first.');
    }
    return this.currentSnapshot;
  }

  /**
   * Get the path where the snapshot will be saved
   */
  public getSnapshotPath(): string {
    const sanitizedName = this.testName.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.snapshotDirectory, `${sanitizedName}${SNAPSHOT_EXTENSION}`);
  }

  /**
   * Save the current snapshot to disk
   */
  public async save(): Promise<void> {
    if (!this.currentSnapshot) {
      throw new Error('No snapshot to save. Call stop() first.');
    }

    const snapshotPath = this.getSnapshotPath();
    const snapshotDir = path.dirname(snapshotPath);

    // Ensure directory exists
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    // Write snapshot
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(this.currentSnapshot, null, 2) + '\n',
      'utf-8',
    );
  }

  /**
   * Load the baseline snapshot from disk
   */
  public async loadBaseline(): Promise<PermissionsSnapshot | null> {
    const snapshotPath = this.getSnapshotPath();

    if (!fs.existsSync(snapshotPath)) {
      return null;
    }

    const content = fs.readFileSync(snapshotPath, 'utf-8');
    return JSON.parse(content) as PermissionsSnapshot;
  }

  /**
   * Compare the current snapshot with the baseline
   */
  public async compareWithBaseline(options?: SnapshotComparisonOptions): Promise<SnapshotComparisonResult> {
    if (!this.currentSnapshot) {
      throw new Error('No snapshot to compare. Call stop() first.');
    }

    const baseline = await this.loadBaseline();
    if (!baseline) {
      return {
        match: false,
        addedActions: this.currentSnapshot.actions,
        removedActions: [],
        addedRoles: this.currentSnapshot.assumedRoles,
        removedRoles: [],
        summary: 'No baseline snapshot found. This is a new snapshot.',
      };
    }

    return compareSnapshots(baseline, this.currentSnapshot, options);
  }

  /**
   * Check if a baseline snapshot exists
   */
  public hasBaseline(): boolean {
    return fs.existsSync(this.getSnapshotPath());
  }
}

/**
 * Compare two snapshots and return the differences
 */
export function compareSnapshots(
  baseline: PermissionsSnapshot,
  current: PermissionsSnapshot,
  options: SnapshotComparisonOptions = {},
): SnapshotComparisonResult {
  const ignoreResources = options.ignoreResources ?? true;

  // Compare actions
  const baselineActionKeys = new Set(
    baseline.actions.map(a => actionToKey(a, ignoreResources)),
  );
  const currentActionKeys = new Set(
    current.actions.map(a => actionToKey(a, ignoreResources)),
  );

  const addedActions = current.actions.filter(
    a => !baselineActionKeys.has(actionToKey(a, ignoreResources)),
  );
  const removedActions = baseline.actions.filter(
    a => !currentActionKeys.has(actionToKey(a, ignoreResources)),
  );

  // Compare roles
  const baselineRoleKeys = new Set(baseline.assumedRoles.map(r => r.roleArn));
  const currentRoleKeys = new Set(current.assumedRoles.map(r => r.roleArn));

  const addedRoles = current.assumedRoles.filter(r => !baselineRoleKeys.has(r.roleArn));
  const removedRoles = baseline.assumedRoles.filter(r => !currentRoleKeys.has(r.roleArn));

  // Build summary
  const summaryParts: string[] = [];

  if (addedActions.length > 0) {
    summaryParts.push(`Added actions:\n${addedActions.map(a => `  + ${a.service}:${a.action}`).join('\n')}`);
  }

  if (removedActions.length > 0) {
    summaryParts.push(`Removed actions:\n${removedActions.map(a => `  - ${a.service}:${a.action}`).join('\n')}`);
  }

  if (addedRoles.length > 0) {
    summaryParts.push(`Added roles:\n${addedRoles.map(r => `  + ${r.roleArn}`).join('\n')}`);
  }

  if (removedRoles.length > 0) {
    summaryParts.push(`Removed roles:\n${removedRoles.map(r => `  - ${r.roleArn}`).join('\n')}`);
  }

  const match = addedActions.length === 0 &&
    removedActions.length === 0 &&
    addedRoles.length === 0 &&
    removedRoles.length === 0;

  return {
    match,
    addedActions,
    removedActions,
    addedRoles,
    removedRoles,
    summary: match ? 'Snapshots match' : summaryParts.join('\n\n'),
  };
}

/**
 * Convert an action to a unique key for comparison
 */
function actionToKey(action: IamAction, ignoreResources: boolean): string {
  if (ignoreResources || !action.resources) {
    return `${action.service}:${action.action}`;
  }
  return `${action.service}:${action.action}:${action.resources.sort().join(',')}`;
}

/**
 * Load a snapshot from a file path
 */
export function loadSnapshot(snapshotPath: string): PermissionsSnapshot {
  const content = fs.readFileSync(snapshotPath, 'utf-8');
  return JSON.parse(content) as PermissionsSnapshot;
}

/**
 * Save a snapshot to a file path
 */
export function saveSnapshot(snapshot: PermissionsSnapshot, snapshotPath: string): void {
  const snapshotDir = path.dirname(snapshotPath);

  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(snapshot, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Create a snapshot from arrays of actions and roles
 */
export function createSnapshot(
  testName: string,
  actions: IamAction[],
  assumedRoles: AssumedRole[],
): PermissionsSnapshot {
  // Deduplicate and sort actions
  const uniqueActions = deduplicateActions(actions);
  const uniqueRoles = deduplicateRoles(assumedRoles);

  return {
    version: SNAPSHOT_FORMAT_VERSION,
    testName,
    createdAt: new Date().toISOString(),
    actions: uniqueActions,
    assumedRoles: uniqueRoles,
  };
}

/**
 * Deduplicate and sort actions
 */
function deduplicateActions(actions: IamAction[]): IamAction[] {
  const seen = new Set<string>();
  const unique: IamAction[] = [];

  for (const action of actions) {
    const key = `${action.service}:${action.action}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        service: action.service,
        action: action.action,
      });
    }
  }

  return unique.sort((a, b) => {
    const aKey = `${a.service}:${a.action}`;
    const bKey = `${b.service}:${b.action}`;
    return aKey.localeCompare(bKey);
  });
}

/**
 * Deduplicate and sort roles
 */
function deduplicateRoles(roles: AssumedRole[]): AssumedRole[] {
  const seen = new Set<string>();
  const unique: AssumedRole[] = [];

  for (const role of roles) {
    if (!seen.has(role.roleArn)) {
      seen.add(role.roleArn);
      unique.push({
        roleArn: role.roleArn,
        sessionName: role.sessionName,
      });
    }
  }

  return unique.sort((a, b) => a.roleArn.localeCompare(b.roleArn));
}

/**
 * Format a snapshot as a human-readable string
 */
export function formatSnapshot(snapshot: PermissionsSnapshot): string {
  const lines: string[] = [
    `Permissions Snapshot: ${snapshot.testName}`,
    `Version: ${snapshot.version}`,
    `Created: ${snapshot.createdAt}`,
    '',
    'IAM Actions:',
  ];

  if (snapshot.actions.length === 0) {
    lines.push('  (none)');
  } else {
    for (const action of snapshot.actions) {
      lines.push(`  - ${action.service}:${action.action}`);
    }
  }

  lines.push('');
  lines.push('Assumed Roles:');

  if (snapshot.assumedRoles.length === 0) {
    lines.push('  (none)');
  } else {
    for (const role of snapshot.assumedRoles) {
      lines.push(`  - ${role.roleArn}`);
    }
  }

  return lines.join('\n');
}
