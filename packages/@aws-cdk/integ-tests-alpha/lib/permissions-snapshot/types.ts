/**
 * Type definitions for permissions snapshot tracking
 */

/**
 * Represents a recorded IAM action
 */
export interface RecordedAction {
  /**
   * The AWS service name (e.g., 's3', 'sts', 'cloudformation')
   */
  readonly service: string;

  /**
   * The API action name (e.g., 'GetObject', 'AssumeRole', 'CreateStack')
   */
  readonly action: string;
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
   * The session name used for the role assumption
   *
   * @default - not recorded
   */
  readonly sessionName?: string;

  /**
   * The external ID used for the role assumption, if any
   *
   * @default - no external ID
   */
  readonly externalId?: string;
}

/**
 * Aggregated action with count
 */
export interface AggregatedAction {
  /**
   * The AWS service name
   */
  readonly service: string;

  /**
   * The API action name
   */
  readonly action: string;

  /**
   * Number of times this action was performed
   */
  readonly count: number;
}

/**
 * The format of the permissions snapshot file
 */
export interface PermissionsSnapshot {
  /**
   * Version of the snapshot format
   */
  readonly version: string;

  /**
   * Timestamp when the snapshot was created
   */
  readonly timestamp: string;

  /**
   * Name of the test that generated this snapshot
   */
  readonly testName: string;

  /**
   * List of roles that were assumed during the test
   */
  readonly roles: RoleAssumption[];

  /**
   * Aggregated list of actions performed during the test
   */
  readonly actions: AggregatedAction[];
}

/**
 * Options for permissions tracking
 */
export interface PermissionsTrackingOptions {
  /**
   * Name of the test being run
   */
  readonly testName: string;

  /**
   * Whether to track detailed parameters for each action
   *
   * @default false
   */
  readonly trackParameters?: boolean;

  /**
   * List of services to exclude from tracking
   *
   * @default - no services excluded
   */
  readonly excludeServices?: string[];

  /**
   * List of actions to exclude from tracking (format: 'service:action')
   *
   * @default - no actions excluded
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
  readonly matches: boolean;

  /**
   * List of roles that were added (present in new but not in existing)
   */
  readonly addedRoles: RoleAssumption[];

  /**
   * List of roles that were removed (present in existing but not in new)
   */
  readonly removedRoles: RoleAssumption[];

  /**
   * List of actions that were added
   */
  readonly addedActions: AggregatedAction[];

  /**
   * List of actions that were removed
   */
  readonly removedActions: AggregatedAction[];

  /**
   * Human-readable summary of the differences
   */
  readonly summary: string;
}
