/**
 * Assertion functions for permissions snapshot testing
 */

import { PermissionsRecorder } from './permissions-recorder';
import { readPermissionsSnapshot, writePermissionsSnapshot } from './snapshot-writer';
import { compareSnapshots, hasDifferences, formatDiff, formatDiffForGitHub, summarizeDiff, SnapshotDiff } from './snapshot-comparator';
import { PermissionsSnapshot } from './types';

/**
 * Result of asserting permissions snapshot
 */
export interface AssertionResult {
  /**
   * Whether the assertion passed
   */
  readonly passed: boolean;

  /**
   * Whether a new snapshot was created (first run)
   */
  readonly newSnapshot: boolean;

  /**
   * The diff between expected and actual (if different)
   */
  readonly diff?: SnapshotDiff;

  /**
   * Human-readable message
   */
  readonly message: string;
}

/**
 * Options for asserting permissions snapshot
 */
export interface AssertPermissionsSnapshotOptions {
  /**
   * The permissions recorder to get actual permissions from
   * @default PermissionsRecorder.globalInstance
   */
  readonly recorder?: PermissionsRecorder;

  /**
   * Test name for error messages
   */
  readonly testName?: string;

  /**
   * Test file path for GitHub Actions annotation
   */
  readonly testFile?: string;

  /**
   * Snapshot filename (without directory)
   */
  readonly filename?: string;
}

/**
 * Assert that the current permissions match the expected snapshot
 *
 * - If no snapshot exists, creates a new one and passes
 * - If snapshot exists and matches, passes
 * - If snapshot exists and differs, throws an error with detailed diff
 *
 * @param snapshotDir - Directory containing the snapshot file
 * @param options - Optional configuration
 * @throws Error if permissions don't match expected snapshot
 */
export function assertPermissionsSnapshot(
  snapshotDir: string,
  options: AssertPermissionsSnapshotOptions = {},
): void {
  const result = checkPermissionsSnapshot(snapshotDir, options);

  if (!result.passed) {
    // Log GitHub-formatted output if test file is provided
    if (options.testFile && result.diff) {
      const githubOutput = formatDiffForGitHub(result.diff, options.testFile);
      if (githubOutput) {
        console.error(githubOutput);
      }
    }

    throw new Error(result.message);
  }
}

/**
 * Check permissions snapshot without throwing
 *
 * Returns a result object indicating pass/fail and diff details.
 *
 * @param snapshotDir - Directory containing the snapshot file
 * @param options - Optional configuration
 * @returns AssertionResult with pass/fail status and details
 */
export function checkPermissionsSnapshot(
  snapshotDir: string,
  options: AssertPermissionsSnapshotOptions = {},
): AssertionResult {
  const recorder = options.recorder ?? PermissionsRecorder.globalInstance;
  const testName = options.testName;

  // Get the actual permissions from the recorder
  const actual = recorder.getSnapshot();

  // Try to read the expected snapshot
  const expected = readPermissionsSnapshot(snapshotDir, options.filename);

  // First run: no existing snapshot
  if (expected === null) {
    // Write the new snapshot
    writePermissionsSnapshot(snapshotDir, actual, options.filename);

    return {
      passed: true,
      newSnapshot: true,
      message: `Created new permissions snapshot in ${snapshotDir}`,
    };
  }

  // Compare snapshots
  const diff = compareSnapshots(expected, actual);

  if (!hasDifferences(diff)) {
    return {
      passed: true,
      newSnapshot: false,
      message: 'Permissions snapshot matches',
    };
  }

  // Snapshots differ
  return {
    passed: false,
    newSnapshot: false,
    diff,
    message: formatDiff(diff, testName),
  };
}

/**
 * Update the permissions snapshot with current recorded permissions
 *
 * Writes the current permissions from the recorder to the snapshot file,
 * overwriting any existing snapshot.
 *
 * @param snapshotDir - Directory to write the snapshot
 * @param options - Optional configuration
 */
export function updatePermissionsSnapshot(
  snapshotDir: string,
  options: Pick<AssertPermissionsSnapshotOptions, 'recorder' | 'filename'> = {},
): void {
  const recorder = options.recorder ?? PermissionsRecorder.globalInstance;
  const actual = recorder.getSnapshot();

  writePermissionsSnapshot(snapshotDir, actual, options.filename);
}

/**
 * Compare expected snapshot with current permissions and return the diff
 *
 * Useful for programmatic access to the diff without assertion.
 *
 * @param snapshotDir - Directory containing the expected snapshot
 * @param options - Optional configuration
 * @returns The diff, or null if no expected snapshot exists
 */
export function getPermissionsDiff(
  snapshotDir: string,
  options: Pick<AssertPermissionsSnapshotOptions, 'recorder' | 'filename'> = {},
): SnapshotDiff | null {
  const recorder = options.recorder ?? PermissionsRecorder.globalInstance;
  const actual = recorder.getSnapshot();

  const expected = readPermissionsSnapshot(snapshotDir, options.filename);
  if (expected === null) {
    return null;
  }

  return compareSnapshots(expected, actual);
}

/**
 * Environment variable to enable snapshot update mode
 */
export const UPDATE_PERMISSIONS_ENV = 'CDK_INTEG_UPDATE_PERMISSIONS';

/**
 * Check if snapshot update mode is enabled via environment variable
 */
export function isUpdateMode(): boolean {
  const value = process.env[UPDATE_PERMISSIONS_ENV];
  return value === 'true' || value === '1';
}

/**
 * Assert or update permissions snapshot based on environment
 *
 * If CDK_INTEG_UPDATE_PERMISSIONS is set, updates the snapshot.
 * Otherwise, asserts that the snapshot matches.
 *
 * @param snapshotDir - Directory containing the snapshot
 * @param options - Optional configuration
 * @throws Error if assertions fail and not in update mode
 */
export function assertOrUpdatePermissionsSnapshot(
  snapshotDir: string,
  options: AssertPermissionsSnapshotOptions = {},
): void {
  if (isUpdateMode()) {
    updatePermissionsSnapshot(snapshotDir, options);
    console.log(`Updated permissions snapshot in ${snapshotDir}`);
    return;
  }

  assertPermissionsSnapshot(snapshotDir, options);
}
