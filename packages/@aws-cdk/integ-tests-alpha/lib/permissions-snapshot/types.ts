/**
 * Type definitions for the permissions snapshot module
 */

/**
 * Represents a single IAM action that was performed
 */
export interface IamAction {
  /**
   * The AWS service that was called (e.g., 's3', 'ec2', 'cloudformation')
   */
  readonly service: string;

  /**
   * The action that was performed (e.g., 'PutObject', 'DescribeInstances')
   */
  readonly action: string;

  /**
   * Optional resource ARN(s) that the action was performed on
   */
  readonly resources?: string[];
}

/**
 * Represents an IAM role that was assumed
 */
export interface AssumedRole {
  /**
   * The ARN of the role that was assumed
   */
  readonly roleArn: string;

  /**
   * The session name used when assuming the role
   */
  readonly sessionName?: string;

  /**
   * The timestamp when the role was assumed
   */
  readonly timestamp?: string;
}

/**
 * The complete permissions snapshot for a test
 */
export interface PermissionsSnapshot {
  /**
   * Version of the snapshot format for future compatibility
   */
  readonly version: string;

  /**
   * Name of the test this snapshot belongs to
   */
  readonly testName: string;

  /**
   * Timestamp when the snapshot was created
   */
  readonly createdAt: string;

  /**
   * List of all IAM actions performed during the test
   * Sorted alphabetically by service:action for consistent comparison
   */
  readonly actions: IamAction[];

  /**
   * List of all IAM roles assumed during the test
   * Sorted by roleArn for consistent comparison
   */
  readonly assumedRoles: AssumedRole[];
}

/**
 * Options for the permissions snapshot recorder
 */
export interface PermissionsSnapshotRecorderOptions {
  /**
   * The name of the test being recorded
   */
  readonly testName: string;

  /**
   * Directory where snapshots will be saved
   * @default - current working directory + '.permissions-snapshots'
   */
  readonly snapshotDirectory?: string;

  /**
   * Whether to capture resource ARNs in the snapshot
   * Note: Resource ARNs may contain account-specific information
   * @default false
   */
  readonly captureResources?: boolean;

  /**
   * Services to exclude from recording
   * Useful for filtering out noisy services like STS token refresh
   * @default []
   */
  readonly excludeServices?: string[];

  /**
   * Actions to exclude from recording
   * Format: 'service:action' (e.g., 'sts:GetCallerIdentity')
   * @default []
   */
  readonly excludeActions?: string[];
}

/**
 * Result of comparing two snapshots
 */
export interface SnapshotComparisonResult {
  /**
   * Whether the snapshots match
   */
  readonly match: boolean;

  /**
   * Actions that are in the new snapshot but not in the baseline
   */
  readonly addedActions: IamAction[];

  /**
   * Actions that are in the baseline but not in the new snapshot
   */
  readonly removedActions: IamAction[];

  /**
   * Roles that are in the new snapshot but not in the baseline
   */
  readonly addedRoles: AssumedRole[];

  /**
   * Roles that are in the baseline but not in the new snapshot
   */
  readonly removedRoles: AssumedRole[];

  /**
   * Human-readable diff summary
   */
  readonly summary: string;
}

/**
 * Options for snapshot comparison
 */
export interface SnapshotComparisonOptions {
  /**
   * Whether to ignore timestamp differences
   * @default true
   */
  readonly ignoreTimestamps?: boolean;

  /**
   * Whether to ignore resource ARN differences
   * @default true
   */
  readonly ignoreResources?: boolean;
}
