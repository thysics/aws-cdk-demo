/**
 * Integration Test Permissions Tracking
 *
 * High-level API for enabling permissions tracking in integration tests.
 */

import * as path from 'path';
import type { PermissionsTrackingOptions, PermissionsSnapshot } from './types';
import { PermissionsTracker } from './tracker';
import { SnapshotManager, PermissionsSnapshotError } from './snapshot';

/**
 * Options for integration test permissions tracking
 */
export interface IntegTestPermissionsOptions extends Omit<PermissionsTrackingOptions, 'testName'> {
  /**
   * Path to the integration test file
   */
  readonly testFilePath: string;

  /**
   * Whether to update the snapshot if it doesn't exist or has changed
   *
   * @default false
   */
  readonly updateSnapshot?: boolean;

  /**
   * Custom directory for storing snapshot files
   *
   * @default - same directory as the test file
   */
  readonly snapshotDirectory?: string;

  /**
   * Whether to fail the test if permissions have changed
   *
   * @default true
   */
  readonly failOnChange?: boolean;
}

/**
 * Result of permissions tracking for an integration test
 */
export interface PermissionsTrackingResult {
  /**
   * The generated snapshot
   */
  readonly snapshot: PermissionsSnapshot;

  /**
   * Path to the snapshot file
   */
  readonly snapshotPath: string;

  /**
   * Whether the snapshot matched the existing snapshot (if any)
   */
  readonly matched: boolean;

  /**
   * Whether the snapshot was created or updated
   */
  readonly updated: boolean;

  /**
   * Summary of any changes (if applicable)
   */
  readonly changeSummary?: string;
}

/**
 * Context object for tracking permissions during an integration test
 */
export class IntegTestPermissionsContext {
  private readonly options: IntegTestPermissionsOptions;
  private readonly testName: string;
  private tracker: PermissionsTracker | undefined;
  private snapshotPath: string;

  constructor(options: IntegTestPermissionsOptions) {
    this.options = options;
    this.testName = path.basename(options.testFilePath, path.extname(options.testFilePath));

    const snapshotDir = options.snapshotDirectory || path.dirname(options.testFilePath);
    this.snapshotPath = path.join(
      snapshotDir,
      `${this.testName}.permissions-snapshot.json`,
    );
  }

  /**
   * Start tracking permissions
   *
   * Call this at the beginning of your integration test
   */
  public start(): void {
    this.tracker = PermissionsTracker.initialize({
      testName: this.testName,
      trackParameters: this.options.trackParameters,
      excludeServices: this.options.excludeServices,
      excludeActions: this.options.excludeActions,
    });
  }

  /**
   * Stop tracking and finalize the results
   *
   * Call this at the end of your integration test
   *
   * @returns The tracking result
   * @throws PermissionsSnapshotError if permissions changed and failOnChange is true
   */
  public finish(): PermissionsTrackingResult {
    if (!this.tracker) {
      throw new Error('Permissions tracking was not started. Call start() first.');
    }

    const snapshot = this.tracker.generateSnapshot();
    let matched = true;
    let updated = false;
    let changeSummary: string | undefined;

    // Load existing snapshot if it exists
    const existingSnapshot = SnapshotManager.load({ filePath: this.snapshotPath });

    if (existingSnapshot) {
      // Compare with existing snapshot
      const comparison = SnapshotManager.compare(existingSnapshot, snapshot);
      matched = comparison.matches;
      changeSummary = comparison.summary;

      if (!matched) {
        if (this.options.updateSnapshot) {
          // Update the snapshot
          SnapshotManager.save(snapshot, {
            directory: path.dirname(this.snapshotPath),
            baseName: this.testName,
          });
          updated = true;
        } else if (this.options.failOnChange !== false) {
          // Fail the test
          throw new PermissionsSnapshotError(
            `Permissions snapshot has changed for test '${this.testName}'.\n\n` +
            `${comparison.summary}\n\n` +
            'To update the snapshot, run the test with --update-snapshots.',
            comparison,
          );
        }
      }
    } else {
      // No existing snapshot, create one
      SnapshotManager.save(snapshot, {
        directory: path.dirname(this.snapshotPath),
        baseName: this.testName,
      });
      updated = true;
    }

    // Clean up
    PermissionsTracker.clear();

    return {
      snapshot,
      snapshotPath: this.snapshotPath,
      matched,
      updated,
      changeSummary,
    };
  }

  /**
   * Get the current tracker instance
   *
   * @returns The tracker, or undefined if not started
   */
  public getTracker(): PermissionsTracker | undefined {
    return this.tracker;
  }

  /**
   * Get the expected snapshot path for this test
   */
  public getSnapshotPath(): string {
    return this.snapshotPath;
  }
}

/**
 * Create a permissions tracking context for an integration test
 *
 * @param options Options for permissions tracking
 * @returns A context object that can be used to start/stop tracking
 *
 * @example
 * ```typescript
 * const context = createPermissionsTrackingContext({
 *   testFilePath: __filename,
 * });
 *
 * context.start();
 *
 * // ... run your integration test ...
 *
 * const result = context.finish();
 * console.log(`Snapshot saved to: ${result.snapshotPath}`);
 * ```
 */
export function createPermissionsTrackingContext(
  options: IntegTestPermissionsOptions,
): IntegTestPermissionsContext {
  return new IntegTestPermissionsContext(options);
}

/**
 * Run a function with permissions tracking enabled
 *
 * @param options Options for permissions tracking
 * @param fn The function to run with tracking enabled
 * @returns The tracking result
 *
 * @example
 * ```typescript
 * const result = await withPermissionsTracking(
 *   { testFilePath: __filename },
 *   async () => {
 *     // Your integration test code here
 *     const s3 = new S3Client({});
 *     await s3.send(new GetObjectCommand({ ... }));
 *   },
 * );
 * ```
 */
export async function withPermissionsTracking<T>(
  options: IntegTestPermissionsOptions,
  fn: () => Promise<T>,
): Promise<{ result: T; tracking: PermissionsTrackingResult }> {
  const context = createPermissionsTrackingContext(options);
  context.start();

  try {
    const result = await fn();
    const tracking = context.finish();
    return { result, tracking };
  } catch (error) {
    // Try to finish tracking even on error
    try {
      context.finish();
    } catch {
      // Ignore errors during cleanup
    }
    throw error;
  }
}
