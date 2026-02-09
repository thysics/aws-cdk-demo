/**
 * Represents a single IAM action performed during test execution.
 */
export interface IamAction {
  /**
   * The AWS service name (e.g., 's3', 'cloudformation', 'sts').
   */
  readonly service: string;

  /**
   * The API action name (e.g., 'PutObject', 'CreateStack', 'AssumeRole').
   */
  readonly action: string;

  /**
   * The timestamp when this action was recorded.
   */
  readonly timestamp: string;
}

/**
 * Represents an IAM role assumption during test execution.
 */
export interface RoleAssumption {
  /**
   * The ARN of the role that was assumed.
   */
  readonly roleArn: string;

  /**
   * The session name used for the role assumption.
   */
  readonly sessionName: string;

  /**
   * The timestamp when this role was assumed.
   */
  readonly timestamp: string;
}

/**
 * The complete permissions snapshot for a single test.
 */
export interface PermissionsSnapshot {
  /**
   * The name of the integration test.
   */
  readonly testName: string;

  /**
   * The timestamp when this snapshot was created.
   */
  readonly createdAt: string;

  /**
   * List of unique IAM actions performed during the test.
   * Actions are deduplicated by service + action combination.
   */
  readonly actions: IamAction[];

  /**
   * List of IAM roles assumed during the test.
   */
  readonly roleAssumptions: RoleAssumption[];

  /**
   * A sorted list of unique permission strings (service:action format).
   * This is the primary comparison key for snapshot testing.
   */
  readonly permissions: string[];
}

/**
 * Options for the permissions snapshot recorder.
 */
export interface PermissionsSnapshotRecorderOptions {
  /**
   * The name of the test being recorded.
   */
  readonly testName: string;

  /**
   * The directory where snapshot files will be stored.
   * @default - the current working directory
   */
  readonly snapshotDirectory?: string;

  /**
   * Whether to fail the test if the snapshot doesn't match.
   * @default true
   */
  readonly failOnMismatch?: boolean;

  /**
   * Whether to update the snapshot if it doesn't match.
   * @default false
   */
  readonly updateSnapshots?: boolean;
}

/**
 * Result of a snapshot comparison.
 */
export interface SnapshotComparisonResult {
  /**
   * Whether the snapshots match.
   */
  readonly match: boolean;

  /**
   * Actions that were added (present in current but not in expected).
   */
  readonly addedActions: string[];

  /**
   * Actions that were removed (present in expected but not in current).
   */
  readonly removedActions: string[];

  /**
   * Role assumptions that were added.
   */
  readonly addedRoleAssumptions: RoleAssumption[];

  /**
   * Role assumptions that were removed.
   */
  readonly removedRoleAssumptions: RoleAssumption[];
}
