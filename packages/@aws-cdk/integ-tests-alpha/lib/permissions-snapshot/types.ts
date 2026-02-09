/**
 * Represents a recorded IAM action during test execution
 */
export interface RecordedAction {
  /**
   * The AWS service name (e.g., 's3', 'lambda', 'sts')
   */
  readonly service: string;

  /**
   * The API action name (e.g., 'PutObject', 'Invoke', 'AssumeRole')
   */
  readonly action: string;

  /**
   * Optional resource ARN if available
   */
  readonly resource?: string;

  /**
   * Timestamp when the action was recorded
   */
  readonly timestamp: string;
}

/**
 * Represents a recorded IAM role assumption
 */
export interface RecordedRoleAssumption {
  /**
   * The ARN of the role that was assumed
   */
  readonly roleArn: string;

  /**
   * The role session name used
   */
  readonly roleSessionName?: string;

  /**
   * The source identity if available
   */
  readonly sourceIdentity?: string;

  /**
   * Timestamp when the role was assumed
   */
  readonly timestamp: string;
}

/**
 * The complete permissions snapshot for a test
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
  readonly createdAt: string;

  /**
   * All IAM actions recorded during the test
   */
  readonly actions: RecordedAction[];

  /**
   * All role assumptions recorded during the test
   */
  readonly roleAssumptions: RecordedRoleAssumption[];

  /**
   * Summary of unique service/action combinations
   */
  readonly actionSummary: ActionSummary[];
}

/**
 * Summary of a unique service/action combination
 */
export interface ActionSummary {
  /**
   * The AWS service name
   */
  readonly service: string;

  /**
   * The API action name
   */
  readonly action: string;

  /**
   * Number of times this action was called
   */
  readonly count: number;
}

/**
 * Options for permissions snapshot tracking
 */
export interface PermissionsSnapshotOptions {
  /**
   * Enable recording of all AWS SDK calls
   * @default true
   */
  readonly recordActions?: boolean;

  /**
   * Enable recording of role assumptions
   * @default true
   */
  readonly recordRoleAssumptions?: boolean;

  /**
   * Path to store/compare snapshot files
   * If not provided, defaults to test snapshot directory
   */
  readonly snapshotPath?: string;

  /**
   * Whether to update the snapshot instead of comparing
   * @default false
   */
  readonly updateSnapshot?: boolean;

  /**
   * Whether to fail the test if the snapshot changes
   * @default true
   */
  readonly failOnChange?: boolean;

  /**
   * Actions to ignore when comparing snapshots
   * Format: "service:action" (e.g., "sts:GetCallerIdentity")
   */
  readonly ignoreActions?: string[];

  /**
   * Roles to ignore when comparing snapshots
   */
  readonly ignoreRoles?: string[];
}

/**
 * Result of a snapshot comparison
 */
export interface SnapshotComparisonResult {
  /**
   * Whether the snapshots match
   */
  readonly matches: boolean;

  /**
   * Actions that were added (in new but not in baseline)
   */
  readonly addedActions: RecordedAction[];

  /**
   * Actions that were removed (in baseline but not in new)
   */
  readonly removedActions: ActionSummary[];

  /**
   * Role assumptions that were added
   */
  readonly addedRoleAssumptions: RecordedRoleAssumption[];

  /**
   * Role assumptions that were removed
   */
  readonly removedRoleAssumptions: RecordedRoleAssumption[];

  /**
   * Human-readable diff message
   */
  readonly diffMessage?: string;
}

/**
 * Current snapshot format version
 */
export const PERMISSIONS_SNAPSHOT_VERSION = '1.0';
