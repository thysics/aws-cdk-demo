/**
 * Represents a recorded IAM action performed during test execution
 */
export interface RecordedAction {
  /**
   * The AWS service name (e.g., 's3', 'cloudformation', 'sts')
   */
  readonly service: string;

  /**
   * The API action performed (e.g., 'PutObject', 'CreateStack', 'AssumeRole')
   */
  readonly action: string;

  /**
   * Resource ARN(s) affected by this action, if available
   */
  readonly resources?: string[];

  /**
   * The IAM action string (e.g., 's3:PutObject')
   */
  readonly iamAction: string;
}

/**
 * Represents a role assumption event
 */
export interface RoleAssumption {
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
  readonly timestamp: string;
}

/**
 * A permissions snapshot containing all IAM actions and role assumptions
 * recorded during a test execution
 */
export interface PermissionsSnapshot {
  /**
   * Version of the snapshot format
   */
  readonly version: string;

  /**
   * Name of the test that generated this snapshot
   */
  readonly testName: string;

  /**
   * Timestamp when the snapshot was generated
   */
  readonly timestamp: string;

  /**
   * All unique IAM actions performed during the test
   * Actions are sorted alphabetically for deterministic comparison
   */
  readonly actions: RecordedAction[];

  /**
   * All role assumptions that occurred during the test
   */
  readonly roleAssumptions: RoleAssumption[];

  /**
   * Summary statistics
   */
  readonly summary: PermissionsSummary;
}

/**
 * Summary statistics for a permissions snapshot
 */
export interface PermissionsSummary {
  /**
   * Total number of unique IAM actions
   */
  readonly totalActions: number;

  /**
   * Total number of role assumptions
   */
  readonly totalRoleAssumptions: number;

  /**
   * Unique services accessed
   */
  readonly services: string[];
}

/**
 * Result of comparing two permission snapshots
 */
export interface SnapshotComparisonResult {
  /**
   * Whether the snapshots match
   */
  readonly match: boolean;

  /**
   * Actions that are new (in current but not in baseline)
   */
  readonly addedActions: RecordedAction[];

  /**
   * Actions that were removed (in baseline but not in current)
   */
  readonly removedActions: RecordedAction[];

  /**
   * Role assumptions that are new
   */
  readonly addedRoleAssumptions: RoleAssumption[];

  /**
   * Role assumptions that were removed
   */
  readonly removedRoleAssumptions: RoleAssumption[];

  /**
   * Human-readable diff message
   */
  readonly diffMessage: string;
}

/**
 * Options for the permissions recorder
 */
export interface PermissionsRecorderOptions {
  /**
   * Name of the test being recorded
   */
  readonly testName: string;

  /**
   * Path to store the snapshot file
   */
  readonly snapshotPath?: string;

  /**
   * Whether to update the snapshot if it differs
   * 
   * @default false
   */
  readonly updateSnapshot?: boolean;

  /**
   * Whether to include resource ARNs in the snapshot
   * Note: This may cause snapshots to change frequently if resources
   * have dynamic names
   * 
   * @default false
   */
  readonly includeResources?: boolean;

  /**
   * Patterns for services to exclude from recording
   * 
   * @default - no exclusions
   */
  readonly excludeServices?: string[];

  /**
   * Patterns for actions to exclude from recording
   * 
   * @default - no exclusions
   */
  readonly excludeActions?: string[];
}

/**
 * Configuration for snapshot assertion behavior
 */
export interface SnapshotAssertOptions {
  /**
   * If true, update the snapshot file instead of failing
   */
  readonly updateSnapshot?: boolean;

  /**
   * Custom message to include in failure output
   */
  readonly failureMessage?: string;
}
