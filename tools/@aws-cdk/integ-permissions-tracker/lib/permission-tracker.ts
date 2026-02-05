/**
 * Permission tracker for recording AWS SDK API calls.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import {
  PermissionRecord,
  PermissionSnapshot,
  PermissionTrackerOptions,
  SnapshotOptions,
} from './types';

/**
 * Singleton class that collects and manages permission records.
 *
 * The PermissionTracker records AWS API calls made during integration tests,
 * allowing for deterministic snapshots of permissions to be generated and compared.
 *
 * @example
 * ```typescript
 * // get the singleton instance
 * const tracker = PermissionTracker.getInstance();
 *
 * // record a call
 * tracker.recordCall('s3', 'GetObject', { region: 'us-east-1' });
 *
 * // record a role assumption
 * tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/MyRole');
 *
 * // get the snapshot
 * const snapshot = tracker.getSnapshot();
 *
 * // clear for next test
 * tracker.clear();
 * ```
 */
export class PermissionTracker {
  private static instance: PermissionTracker | undefined;

  private records: PermissionRecord[] = [];
  private assumedRoles: Set<string> = new Set();
  private options: Required<PermissionTrackerOptions>;

  /**
   * Creates a new PermissionTracker instance.
   *
   * @param options - configuration options for the tracker.
   */
  private constructor(options: PermissionTrackerOptions = {}) {
    this.options = {
      includeTimestamps: options.includeTimestamps ?? false,
      includeRegion: options.includeRegion ?? true,
    };
  }

  /**
   * Gets the singleton instance of the PermissionTracker.
   *
   * @param options - optional configuration options (only used on first call).
   * @returns the singleton PermissionTracker instance.
   */
  public static getInstance(options?: PermissionTrackerOptions): PermissionTracker {
    if (!PermissionTracker.instance) {
      PermissionTracker.instance = new PermissionTracker(options);
    }
    return PermissionTracker.instance;
  }

  /**
   * Resets the singleton instance. Primarily for testing purposes.
   */
  public static resetInstance(): void {
    PermissionTracker.instance = undefined;
  }

  /**
   * Records an AWS API call.
   *
   * @param service - the AWS service name (e.g., 's3', 'lambda').
   * @param action - the action name (e.g., 'GetObject', 'InvokeFunction').
   * @param metadata - optional metadata about the call.
   */
  public recordCall(
    service: string,
    action: string,
    metadata?: { roleArn?: string; region?: string }
  ): void {
    const record: PermissionRecord = {
      timestamp: new Date().toISOString(),
      service: service.toLowerCase(),
      action,
      ...(metadata?.roleArn && { roleArn: metadata.roleArn }),
      ...(this.options.includeRegion && metadata?.region && { region: metadata.region }),
    };
    this.records.push(record);
  }

  /**
   * Records an IAM role assumption.
   *
   * @param roleArn - the ARN of the assumed role.
   */
  public recordRoleAssumption(roleArn: string): void {
    this.assumedRoles.add(roleArn);
    this.recordCall('sts', 'AssumeRole', { roleArn });
  }

  /**
   * Gets all recorded permission records.
   *
   * @returns a copy of all permission records.
   */
  public getRecords(): PermissionRecord[] {
    return [...this.records];
  }

  /**
   * Gets all assumed role ARNs.
   *
   * @returns a copy of all assumed role ARNs.
   */
  public getAssumedRoles(): string[] {
    return Array.from(this.assumedRoles).sort();
  }

  /**
   * Generates a deterministic permission snapshot.
   *
   * The snapshot contains deduplicated, sorted lists of roles and actions,
   * ensuring that the same permissions always produce identical output.
   *
   * @param options - optional snapshot configuration.
   * @returns a permission snapshot.
   */
  public getSnapshot(options?: SnapshotOptions): PermissionSnapshot {
    const version = options?.version ?? '1.0';

    // collect unique actions per service
    const actionsMap = new Map<string, Set<string>>();
    for (const record of this.records) {
      const existing = actionsMap.get(record.service) ?? new Set<string>();
      existing.add(record.action);
      actionsMap.set(record.service, existing);
    }

    // convert to sorted, deterministic format
    const actions: Record<string, string[]> = {};
    const sortedServices = Array.from(actionsMap.keys()).sort();
    for (const service of sortedServices) {
      const serviceActions = actionsMap.get(service)!;
      actions[service] = Array.from(serviceActions).sort();
    }

    return {
      version,
      roles: Array.from(this.assumedRoles).sort(),
      actions,
    };
  }

  /**
   * Clears all recorded permissions and assumed roles.
   */
  public clear(): void {
    this.records = [];
    this.assumedRoles.clear();
  }

  /**
   * Returns the number of recorded calls.
   *
   * @returns the number of permission records.
   */
  public get recordCount(): number {
    return this.records.length;
  }

  /**
   * Returns whether any permissions have been recorded.
   *
   * @returns true if no permissions have been recorded.
   */
  public get isEmpty(): boolean {
    return this.records.length === 0 && this.assumedRoles.size === 0;
  }
}
