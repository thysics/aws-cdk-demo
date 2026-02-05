/**
 * Integration Test Permissions Helper
 *
 * This module provides helper functions and classes to integrate
 * permissions snapshot recording with CDK integration tests.
 */

import { PermissionsRecorder } from './permissions-recorder';
import {
  PermissionsSnapshotManager,
  isPermissionsSnapshotEnabled,
  isSnapshotUpdateEnabled,
} from './permissions-snapshot';
import {
  SdkCallInterceptorManager,
  setupGlobalInterceptor,
  clearGlobalInterceptor,
} from './sdk-call-interceptor';
import type { PermissionsSnapshotConfig, PermissionsSnapshot } from './types';

/**
 * Options for the IntegTest permissions helper
 */
export interface IntegTestPermissionsOptions extends PermissionsSnapshotConfig {
  /**
   * Name of the test case
   */
  readonly testName: string;

  /**
   * Path to the snapshot directory
   * This is typically the integ.test.js.snapshot directory
   */
  readonly snapshotDir: string;
}

/**
 * Result of permissions snapshot validation
 */
export interface PermissionsValidationResult {
  /**
   * Whether validation passed
   */
  readonly passed: boolean;

  /**
   * The current snapshot that was recorded
   */
  readonly snapshot: PermissionsSnapshot;

  /**
   * Summary of any differences found
   */
  readonly summary?: string;

  /**
   * Whether this was a new snapshot (no baseline existed)
   */
  readonly isNewSnapshot?: boolean;
}

/**
 * Helper class for managing permissions snapshots in integration tests
 *
 * @example
 * ```typescript
 * const permissionsHelper = new IntegTestPermissionsHelper({
 *   testName: 'my-test',
 *   snapshotDir: './integ.my-test.js.snapshot',
 *   enabled: true,
 * });
 *
 * // Start recording before running the test
 * permissionsHelper.startRecording();
 *
 * // ... run integration test ...
 *
 * // Stop recording and validate
 * const result = permissionsHelper.stopAndValidate();
 * if (!result.passed) {
 *   throw new Error(`Permissions snapshot mismatch: ${result.summary}`);
 * }
 * ```
 */
export class IntegTestPermissionsHelper {
  private readonly recorder: PermissionsRecorder;
  private readonly snapshotManager: PermissionsSnapshotManager;
  private readonly interceptorManager: SdkCallInterceptorManager;
  private readonly options: IntegTestPermissionsOptions;

  constructor(options: IntegTestPermissionsOptions) {
    this.options = {
      ...options,
      // Check environment variables for overrides
      enabled: options.enabled ?? isPermissionsSnapshotEnabled(),
      updateSnapshot: options.updateSnapshot ?? isSnapshotUpdateEnabled(),
    };

    this.recorder = new PermissionsRecorder({
      includeTimestamps: false,
      includeResources: false,
    });

    this.snapshotManager = new PermissionsSnapshotManager({
      enabled: this.options.enabled,
      failOnChanges: this.options.failOnChanges ?? true,
      updateSnapshot: this.options.updateSnapshot,
      snapshotPath: this.options.snapshotPath,
    });

    this.interceptorManager = new SdkCallInterceptorManager({
      onSdkCall: (action) => this.recorder.recordAction(action),
      onRoleAssumption: (assumption) => this.recorder.recordRoleAssumption(assumption),
      includeTimestamp: false,
    });
  }

  /**
   * Check if permissions snapshot recording is enabled
   */
  public isEnabled(): boolean {
    return this.snapshotManager.isEnabled();
  }

  /**
   * Start recording permissions
   *
   * This should be called before running the integration test.
   * It sets up the SDK interceptor and starts the recorder.
   */
  public startRecording(): void {
    if (!this.isEnabled()) {
      return;
    }

    // Set up global interceptor so all SDK clients are intercepted
    setupGlobalInterceptor({
      onSdkCall: (action) => this.recorder.recordAction(action),
      onRoleAssumption: (assumption) => this.recorder.recordRoleAssumption(assumption),
      includeTimestamp: false,
    });

    this.recorder.startRecording();
  }

  /**
   * Stop recording and validate against the baseline snapshot
   *
   * This should be called after the integration test completes.
   * It creates a snapshot from the recorded permissions and compares
   * it against the baseline snapshot.
   *
   * @returns The validation result
   */
  public stopAndValidate(): PermissionsValidationResult {
    if (!this.isEnabled()) {
      return {
        passed: true,
        snapshot: {
          version: '1.0.0',
          testName: this.options.testName,
          timestamp: new Date().toISOString(),
          actions: [],
          roleAssumptions: [],
          actionSummary: [],
        },
      };
    }

    this.recorder.stopRecording();
    clearGlobalInterceptor();

    const snapshot = this.recorder.createSnapshot({
      testName: this.options.testName,
    });

    const validation = this.snapshotManager.validateSnapshot(
      snapshot,
      this.options.snapshotDir,
    );

    return {
      passed: validation.passed,
      snapshot,
      summary: validation.diff?.summary,
      isNewSnapshot: !validation.diff,
    };
  }

  /**
   * Get the SDK interceptor plugin for manual application to SDK clients
   *
   * Use this if you need to apply the interceptor to specific SDK clients
   * instead of using the global interceptor.
   */
  public getInterceptorPlugin() {
    return this.interceptorManager.getPlugin();
  }

  /**
   * Apply the interceptor to a specific SDK client
   *
   * @param client An AWS SDK v3 client instance
   */
  public applyInterceptorTo(client: { middlewareStack: { use: (plugin: any) => void } }): void {
    this.interceptorManager.applyTo(client);
  }

  /**
   * Get the current recorder instance
   *
   * Useful for inspecting recorded permissions during test execution.
   */
  public getRecorder(): PermissionsRecorder {
    return this.recorder;
  }

  /**
   * Clear all recorded permissions
   *
   * This can be called to reset the recorder between test cases.
   */
  public clearRecordings(): void {
    this.recorder.clear();
  }
}

/**
 * Create a permissions helper with configuration from environment variables
 *
 * @param testName Name of the test case
 * @param snapshotDir Path to the snapshot directory
 */
export function createPermissionsHelper(
  testName: string,
  snapshotDir: string,
): IntegTestPermissionsHelper {
  return new IntegTestPermissionsHelper({
    testName,
    snapshotDir,
    enabled: isPermissionsSnapshotEnabled(),
    updateSnapshot: isSnapshotUpdateEnabled(),
  });
}

/**
 * Decorator-style function for running a test with permissions recording
 *
 * @example
 * ```typescript
 * await withPermissionsRecording(
 *   'my-test',
 *   './integ.my-test.js.snapshot',
 *   async () => {
 *     // Run your integration test here
 *   }
 * );
 * ```
 */
export async function withPermissionsRecording(
  testName: string,
  snapshotDir: string,
  testFn: () => Promise<void>,
): Promise<PermissionsValidationResult> {
  const helper = createPermissionsHelper(testName, snapshotDir);

  helper.startRecording();

  try {
    await testFn();
  } finally {
    // Always stop recording, even if test fails
  }

  return helper.stopAndValidate();
}
