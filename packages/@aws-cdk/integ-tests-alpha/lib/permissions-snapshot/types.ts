/**
 * Represents a recorded IAM action during test execution
 */
export interface RecordedIamAction {
  /**
   * The AWS service name (e.g., 's3', 'lambda', 'cloudformation')
   */
  readonly service: string;

  /**
   * The API action name (e.g., 'PutObject', 'CreateFunction')
   */
  readonly action: string;

  /**
   * Optional resource ARN(s) associated with this action
   */
  readonly resources?: string[];
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
   * The session name used for the assumption
   */
  readonly sessionName?: string;

  /**
   * Optional external ID if provided
   */
  readonly externalId?: string;
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
   * Timestamp when the snapshot was created
   */
  readonly timestamp?: string;

  /**
   * Name of the test that generated this snapshot
   */
  readonly testName?: string;

  /**
   * List of IAM roles that were assumed during test execution
   */
  readonly assumedRoles: RecordedRoleAssumption[];

  /**
   * List of IAM actions that were performed during test execution
   * Sorted by service and action for deterministic comparison
   */
  readonly iamActions: RecordedIamAction[];
}

/**
 * Options for creating a permissions snapshot recorder
 */
export interface PermissionsRecorderOptions {
  /**
   * Whether to include resource ARNs in the snapshot
   * Note: Resource ARNs may contain account-specific information
   * 
   * @default false
   */
  readonly includeResourceArns?: boolean;

  /**
   * Whether to include timestamps in the snapshot
   * Setting to false enables deterministic comparison
   * 
   * @default false
   */
  readonly includeTimestamps?: boolean;

  /**
   * Services to exclude from recording
   * Useful for excluding noisy services like CloudWatch Logs
   * 
   * @default []
   */
  readonly excludeServices?: string[];

  /**
   * Specific actions to exclude from recording
   * Format: 'service:action' (e.g., 'logs:CreateLogStream')
   * 
   * @default []
   */
  readonly excludeActions?: string[];
}

/**
 * Result of comparing two permissions snapshots
 */
export interface SnapshotComparisonResult {
  /**
   * Whether the snapshots match
   */
  readonly matches: boolean;

  /**
   * IAM actions that are in the actual snapshot but not in the expected
   */
  readonly addedActions: RecordedIamAction[];

  /**
   * IAM actions that are in the expected snapshot but not in the actual
   */
  readonly removedActions: RecordedIamAction[];

  /**
   * Roles that are in the actual snapshot but not in the expected
   */
  readonly addedRoles: RecordedRoleAssumption[];

  /**
   * Roles that are in the expected snapshot but not in the actual
   */
  readonly removedRoles: RecordedRoleAssumption[];
}

/**
 * Options for snapshot comparison
 */
export interface SnapshotComparisonOptions {
  /**
   * Whether to ignore differences in resource ARNs
   * Useful when ARNs contain dynamic values like account IDs
   * 
   * @default true
   */
  readonly ignoreResourceArns?: boolean;

  /**
   * Whether to allow additional actions not in the expected snapshot
   * Useful when the test may perform additional setup actions
   * 
   * @default false
   */
  readonly allowAdditionalActions?: boolean;

  /**
   * Whether to allow additional roles not in the expected snapshot
   * 
   * @default false
   */
  readonly allowAdditionalRoles?: boolean;
}
