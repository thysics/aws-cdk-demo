/**
 * Permissions Tracking for Integration Tests
 *
 * This module provides utilities for managing permissions snapshots
 * during integration test runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PermissionsCollector,
  PermissionsSnapshot,
  SnapshotComparator,
  SnapshotData,
  SnapshotDiffResult,
} from '@aws-cdk/permissions-tracker';

/**
 * The filename for permissions snapshots.
 */
export const PERMISSIONS_SNAPSHOT_FILENAME = 'permissions.snapshot.json';

/**
 * Options for permissions tracking during test execution.
 */
export interface PermissionsTrackingOptions {
  /**
   * Whether permissions tracking is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Whether to skip permissions validation (only record, don't compare).
   * @default false
   */
  skipValidation?: boolean;
  /**
   * Whether to update permissions snapshots when they differ.
   * @default false
   */
  updateSnapshot?: boolean;
}

/**
 * Result of permissions snapshot validation.
 */
export interface PermissionsValidationResult {
  /** Whether the validation passed */
  passed: boolean;
  /** The snapshot diff result (if comparison was performed) */
  diff?: SnapshotDiffResult;
  /** Formatted diff message for display */
  diffMessage?: string;
  /** Path to the snapshot file */
  snapshotPath: string;
  /** Whether the snapshot was updated */
  updated: boolean;
}

/**
 * Manages permissions tracking and snapshot comparison for integration tests.
 */
export class PermissionsTrackingManager {
  private readonly options: Required<PermissionsTrackingOptions>;
  private testName?: string;
  private snapshotDirectory?: string;

  constructor(options: PermissionsTrackingOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      skipValidation: options.skipValidation ?? false,
      updateSnapshot: options.updateSnapshot ?? false,
    };
  }

  /**
   * Initializes permissions tracking for a test.
   *
   * @param testName - The name of the test being run
   * @param snapshotDirectory - The directory where snapshots are stored
   */
  public initializeForTest(testName: string, snapshotDirectory: string): void {
    if (!this.options.enabled) {
      return;
    }

    this.testName = testName;
    this.snapshotDirectory = snapshotDirectory;

    // Reset the collector for a fresh test run
    PermissionsCollector.resetInstance();
    const collector = PermissionsCollector.getInstance();
    collector.reset();
  }

  /**
   * Finalizes permissions tracking after a test completes.
   *
   * Generates a snapshot and compares it with the stored version.
   *
   * @returns The validation result
   */
  public finalize(): PermissionsValidationResult {
    if (!this.options.enabled || !this.testName || !this.snapshotDirectory) {
      return {
        passed: true,
        snapshotPath: '',
        updated: false,
      };
    }

    const snapshotPath = this.getSnapshotPath();
    const collector = PermissionsCollector.getInstance();
    const currentSnapshot = PermissionsSnapshot.fromCollector(collector, {
      testName: this.testName,
    });

    // If skip validation is enabled, just save the snapshot and return success
    if (this.options.skipValidation) {
      this.saveSnapshot(snapshotPath, currentSnapshot);
      return {
        passed: true,
        snapshotPath,
        updated: true,
      };
    }

    // Check if a stored snapshot exists
    const storedSnapshot = this.loadStoredSnapshot(snapshotPath);

    if (!storedSnapshot) {
      // No stored snapshot - this is a new test
      if (this.options.updateSnapshot) {
        this.saveSnapshot(snapshotPath, currentSnapshot);
        return {
          passed: true,
          snapshotPath,
          updated: true,
        };
      }
      return {
        passed: false,
        diffMessage: `No stored permissions snapshot found at ${snapshotPath}. Run with --update-permissions-snapshot to create one.`,
        snapshotPath,
        updated: false,
      };
    }

    // Compare snapshots
    const comparator = new SnapshotComparator(storedSnapshot, currentSnapshot);
    const diff = comparator.compare();

    if (diff.identical) {
      return {
        passed: true,
        diff,
        snapshotPath,
        updated: false,
      };
    }

    // Snapshots differ
    if (this.options.updateSnapshot) {
      this.saveSnapshot(snapshotPath, currentSnapshot);
      return {
        passed: true,
        diff,
        diffMessage: comparator.formatDiff({ useColors: false }),
        snapshotPath,
        updated: true,
      };
    }

    return {
      passed: false,
      diff,
      diffMessage: comparator.formatDiff(),
      snapshotPath,
      updated: false,
    };
  }

  /**
   * Gets the path to the permissions snapshot file.
   */
  public getSnapshotPath(): string {
    if (!this.snapshotDirectory) {
      throw new Error('snapshot directory not initialized');
    }
    return path.join(this.snapshotDirectory, PERMISSIONS_SNAPSHOT_FILENAME);
  }

  /**
   * Loads a stored snapshot from disk.
   *
   * @param snapshotPath - Path to the snapshot file
   * @returns The loaded snapshot, or undefined if not found
   */
  private loadStoredSnapshot(snapshotPath: string): PermissionsSnapshot | undefined {
    try {
      if (!fs.existsSync(snapshotPath)) {
        return undefined;
      }
      const content = fs.readFileSync(snapshotPath, 'utf-8');
      const json = JSON.parse(content) as SnapshotData;
      return PermissionsSnapshot.fromJSON(json);
    } catch (error) {
      console.warn(`Warning: Failed to load permissions snapshot from ${snapshotPath}: ${error}`);
      return undefined;
    }
  }

  /**
   * Saves a snapshot to disk.
   *
   * @param snapshotPath - Path to save the snapshot
   * @param snapshot - The snapshot to save
   */
  private saveSnapshot(snapshotPath: string, snapshot: PermissionsSnapshot): void {
    const directory = path.dirname(snapshotPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const json = snapshot.toJSON();
    fs.writeFileSync(snapshotPath, JSON.stringify(json, null, 2) + '\n');
    console.log(`Permissions snapshot saved to ${snapshotPath}`);
  }

  /**
   * Whether permissions tracking is enabled.
   */
  public isEnabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Whether permissions validation is skipped.
   */
  public isValidationSkipped(): boolean {
    return this.options.skipValidation;
  }

  /**
   * Whether snapshots should be updated when they differ.
   */
  public shouldUpdateSnapshot(): boolean {
    return this.options.updateSnapshot;
  }
}

/**
 * Formats a permissions validation failure for test output.
 *
 * @param result - The validation result
 * @returns Formatted error message
 */
export function formatPermissionsError(result: PermissionsValidationResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('PERMISSIONS SNAPSHOT MISMATCH');
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Snapshot file: ${result.snapshotPath}`);
  lines.push('');

  if (result.diffMessage) {
    lines.push(result.diffMessage);
  }

  lines.push('');
  lines.push('To update the permissions snapshot, run with --update-permissions-snapshot');
  lines.push('To skip permissions validation, run with --skip-permissions-check');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Extracts the snapshot directory from an integration test path.
 *
 * Integration test snapshots are stored in a `.snapshot` directory
 * alongside the test file.
 *
 * @param testPath - Path to the integration test file
 * @returns Path to the snapshot directory
 */
export function getSnapshotDirectoryForTest(testPath: string): string {
  const testDir = path.dirname(testPath);
  const testBasename = path.basename(testPath, path.extname(testPath));
  return path.join(testDir, `${testBasename}.snapshot`);
}

/**
 * Extracts the test name from an integration test path.
 *
 * @param testPath - Path to the integration test file
 * @returns The test name
 */
export function getTestNameFromPath(testPath: string): string {
  // Remove the .js or .ts extension and any leading path components
  const basename = path.basename(testPath);
  return basename.replace(/\.(js|ts)$/, '');
}
