/**
 * Permissions Snapshot Management
 *
 * Handles saving, loading, and comparing permissions snapshots.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PermissionsSnapshot,
  SnapshotComparisonResult,
  RoleAssumption,
  AggregatedAction,
} from './types';
import { SNAPSHOT_VERSION } from './tracker';

/**
 * Default file extension for snapshot files
 */
export const SNAPSHOT_EXTENSION = '.permissions-snapshot.json';

/**
 * Options for saving a snapshot
 */
export interface SaveSnapshotOptions {
  /**
   * Directory where the snapshot should be saved
   */
  readonly directory: string;

  /**
   * Base name for the snapshot file (test name will be appended)
   *
   * @default - use the test name from the snapshot
   */
  readonly baseName?: string;

  /**
   * Whether to pretty-print the JSON
   *
   * @default true
   */
  readonly prettyPrint?: boolean;
}

/**
 * Options for loading a snapshot
 */
export interface LoadSnapshotOptions {
  /**
   * Full path to the snapshot file
   */
  readonly filePath: string;
}

/**
 * Manages permissions snapshot files
 */
export class SnapshotManager {
  /**
   * Save a snapshot to disk
   *
   * @param snapshot The snapshot to save
   * @param options Options for saving
   * @returns The full path to the saved file
   */
  public static save(snapshot: PermissionsSnapshot, options: SaveSnapshotOptions): string {
    const fileName = (options.baseName || sanitizeFileName(snapshot.testName)) + SNAPSHOT_EXTENSION;
    const filePath = path.join(options.directory, fileName);

    // Ensure directory exists
    if (!fs.existsSync(options.directory)) {
      fs.mkdirSync(options.directory, { recursive: true });
    }

    const content = options.prettyPrint !== false
      ? JSON.stringify(snapshot, null, 2)
      : JSON.stringify(snapshot);

    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * Load a snapshot from disk
   *
   * @param options Options for loading
   * @returns The loaded snapshot, or undefined if file doesn't exist
   */
  public static load(options: LoadSnapshotOptions): PermissionsSnapshot | undefined {
    if (!fs.existsSync(options.filePath)) {
      return undefined;
    }

    const content = fs.readFileSync(options.filePath, 'utf-8');
    const snapshot = JSON.parse(content) as PermissionsSnapshot;

    // Validate the snapshot
    SnapshotManager.validateSnapshot(snapshot);

    return snapshot;
  }

  /**
   * Compare two snapshots and return the differences
   *
   * @param existing The existing (expected) snapshot
   * @param current The current (actual) snapshot
   * @returns Comparison result with differences
   */
  public static compare(
    existing: PermissionsSnapshot,
    current: PermissionsSnapshot,
  ): SnapshotComparisonResult {
    // Compare roles
    const addedRoles = current.roles.filter(
      role => !existing.roles.some(r => r.roleArn === role.roleArn),
    );
    const removedRoles = existing.roles.filter(
      role => !current.roles.some(r => r.roleArn === role.roleArn),
    );

    // Compare actions
    const addedActions = current.actions.filter(
      action => !existing.actions.some(
        a => a.service === action.service && a.action === action.action,
      ),
    );
    const removedActions = existing.actions.filter(
      action => !current.actions.some(
        a => a.service === action.service && a.action === action.action,
      ),
    );

    const matches = addedRoles.length === 0 &&
      removedRoles.length === 0 &&
      addedActions.length === 0 &&
      removedActions.length === 0;

    const summary = SnapshotManager.generateSummary(
      addedRoles,
      removedRoles,
      addedActions,
      removedActions,
    );

    return {
      matches,
      addedRoles,
      removedRoles,
      addedActions,
      removedActions,
      summary,
    };
  }

  /**
   * Get the expected snapshot file path for a test
   *
   * @param testFilePath Path to the test file
   * @returns The expected snapshot file path
   */
  public static getSnapshotPath(testFilePath: string): string {
    const dir = path.dirname(testFilePath);
    const baseName = path.basename(testFilePath, path.extname(testFilePath));
    return path.join(dir, `${baseName}${SNAPSHOT_EXTENSION}`);
  }

  /**
   * Validate a snapshot object
   *
   * @param snapshot The snapshot to validate
   * @throws Error if the snapshot is invalid
   */
  private static validateSnapshot(snapshot: PermissionsSnapshot): void {
    if (!snapshot.version) {
      throw new Error('Invalid snapshot: missing version');
    }
    if (!snapshot.testName) {
      throw new Error('Invalid snapshot: missing testName');
    }
    if (!Array.isArray(snapshot.roles)) {
      throw new Error('Invalid snapshot: roles must be an array');
    }
    if (!Array.isArray(snapshot.actions)) {
      throw new Error('Invalid snapshot: actions must be an array');
    }

    // Check version compatibility
    const [major] = snapshot.version.split('.');
    const [currentMajor] = SNAPSHOT_VERSION.split('.');
    if (major !== currentMajor) {
      throw new Error(
        `Snapshot version ${snapshot.version} is not compatible with current version ${SNAPSHOT_VERSION}`,
      );
    }
  }

  /**
   * Generate a human-readable summary of differences
   */
  private static generateSummary(
    addedRoles: RoleAssumption[],
    removedRoles: RoleAssumption[],
    addedActions: AggregatedAction[],
    removedActions: AggregatedAction[],
  ): string {
    const lines: string[] = [];

    if (addedRoles.length === 0 && removedRoles.length === 0 &&
        addedActions.length === 0 && removedActions.length === 0) {
      return 'No changes detected.';
    }

    if (addedRoles.length > 0) {
      lines.push('Added roles:');
      for (const role of addedRoles) {
        lines.push(`  + ${role.roleArn}`);
      }
    }

    if (removedRoles.length > 0) {
      lines.push('Removed roles:');
      for (const role of removedRoles) {
        lines.push(`  - ${role.roleArn}`);
      }
    }

    if (addedActions.length > 0) {
      lines.push('Added actions:');
      for (const action of addedActions) {
        lines.push(`  + ${action.service}:${action.action}`);
      }
    }

    if (removedActions.length > 0) {
      lines.push('Removed actions:');
      for (const action of removedActions) {
        lines.push(`  - ${action.service}:${action.action}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Sanitize a string for use as a file name
 */
function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Error thrown when a permissions snapshot comparison fails
 */
export class PermissionsSnapshotError extends Error {
  constructor(
    message: string,
    public readonly comparisonResult: SnapshotComparisonResult,
  ) {
    super(message);
    this.name = 'PermissionsSnapshotError';
  }
}
