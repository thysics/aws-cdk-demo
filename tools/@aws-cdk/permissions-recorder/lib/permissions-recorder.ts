import type { Pluggable } from '@smithy/types';
import { createPermissionsMiddleware } from './middleware';
import { PermissionsSnapshot, SNAPSHOT_VERSION } from './types';

export { PermissionsSnapshot };

/**
 * Records AWS SDK v3 API calls and assumed roles during test execution.
 *
 * This class provides:
 * - A middleware that intercepts AWS SDK v3 calls
 * - Tracking of service:action combinations with call counts
 * - Special handling for STS AssumeRole to capture role ARNs
 * - Snapshot generation for permissions testing
 *
 * @example
 * ```typescript
 * import { PermissionsRecorder } from '@aws-cdk/permissions-recorder';
 * import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
 *
 * const recorder = PermissionsRecorder.globalInstance;
 * const client = new S3Client({});
 * client.middlewareStack.use(recorder.createMiddleware());
 *
 * await client.send(new ListBucketsCommand({}));
 *
 * const snapshot = recorder.getSnapshot();
 * // { version: "1.0", roles: [], actions: { "s3:ListBuckets": 1 } }
 * ```
 */
export class PermissionsRecorder {
  /**
   * Singleton instance for global access
   */
  private static _globalInstance: PermissionsRecorder | undefined;

  /**
   * Get the global singleton instance of the recorder
   */
  public static get globalInstance(): PermissionsRecorder {
    if (!PermissionsRecorder._globalInstance) {
      PermissionsRecorder._globalInstance = new PermissionsRecorder();
    }
    return PermissionsRecorder._globalInstance;
  }

  /**
   * Reset the global instance (useful for testing)
   */
  public static resetGlobalInstance(): void {
    PermissionsRecorder._globalInstance = undefined;
  }

  /**
   * Set of IAM role ARNs that were assumed
   */
  public readonly recordedRoles: Set<string> = new Set();

  /**
   * Map of service:action to call count
   */
  public readonly recordedActions: Map<string, number> = new Map();

  /**
   * Whether recording is currently active
   */
  private _isRecording = true;

  /**
   * Creates a new PermissionsRecorder instance
   */
  constructor() {
    // Instance is ready to record immediately
  }

  /**
   * Check if recording is active
   */
  public get isRecording(): boolean {
    return this._isRecording;
  }

  /**
   * Start recording (recording is enabled by default)
   */
  public start(): void {
    this._isRecording = true;
  }

  /**
   * Stop recording
   */
  public stop(): void {
    this._isRecording = false;
  }

  /**
   * Get the recorded permissions as a JSON-serializable snapshot
   *
   * The snapshot is deterministically sorted:
   * - Roles are sorted alphabetically
   * - Actions are sorted by key (service:action)
   */
  public getSnapshot(): PermissionsSnapshot {
    // Sort roles alphabetically
    const sortedRoles = Array.from(this.recordedRoles).sort();

    // Sort actions by key and convert to object
    const sortedActionEntries = Array.from(this.recordedActions.entries()).sort(([a], [b]) => a.localeCompare(b));
    const sortedActions: Record<string, number> = {};
    for (const [key, count] of sortedActionEntries) {
      sortedActions[key] = count;
    }

    return {
      version: SNAPSHOT_VERSION,
      roles: sortedRoles,
      actions: sortedActions,
    };
  }

  /**
   * Get the recorded permissions data (alias for getSnapshot)
   */
  public getRecordedPermissions(): PermissionsSnapshot {
    return this.getSnapshot();
  }

  /**
   * Reset all recorded data
   */
  public reset(): void {
    this.recordedRoles.clear();
    this.recordedActions.clear();
  }

  /**
   * Record an action call
   */
  private recordAction(service: string, action: string): void {
    if (!this._isRecording) {
      return;
    }

    const key = `${service}:${action}`;
    const currentCount = this.recordedActions.get(key) || 0;
    this.recordedActions.set(key, currentCount + 1);
  }

  /**
   * Record an assumed role
   */
  private recordRole(roleArn: string): void {
    if (!this._isRecording) {
      return;
    }

    this.recordedRoles.add(roleArn);
  }

  /**
   * Create AWS SDK v3 middleware for recording permissions
   *
   * Apply this middleware to any AWS SDK v3 client to record its API calls.
   *
   * @example
   * ```typescript
   * const client = new S3Client({});
   * client.middlewareStack.use(recorder.createMiddleware());
   * ```
   */
  public createMiddleware(): Pluggable<object, object> {
    return createPermissionsMiddleware({
      onAction: (service, action) => this.recordAction(service, action),
      onAssumeRole: (roleArn) => this.recordRole(roleArn),
    });
  }

  /**
   * Helper to apply middleware to an existing client
   *
   * @param client Any AWS SDK v3 client with a middlewareStack
   */
  public applyToClient<T extends { middlewareStack: { use: (plugin: Pluggable<object, object>) => void } }>(client: T): T {
    client.middlewareStack.use(this.createMiddleware());
    return client;
  }
}
