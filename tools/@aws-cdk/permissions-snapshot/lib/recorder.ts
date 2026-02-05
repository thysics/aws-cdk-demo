import type {
  PermissionsSnapshot,
  PermissionsRecorderOptions,
  SnapshotAssertOptions,
  SnapshotComparisonResult,
} from './types';
import {
  startRecording,
  stopRecording,
  isRecording,
  permissionsRecorderPlugin,
} from './middleware';
import { SnapshotManager, SNAPSHOT_EXTENSION } from './snapshot-manager';

/**
 * Error thrown when a permissions snapshot assertion fails
 */
export class PermissionsSnapshotError extends Error {
  constructor(
    message: string,
    public readonly testName: string,
    public readonly comparisonResult: SnapshotComparisonResult,
    public readonly snapshotPath: string,
  ) {
    super(message);
    this.name = 'PermissionsSnapshotError';
  }
}

/**
 * Main class for recording and asserting permissions snapshots
 * 
 * @example
 * ```typescript
 * import { PermissionsRecorder } from '@aws-cdk/permissions-snapshot';
 * 
 * const recorder = new PermissionsRecorder({
 *   testName: 'my-integration-test',
 *   snapshotPath: './snapshots/my-test.permissions.snap',
 * });
 * 
 * // Add the plugin to your AWS SDK clients
 * const s3Client = new S3Client({});
 * s3Client.middlewareStack.use(recorder.getPlugin());
 * 
 * // Start recording
 * recorder.start();
 * 
 * // Run your test code that makes AWS calls
 * await s3Client.send(new PutObjectCommand({ ... }));
 * 
 * // Stop recording and assert against snapshot
 * const result = await recorder.assertSnapshot();
 * ```
 */
export class PermissionsRecorder {
  private readonly options: PermissionsRecorderOptions;
  private readonly snapshotPath: string;
  private snapshot: PermissionsSnapshot | null = null;

  constructor(options: PermissionsRecorderOptions) {
    this.options = options;
    this.snapshotPath = options.snapshotPath || 
      SnapshotManager.getDefaultSnapshotPath(options.testName);
  }

  /**
   * Get the middleware plugin to add to AWS SDK clients
   */
  getPlugin() {
    return permissionsRecorderPlugin;
  }

  /**
   * Start recording AWS SDK calls
   */
  start(): void {
    startRecording({
      excludeServices: this.options.excludeServices,
      excludeActions: this.options.excludeActions,
      includeResources: this.options.includeResources,
    });
  }

  /**
   * Stop recording and create the snapshot
   */
  stop(): PermissionsSnapshot {
    const { actions, roleAssumptions } = stopRecording();
    this.snapshot = SnapshotManager.createSnapshot(
      this.options.testName,
      actions,
      roleAssumptions,
    );
    return this.snapshot;
  }

  /**
   * Get the current recording state
   */
  isRecording(): boolean {
    return isRecording();
  }

  /**
   * Get the recorded snapshot (null if recording hasn't stopped)
   */
  getSnapshot(): PermissionsSnapshot | null {
    return this.snapshot;
  }

  /**
   * Get the snapshot file path
   */
  getSnapshotPath(): string {
    return this.snapshotPath;
  }

  /**
   * Assert that the recorded permissions match the snapshot
   * 
   * @param options - Options for the assertion
   * @returns The comparison result
   * @throws PermissionsSnapshotError if the snapshot doesn't match and updateSnapshot is false
   */
  assertSnapshot(options?: SnapshotAssertOptions): SnapshotComparisonResult {
    if (!this.snapshot) {
      this.stop();
    }

    const currentSnapshot = this.snapshot!;
    const updateSnapshot = options?.updateSnapshot ?? this.options.updateSnapshot ?? false;

    // Load existing snapshot
    const existingSnapshot = SnapshotManager.loadSnapshot(this.snapshotPath);

    // If no existing snapshot, create one
    if (!existingSnapshot) {
      console.log(`Creating new permissions snapshot: ${this.snapshotPath}`);
      SnapshotManager.saveSnapshot(currentSnapshot, this.snapshotPath);
      return {
        match: true,
        addedActions: [],
        removedActions: [],
        addedRoleAssumptions: [],
        removedRoleAssumptions: [],
        diffMessage: 'New snapshot created',
      };
    }

    // Compare snapshots
    const result = SnapshotManager.compareSnapshots(existingSnapshot, currentSnapshot);

    if (!result.match) {
      if (updateSnapshot) {
        console.log(`Updating permissions snapshot: ${this.snapshotPath}`);
        console.log(result.diffMessage);
        SnapshotManager.saveSnapshot(currentSnapshot, this.snapshotPath);
      } else {
        const message = this.buildErrorMessage(result, options?.failureMessage);
        throw new PermissionsSnapshotError(
          message,
          this.options.testName,
          result,
          this.snapshotPath,
        );
      }
    }

    return result;
  }

  /**
   * Save the current snapshot to a file (without comparison)
   */
  saveSnapshot(): void {
    if (!this.snapshot) {
      this.stop();
    }
    SnapshotManager.saveSnapshot(this.snapshot!, this.snapshotPath);
  }

  /**
   * Print the current snapshot to console
   */
  printSnapshot(): void {
    if (!this.snapshot) {
      this.stop();
    }
    console.log(SnapshotManager.formatSnapshot(this.snapshot!));
  }

  private buildErrorMessage(
    result: SnapshotComparisonResult,
    customMessage?: string,
  ): string {
    const lines: string[] = [
      `Permissions snapshot assertion failed for test: ${this.options.testName}`,
      '',
      'The IAM permissions used in this test have changed from the recorded snapshot.',
      'This may indicate an unintended change that could break deployments for users',
      'with strict IAM policies.',
      '',
      result.diffMessage,
      '',
      `Snapshot file: ${this.snapshotPath}`,
      '',
      'To update the snapshot if this change is intentional, either:',
      '  1. Run with --update-snapshot flag',
      '  2. Set updateSnapshot: true in recorder options',
      '  3. Delete the snapshot file and re-run the test',
    ];

    if (customMessage) {
      lines.unshift(customMessage, '');
    }

    return lines.join('\n');
  }
}

/**
 * Convenience function to create and start a permissions recorder
 */
export function createRecorder(options: PermissionsRecorderOptions): PermissionsRecorder {
  const recorder = new PermissionsRecorder(options);
  recorder.start();
  return recorder;
}

/**
 * Decorator/wrapper for running a test with permissions recording
 * 
 * @example
 * ```typescript
 * await withPermissionsRecording({
 *   testName: 'my-test',
 *   snapshotPath: './snapshots/my-test.snap',
 * }, async (recorder) => {
 *   // Your test code here
 *   const client = new S3Client({});
 *   client.middlewareStack.use(recorder.getPlugin());
 *   await client.send(new PutObjectCommand({ ... }));
 * });
 * ```
 */
export async function withPermissionsRecording<T>(
  options: PermissionsRecorderOptions,
  testFn: (recorder: PermissionsRecorder) => Promise<T>,
): Promise<{ result: T; snapshot: PermissionsSnapshot; comparison: SnapshotComparisonResult }> {
  const recorder = new PermissionsRecorder(options);
  recorder.start();

  try {
    const result = await testFn(recorder);
    const snapshot = recorder.stop();
    const comparison = recorder.assertSnapshot();
    return { result, snapshot, comparison };
  } finally {
    // Ensure recording is stopped even if test fails
    if (recorder.isRecording()) {
      recorder.stop();
    }
  }
}
