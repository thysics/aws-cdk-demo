import type { PermissionsRecorderOptions, SnapshotComparisonOptions } from './types';
import { PermissionsRecorder, getGlobalRecorder, resetGlobalRecorder } from './permissions-recorder';
import {
  getSnapshotPath,
  readSnapshot,
  writeSnapshot,
  compareSnapshots,
  formatComparisonResult,
  assertSnapshotMatch,
  updateSnapshot,
} from './snapshot-utils';
import { instrumentSdkClient, uninstrumentSdkClient, wrapSdkClient } from './sdk-interceptor';

/**
 * Options for the permissions snapshot test harness
 */
export interface PermissionsSnapshotTestOptions {
  /**
   * Path to the test file (used to determine snapshot location)
   */
  readonly testFilePath?: string;

  /**
   * Custom path for the snapshot file
   * If not provided, defaults to a file in the test's snapshot directory
   */
  readonly snapshotPath?: string;

  /**
   * Options for the permissions recorder
   */
  readonly recorderOptions?: PermissionsRecorderOptions;

  /**
   * Options for snapshot comparison
   */
  readonly comparisonOptions?: SnapshotComparisonOptions;

  /**
   * Whether to update snapshots instead of comparing
   * Can also be enabled via UPDATE_SNAPSHOTS environment variable
   * 
   * @default false
   */
  readonly updateSnapshots?: boolean;

  /**
   * Whether to fail the test on snapshot mismatch
   * If false, just logs a warning
   * 
   * @default true
   */
  readonly failOnMismatch?: boolean;
}

/**
 * Result of a permissions snapshot test
 */
export interface PermissionsSnapshotTestResult {
  /**
   * Whether the test passed (snapshots match or were updated)
   */
  readonly passed: boolean;

  /**
   * Whether the snapshot was created (new snapshot)
   */
  readonly snapshotCreated: boolean;

  /**
   * Whether the snapshot was updated
   */
  readonly snapshotUpdated: boolean;

  /**
   * Detailed comparison result if available
   */
  readonly comparisonResult?: ReturnType<typeof compareSnapshots>;

  /**
   * Path to the snapshot file
   */
  readonly snapshotPath: string;
}

/**
 * High-level test harness for permissions snapshot testing
 * 
 * This class provides a convenient way to integrate permissions snapshot testing
 * into integration tests.
 * 
 * @example
 * ```ts
 * import { PermissionsSnapshotTest } from '@aws-cdk/integ-tests-alpha';
 * 
 * const permTest = new PermissionsSnapshotTest({
 *   testFilePath: __filename,
 * });
 * 
 * // Start recording before the test
 * permTest.startRecording();
 * 
 * // Run your integration test that makes AWS calls
 * await runIntegrationTest();
 * 
 * // Stop recording and verify snapshot
 * const result = await permTest.stopAndVerify();
 * 
 * if (!result.passed) {
 *   console.error('Permissions snapshot test failed!');
 *   process.exit(1);
 * }
 * ```
 */
export class PermissionsSnapshotTest {
  private readonly recorder: PermissionsRecorder;
  private readonly options: Required<Omit<PermissionsSnapshotTestOptions, 'recorderOptions' | 'comparisonOptions'>> & {
    recorderOptions: PermissionsRecorderOptions;
    comparisonOptions: SnapshotComparisonOptions;
  };
  private readonly snapshotPath: string;

  constructor(options: PermissionsSnapshotTestOptions = {}) {
    this.recorder = new PermissionsRecorder(options.recorderOptions);

    // Determine snapshot path
    if (options.snapshotPath) {
      this.snapshotPath = options.snapshotPath;
    } else if (options.testFilePath) {
      this.snapshotPath = getSnapshotPath(options.testFilePath);
    } else {
      this.snapshotPath = 'permissions.snapshot.json';
    }

    // Check for environment variable
    const updateFromEnv = process.env.UPDATE_SNAPSHOTS === 'true' ||
                          process.env.UPDATE_SNAPSHOTS === '1';

    this.options = {
      testFilePath: options.testFilePath ?? '',
      snapshotPath: this.snapshotPath,
      recorderOptions: options.recorderOptions ?? {},
      comparisonOptions: options.comparisonOptions ?? {},
      updateSnapshots: options.updateSnapshots ?? updateFromEnv,
      failOnMismatch: options.failOnMismatch ?? true,
    };
  }

  /**
   * Start recording permissions
   * 
   * @param testName Optional name for the test (used in snapshot metadata)
   */
  public startRecording(testName?: string): void {
    this.recorder.startRecording(testName);
  }

  /**
   * Stop recording and verify against snapshot
   * 
   * @returns Test result with details about what happened
   */
  public stopAndVerify(): PermissionsSnapshotTestResult {
    const snapshot = this.recorder.stopRecording();

    // If updating snapshots, just write and return success
    if (this.options.updateSnapshots) {
      const result = updateSnapshot(this.snapshotPath, snapshot, { force: true });
      return {
        passed: true,
        snapshotCreated: result.created,
        snapshotUpdated: result.updated,
        snapshotPath: this.snapshotPath,
      };
    }

    // Read existing snapshot
    const existingSnapshot = readSnapshot(this.snapshotPath);

    // If no existing snapshot, create it and pass
    if (!existingSnapshot) {
      writeSnapshot(this.snapshotPath, snapshot);
      return {
        passed: true,
        snapshotCreated: true,
        snapshotUpdated: false,
        snapshotPath: this.snapshotPath,
      };
    }

    // Compare snapshots
    const comparisonResult = compareSnapshots(
      existingSnapshot,
      snapshot,
      this.options.comparisonOptions,
    );

    const passed = comparisonResult.matches;

    if (!passed && this.options.failOnMismatch) {
      const message = formatComparisonResult(comparisonResult);
      console.error(message);
    }

    return {
      passed,
      snapshotCreated: false,
      snapshotUpdated: false,
      comparisonResult,
      snapshotPath: this.snapshotPath,
    };
  }

  /**
   * Get the recorder instance for instrumenting SDK clients
   */
  public getRecorder(): PermissionsRecorder {
    return this.recorder;
  }

  /**
   * Instrument an SDK client to record permissions
   * 
   * @param client The AWS SDK v3 client to instrument
   * @returns The instrumented client
   */
  public instrumentClient<T>(client: T): T {
    return instrumentSdkClient(client as any, { recorder: this.recorder }) as T;
  }
}

/**
 * Create a simple function wrapper for one-off permission snapshot testing
 * 
 * @param fn The async function to test
 * @param options Options for the test
 * @returns Test result
 * 
 * @example
 * ```ts
 * const result = await withPermissionsSnapshot(async () => {
 *   const s3 = new S3Client({});
 *   await s3.send(new PutObjectCommand({ ... }));
 * }, { testFilePath: __filename });
 * ```
 */
export async function withPermissionsSnapshot<T>(
  fn: () => Promise<T>,
  options: PermissionsSnapshotTestOptions = {},
): Promise<{ result: T; snapshotResult: PermissionsSnapshotTestResult }> {
  const test = new PermissionsSnapshotTest(options);
  test.startRecording();

  try {
    const result = await fn();
    const snapshotResult = test.stopAndVerify();
    return { result, snapshotResult };
  } catch (error) {
    // Still try to get snapshot result for debugging
    const snapshotResult = test.stopAndVerify();
    throw new Error(
      `Test execution failed: ${error}\n` +
      `Permissions recorded: ${JSON.stringify(snapshotResult, null, 2)}`,
    );
  }
}
