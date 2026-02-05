/**
 * Type definitions for permission tracking.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

/**
 * Represents a single recorded permission event.
 */
export interface PermissionRecord {
  /**
   * ISO 8601 timestamp when the call was made.
   */
  timestamp: string;

  /**
   * AWS service name (lowercase), e.g., 's3', 'lambda', 'sts'.
   */
  service: string;

  /**
   * AWS action name, e.g., 'GetObject', 'InvokeFunction'.
   */
  action: string;

  /**
   * The IAM role ARN if this was an assume role call or if the call was made with an assumed role.
   */
  roleArn?: string;

  /**
   * AWS region where the call was made.
   */
  region?: string;
}

/**
 * Represents a snapshot of permissions for deterministic comparison.
 */
export interface PermissionSnapshot {
  /**
   * Schema version for forward compatibility.
   */
  version: string;

  /**
   * List of unique role ARNs that were assumed during the test.
   */
  roles: string[];

  /**
   * Map of service names to their unique actions.
   * Keys are service names (e.g., 's3', 'lambda').
   * Values are arrays of action names (e.g., ['GetObject', 'PutObject']).
   */
  actions: Record<string, string[]>;
}

/**
 * Configuration options for the permission tracker.
 */
export interface PermissionTrackerOptions {
  /**
   * Whether to include timestamps in permission records.
   * @default false
   */
  includeTimestamps?: boolean;

  /**
   * Whether to include region information in permission records.
   * @default true
   */
  includeRegion?: boolean;
}

/**
 * Options for creating a permission snapshot.
 */
export interface SnapshotOptions {
  /**
   * Schema version to use for the snapshot.
   * @default '1.0'
   */
  version?: string;
}
