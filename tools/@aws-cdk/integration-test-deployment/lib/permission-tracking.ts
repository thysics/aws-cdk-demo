/**
 * Permission tracking utilities for integration test deployment.
 *
 * Provides functions to initialize, instrument, and finalize permission
 * tracking during integration test execution.
 *
 * @module @aws-cdk/integration-test-deployment
 */

import {
  PermissionTracker,
  createPermissionTrackerPlugin,
  getPermissionSnapshotPath,
  writePermissionSnapshot,
  readPermissionSnapshot,
  compareSnapshots,
  formatSnapshotDiff,
} from '@aws-cdk/integ-permissions-tracker';
import { STSClient } from '@aws-sdk/client-sts';

/**
 * Environment variable to enable permission tracking.
 */
export const TRACK_PERMISSIONS_ENV = 'CDK_INTEG_TRACK_PERMISSIONS';

/**
 * Environment variable to update permission snapshots.
 */
export const UPDATE_PERMISSIONS_ENV = 'CDK_INTEG_UPDATE_PERMISSIONS';

/**
 * Options for permission tracking during test execution.
 */
export interface PermissionTrackingOptions {
  /**
   * Enable permission tracking.
   * @default - true if CDK_INTEG_TRACK_PERMISSIONS env var is set to 'true' or '1'
   */
  enabled?: boolean;

  /**
   * Update snapshots instead of failing on differences.
   * @default - true if CDK_INTEG_UPDATE_PERMISSIONS env var is set to 'true' or '1'
   */
  updateSnapshots?: boolean;
}

/**
 * Result of permission tracking initialization.
 */
export interface PermissionTrackingContext {
  /**
   * The permission tracker instance.
   */
  tracker: PermissionTracker;

  /**
   * Cleanup function to reset the tracker instance.
   */
  cleanup: () => void;
}

/**
 * Result of permission tracking finalization.
 */
export interface PermissionTrackingResult {
  /**
   * Whether the permission snapshot comparison passed.
   */
  passed: boolean;

  /**
   * Message describing the result (error message or success message).
   */
  message?: string;
}

/**
 * Check if permission tracking is enabled based on options or environment variables.
 *
 * @param options - optional permission tracking options.
 * @returns true if permission tracking should be enabled.
 */
export function isPermissionTrackingEnabled(options?: PermissionTrackingOptions): boolean {
  if (options?.enabled !== undefined) {
    return options.enabled;
  }
  const envValue = process.env[TRACK_PERMISSIONS_ENV];
  return envValue === 'true' || envValue === '1';
}

/**
 * Check if permission snapshot updates are enabled based on options or environment variables.
 *
 * @param options - optional permission tracking options.
 * @returns true if permission snapshots should be updated instead of validated.
 */
export function isUpdateSnapshotsEnabled(options?: PermissionTrackingOptions): boolean {
  if (options?.updateSnapshots !== undefined) {
    return options.updateSnapshots;
  }
  const envValue = process.env[UPDATE_PERMISSIONS_ENV];
  return envValue === 'true' || envValue === '1';
}

/**
 * Initialize permission tracking for a test run.
 *
 * Creates a new permission tracker instance and returns it along with a cleanup function.
 * Returns undefined if permission tracking is disabled.
 *
 * @param options - optional permission tracking options.
 * @returns the tracker and cleanup function, or undefined if tracking is disabled.
 *
 * @example
 * ```typescript
 * const context = initializePermissionTracking({ enabled: true });
 * if (context) {
 *   // run tests with permission tracking
 *   // ...
 *   context.cleanup();
 * }
 * ```
 */
export function initializePermissionTracking(
  options?: PermissionTrackingOptions
): PermissionTrackingContext | undefined {
  if (!isPermissionTrackingEnabled(options)) {
    return undefined;
  }

  // reset any existing instance and create a new one
  PermissionTracker.resetInstance();
  const tracker = PermissionTracker.getInstance();

  return {
    tracker,
    cleanup: () => {
      tracker.clear();
    },
  };
}

/**
 * Instrument an STS client to track permissions.
 *
 * Adds the permission tracking middleware to the STS client's middleware stack,
 * allowing all API calls made through the client to be recorded.
 *
 * @param client - the STS client to instrument.
 * @param tracker - optional custom tracker instance (defaults to singleton).
 *
 * @example
 * ```typescript
 * const stsClient = new STSClient({});
 * instrumentStsClient(stsClient);
 * // now all calls through stsClient will be tracked
 * ```
 */
export function instrumentStsClient(client: STSClient, tracker?: PermissionTracker): void {
  const plugin = createPermissionTrackerPlugin(tracker);
  client.middlewareStack.use(plugin);
}

/**
 * Clear the permission tracker for a new test run.
 *
 * This should be called before each test batch to ensure clean permission data.
 *
 * @param tracker - optional specific tracker instance to clear (defaults to singleton).
 */
export function clearPermissionTracker(tracker?: PermissionTracker): void {
  const t = tracker ?? PermissionTracker.getInstance();
  t.clear();
}

/**
 * Finalize permission tracking after a test and validate/update snapshots.
 *
 * If updateSnapshots is enabled, writes the current snapshot to disk.
 * Otherwise, compares the current snapshot against the baseline and returns
 * whether they match.
 *
 * @param testName - name of the integration test (e.g., 'integ.my-test').
 * @param snapshotDir - directory where snapshots are stored.
 * @param options - optional permission tracking options.
 * @returns result indicating whether the validation passed.
 *
 * @example
 * ```typescript
 * const result = await finalizePermissionTracking(
 *   'integ.my-test',
 *   '/path/to/snapshots',
 *   { updateSnapshots: false }
 * );
 *
 * if (!result.passed) {
 *   console.error(result.message);
 *   throw new Error('Permission snapshot mismatch');
 * }
 * ```
 */
export async function finalizePermissionTracking(
  testName: string,
  snapshotDir: string,
  options?: PermissionTrackingOptions
): Promise<PermissionTrackingResult> {
  const tracker = PermissionTracker.getInstance();
  const currentSnapshot = tracker.getSnapshot();
  const snapshotPath = getPermissionSnapshotPath(testName, snapshotDir);
  const updateSnapshots = isUpdateSnapshotsEnabled(options);

  // if no permissions were recorded, skip snapshot operations
  if (tracker.isEmpty) {
    return {
      passed: true,
      message: 'No permissions recorded during test execution',
    };
  }

  if (updateSnapshots) {
    // update mode: write the current snapshot
    writePermissionSnapshot(snapshotPath, currentSnapshot);
    return {
      passed: true,
      message: `Permission snapshot updated: ${snapshotPath}`,
    };
  }

  // validation mode: compare with baseline
  const baseline = readPermissionSnapshot(snapshotPath);
  const diff = compareSnapshots(baseline, currentSnapshot);

  if (!diff.hasChanges) {
    return {
      passed: true,
      message: 'Permission snapshot matches baseline',
    };
  }

  // snapshot has changes - format the diff for display
  const diffMessage = formatSnapshotDiff(diff);
  return {
    passed: false,
    message: `Permission snapshot mismatch for ${testName}:\n\n${diffMessage}`,
  };
}

/**
 * Get the snapshot directory for a test file path.
 *
 * For a test file like `/path/to/test/integ.my-test.js`, returns the
 * `.snapshot` directory where permission snapshots should be stored.
 *
 * @param testFilePath - path to the integration test file.
 * @returns path to the snapshot directory.
 */
export function getSnapshotDirectory(testFilePath: string): string {
  // remove file extension and add .snapshot suffix
  const basePath = testFilePath.replace(/\.(ts|js)$/, '');
  return `${basePath}.integ.snapshot`;
}

/**
 * Extract the test name from a test file path.
 *
 * @param testFilePath - path to the integration test file.
 * @returns the test name (e.g., 'integ.my-test').
 */
export function getTestName(testFilePath: string): string {
  const match = testFilePath.match(/integ\.[^/]+$/);
  if (match) {
    return match[0].replace(/\.(ts|js)$/, '');
  }
  // fallback: use the base name without extension
  const parts = testFilePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.(ts|js)$/, '');
}

/**
 * Check if permission tracking should be skipped for a given execution mode.
 *
 * Permission tracking should be skipped in dry-run mode or when running
 * in snapshot-only mode where no actual AWS calls are made.
 *
 * @param dryRun - whether the test is running in dry-run mode.
 * @param snapshotOnly - whether only snapshots are being updated without deployment.
 * @returns true if permission tracking should be skipped.
 */
export function shouldSkipPermissionTracking(dryRun: boolean = false, snapshotOnly: boolean = false): boolean {
  return dryRun || snapshotOnly;
}
