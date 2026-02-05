/**
 * Type definitions for permissions snapshot functionality
 */

/**
 * Represents a single IAM action recorded during test execution
 */
export interface RecordedIamAction {
  /**
   * The AWS service name (e.g., 's3', 'cloudformation', 'sts')
   */
  readonly service: string;

  /**
   * The API action name (e.g., 'PutObject', 'CreateStack', 'AssumeRole')
   */
  readonly action: string;

  /**
   * Optional resource ARNs that were accessed
   */
  readonly resources?: string[];

  /**
   * Timestamp when the action was recorded
   */
  readonly timestamp?: string;
}

/**
 * Represents an IAM role assumption recorded during test execution
 */
export interface RecordedRoleAssumption {
  /**
   * The ARN of the role that was assumed
   */
  readonly roleArn: string;

  /**
   * The session name used for the assumption
   */
  readonly sessionName?: string;

  /**
   * Timestamp when the role was assumed
   */
  readonly timestamp?: string;

  /**
   * The principal that assumed the role (if known)
   */
  readonly assumedBy?: string;
}

/**
 * The permissions snapshot recorded during a test execution
 */
export interface PermissionsSnapshot {
  /**
   * Version of the snapshot format
   */
  readonly version: string;

  /**
   * Name of the test case
   */
  readonly testName: string;

  /**
   * Timestamp when the snapshot was created
   */
  readonly timestamp: string;

  /**
   * All IAM actions recorded during the test
   * Sorted and deduplicated for consistent comparison
   */
  readonly actions: RecordedIamAction[];

  /**
   * All IAM roles assumed during the test
   * Sorted and deduplicated for consistent comparison
   */
  readonly roleAssumptions: RecordedRoleAssumption[];

  /**
   * Summary of unique service:action pairs for quick reference
   */
  readonly actionSummary: string[];
}

/**
 * Options for creating a permissions snapshot
 */
export interface PermissionsSnapshotOptions {
  /**
   * The name of the test case
   */
  readonly testName: string;

  /**
   * Whether to include timestamps in the snapshot
   * Set to false for deterministic snapshots
   *
   * @default false
   */
  readonly includeTimestamps?: boolean;

  /**
   * Whether to include resource ARNs in the snapshot
   * Resource ARNs may contain account-specific information
   *
   * @default false
   */
  readonly includeResources?: boolean;
}

/**
 * Result of comparing two permissions snapshots
 */
export interface PermissionsSnapshotDiff {
  /**
   * Whether there are any differences
   */
  readonly hasDifferences: boolean;

  /**
   * New actions that were not in the baseline snapshot
   */
  readonly addedActions: RecordedIamAction[];

  /**
   * Actions that were in the baseline but not in the current snapshot
   */
  readonly removedActions: RecordedIamAction[];

  /**
   * New role assumptions that were not in the baseline
   */
  readonly addedRoleAssumptions: RecordedRoleAssumption[];

  /**
   * Role assumptions that were in the baseline but not in the current
   */
  readonly removedRoleAssumptions: RecordedRoleAssumption[];

  /**
   * Human-readable summary of the differences
   */
  readonly summary: string;
}

/**
 * Configuration for the permissions snapshot feature
 */
export interface PermissionsSnapshotConfig {
  /**
   * Whether permissions snapshot recording is enabled
   *
   * @default false
   */
  readonly enabled?: boolean;

  /**
   * Whether to fail the test if the snapshot has changes
   *
   * @default true
   */
  readonly failOnChanges?: boolean;

  /**
   * Path to the snapshot file (relative to the test file)
   *
   * @default - uses default naming convention
   */
  readonly snapshotPath?: string;

  /**
   * Whether to automatically update the snapshot on changes
   * Useful during development
   *
   * @default false
   */
  readonly updateSnapshot?: boolean;
}

/**
 * Current version of the permissions snapshot format
 */
export const PERMISSIONS_SNAPSHOT_VERSION = '1.0.0';
