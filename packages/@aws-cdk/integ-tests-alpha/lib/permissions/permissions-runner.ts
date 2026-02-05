import { PermissionsTracker } from './permissions-tracker';
import { PermissionsSnapshotWriter } from './snapshot-writer';
import { PermissionsSnapshotComparator, SnapshotDiff } from './snapshot-comparator';

/**
 * Result of validating a permissions snapshot
 */
export interface PermissionsValidationResult {
  /**
   * Whether the validation succeeded (no changes or snapshot was updated)
   */
  readonly success: boolean;

  /**
   * Whether the snapshot was updated
   */
  readonly snapshotUpdated: boolean;

  /**
   * The diff between current and expected snapshots, if any
   */
  readonly diff?: SnapshotDiff;

  /**
   * Human-readable message describing the result
   */
  readonly message: string;
}

/**
 * Options for finalizing permissions tracking
 */
export interface FinalizeTrackingOptions {
  /**
   * If true, update the snapshot instead of comparing against it.
   * Use this when running with --update or --update-on-failed flags.
   *
   * @default false
   */
  readonly updateSnapshots?: boolean;
}

/**
 * Helper class for running integration tests with permissions tracking.
 * This is used by the test runner to capture and validate permissions.
 *
 * @example
 * ```typescript
 * import { PermissionsRunner } from '@aws-cdk/integ-tests-alpha';
 *
 * // Before running a test
 * PermissionsRunner.setupTracking('my-test');
 *
 * // ... run the test ...
 *
 * // After the test completes
 * const result = PermissionsRunner.finalizeTracking('./integ.test.js.snapshot', {
 *   updateSnapshots: false,
 * });
 *
 * if (!result.success) {
 *   console.error(result.message);
 *   process.exit(1);
 * }
 * ```
 */
export class PermissionsRunner {
  /**
   * Setup permissions tracking before a test runs.
   * This initializes the PermissionsTracker singleton and starts tracking.
   *
   * @param testName - The name of the test being run
   */
  public static setupTracking(testName: string): void {
    try {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking(testName);
    } catch (error) {
      // Log warning but don't fail - permissions tracking is not critical
      console.warn(`[PermissionsRunner] Failed to setup tracking: ${error}`);
    }
  }

  /**
   * Finalize tracking after a test completes.
   * Writes snapshot and optionally validates against existing snapshot.
   *
   * @param snapshotDir - The snapshot directory (e.g., './integ.test.js.snapshot')
   * @param options - Options for finalization
   * @returns PermissionsValidationResult describing the outcome
   */
  public static finalizeTracking(
    snapshotDir: string,
    options?: FinalizeTrackingOptions,
  ): PermissionsValidationResult {
    const updateSnapshots = options?.updateSnapshots ?? false;

    try {
      const tracker = PermissionsTracker.getInstance();

      // Stop tracking and get the snapshot
      tracker.stopTracking();
      const currentSnapshot = tracker.getSnapshot();

      // Reset tracker for next test
      tracker.reset();

      // If update mode, just write the snapshot
      if (updateSnapshots) {
        PermissionsSnapshotWriter.write(currentSnapshot, snapshotDir);
        return {
          success: true,
          snapshotUpdated: true,
          message: `Permissions snapshot updated for test '${currentSnapshot.testName}'`,
        };
      }

      // Read existing snapshot for comparison
      const expectedSnapshot = PermissionsSnapshotWriter.read(snapshotDir);

      // Compare snapshots
      const diff = PermissionsSnapshotComparator.compare(currentSnapshot, expectedSnapshot);

      // If no changes, success
      if (!diff.hasChanges) {
        return {
          success: true,
          snapshotUpdated: false,
          diff,
          message: 'Permissions snapshot matches expected.',
        };
      }

      // If first run (no existing snapshot), write it
      if (!expectedSnapshot) {
        PermissionsSnapshotWriter.write(currentSnapshot, snapshotDir);
        return {
          success: true,
          snapshotUpdated: true,
          diff,
          message: `Initial permissions snapshot created for test '${currentSnapshot.testName}'`,
        };
      }

      // Snapshot mismatch - return failure with diff
      const diffMessage = PermissionsSnapshotComparator.formatDiff(diff);
      return {
        success: false,
        snapshotUpdated: false,
        diff,
        message: diffMessage,
      };
    } catch (error) {
      // Log warning but don't fail the test - permissions tracking is not critical
      console.warn(`[PermissionsRunner] Failed to finalize tracking: ${error}`);
      return {
        success: true, // Don't fail the test if permissions tracking fails
        snapshotUpdated: false,
        message: `Permissions tracking failed: ${error}`,
      };
    }
  }

  /**
   * Check if permissions tracking is currently active.
   *
   * @returns true if tracking is active
   */
  public static isTrackingActive(): boolean {
    try {
      return PermissionsTracker.getInstance().isCurrentlyTracking();
    } catch {
      return false;
    }
  }

  /**
   * Stop tracking without finalizing (e.g., on test abort).
   * This cleans up the tracker state.
   */
  public static stopTracking(): void {
    try {
      const tracker = PermissionsTracker.getInstance();
      tracker.stopTracking();
      tracker.reset();
    } catch (error) {
      console.warn(`[PermissionsRunner] Failed to stop tracking: ${error}`);
    }
  }

  /**
   * Get the middleware plugin to attach to AWS SDK clients.
   * This should be used to instrument SDK clients for permissions tracking.
   *
   * @returns A pluggable middleware configuration, or undefined if tracking is not active
   */
  public static getMiddlewarePlugin<Input extends object, Output extends import('@smithy/types').MetadataBearer>(): import('@smithy/types').Pluggable<Input, Output> | undefined {
    try {
      const tracker = PermissionsTracker.getInstance();
      if (tracker.isCurrentlyTracking()) {
        return tracker.createMiddlewarePlugin<Input, Output>();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
