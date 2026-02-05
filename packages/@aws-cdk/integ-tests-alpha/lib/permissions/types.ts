/**
 * Represents an IAM role that was assumed during test execution
 */
export interface AssumedRole {
  /**
   * The ARN of the IAM role that was assumed
   */
  readonly roleArn: string;

  /**
   * The session name used when assuming the role
   */
  readonly sessionName?: string;

  /**
   * ISO 8601 timestamp when the role was assumed
   */
  readonly timestamp: string;
}

/**
 * Represents an IAM action that was performed during test execution
 */
export interface IamAction {
  /**
   * The AWS service (e.g., 's3', 'lambda', 'ec2')
   */
  readonly service: string;

  /**
   * The action performed (e.g., 'PutObject', 'CreateFunction')
   */
  readonly action: string;

  /**
   * ISO 8601 timestamp when the action was performed
   */
  readonly timestamp: string;
}

/**
 * A snapshot of all permissions captured during test execution
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
   * ISO 8601 timestamp when the snapshot was captured
   */
  readonly capturedAt: string;

  /**
   * List of IAM roles that were assumed during test execution
   */
  readonly assumedRoles: AssumedRole[];

  /**
   * List of IAM actions that were performed during test execution
   */
  readonly iamActions: IamAction[];
}
