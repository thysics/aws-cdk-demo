/**
 * TypeScript interfaces for permissions tracking.
 *
 * This module defines the core types used throughout the permissions-snapshot package
 * to represent recorded AWS API actions and assumed IAM roles.
 */

/**
 * Represents a single recorded AWS API action.
 *
 * @example
 * ```typescript
 * const action: RecordedAction = {
 *   service: 's3',
 *   action: 'PutObject',
 * };
 * ```
 */
export interface RecordedAction {
  /**
   * The AWS service name in lowercase (e.g., 's3', 'lambda', 'sts').
   * This is typically derived from the SDK client being used.
   */
  readonly service: string;

  /**
   * The API action name (e.g., 'PutObject', 'CreateFunction', 'AssumeRole').
   * This is derived from the SDK command being executed.
   */
  readonly action: string;
}

/**
 * Represents a recorded IAM role that was assumed during execution.
 *
 * @example
 * ```typescript
 * const role: RecordedRole = {
 *   roleArn: 'arn:aws:iam::123456789012:role/MyRole',
 *   assumedVia: 'AssumeRole',
 * };
 * ```
 */
export interface RecordedRole {
  /**
   * The ARN of the IAM role that was assumed.
   */
  readonly roleArn: string;

  /**
   * The STS operation used to assume the role.
   * One of: 'AssumeRole', 'AssumeRoleWithSAML', 'AssumeRoleWithWebIdentity'.
   */
  readonly assumedVia: 'AssumeRole' | 'AssumeRoleWithSAML' | 'AssumeRoleWithWebIdentity';
}

/**
 * A complete snapshot of all permissions used during a tracked operation.
 *
 * This is the main data structure returned by the PermissionsTracker and
 * stored in snapshot files.
 *
 * @example
 * ```typescript
 * const snapshot: PermissionsSnapshot = {
 *   actions: [
 *     { service: 's3', action: 'PutObject' },
 *     { service: 's3', action: 'GetObject' },
 *   ],
 *   assumedRoles: [
 *     { roleArn: 'arn:aws:iam::123456789012:role/DeployRole', assumedVia: 'AssumeRole' },
 *   ],
 * };
 * ```
 */
export interface PermissionsSnapshot {
  /**
   * Array of all unique AWS API actions that were invoked.
   * Actions are deduplicated by service+action combination.
   */
  readonly actions: RecordedAction[];

  /**
   * Array of all unique IAM roles that were assumed.
   * Roles are deduplicated by roleArn.
   */
  readonly assumedRoles: RecordedRole[];
}

/**
 * Options for configuring the permissions tracker.
 */
export interface PermissionsTrackerOptions {
  /**
   * Services to exclude from tracking.
   * Useful for excluding noisy services like CloudWatch Logs.
   *
   * @default - All services are tracked
   */
  readonly excludeServices?: string[];

  /**
   * Specific service:action combinations to exclude from tracking.
   * Format: 'service:action' (e.g., 'logs:CreateLogGroup')
   *
   * @default - All actions are tracked
   */
  readonly excludeActions?: string[];
}
