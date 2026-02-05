/**
 * Type definitions for the AWS SDK v3 Permissions Tracker.
 *
 * This module contains all the interfaces and types used by the permissions
 * tracking system, including:
 *
 * - {@link CapturedApiCall} - Individual API call records
 * - {@link AssumedRole} - STS AssumeRole call details
 * - {@link RoleChain} - Sequence of role assumptions
 * - {@link PermissionsMiddlewareOptions} - Configuration for the middleware
 * - {@link CollectedPermissions} - Aggregated permissions data
 *
 * @module types
 */

/**
 * Represents a single API call captured by the middleware.
 *
 * Each API call made through an AWS SDK client with the permissions middleware
 * attached will generate a CapturedApiCall record containing details about
 * the service, action, and context of the call.
 *
 * @example
 * ```typescript
 * const call: CapturedApiCall = {
 *   service: 's3',
 *   action: 'GetObject',
 *   region: 'us-east-1',
 *   account: '123456789012',
 *   timestamp: new Date(),
 *   principal: 'arn:aws:iam::123456789012:role/MyRole'
 * };
 * ```
 */
export interface CapturedApiCall {
  /**
   * The AWS service name in lowercase (e.g., 's3', 'sts', 'cloudformation').
   * This is derived from the SDK client name.
   */
  service: string;

  /**
   * The API action name (e.g., 'GetObject', 'AssumeRole', 'CreateStack').
   * This is derived from the SDK command name.
   */
  action: string;

  /**
   * The AWS region where the call was made (e.g., 'us-east-1').
   * May be undefined if the region cannot be determined from the request.
   */
  region?: string;

  /**
   * The AWS account ID associated with the call.
   * May be undefined if not available in the request context.
   */
  account?: string;

  /**
   * Timestamp when the API call was made.
   */
  timestamp: Date;

  /**
   * The IAM principal (role ARN or user ARN) that made this call.
   * This is tracked through the role chain to show the effective identity.
   */
  principal?: string;
}

/**
 * Represents an STS AssumeRole call with detailed session information.
 *
 * When the middleware intercepts an STS AssumeRole call, it creates an
 * AssumedRole record to track the role chain and maintain context about
 * which identity made subsequent calls.
 *
 * @example
 * ```typescript
 * const assumedRole: AssumedRole = {
 *   roleArn: 'arn:aws:iam::123456789012:role/DeployRole',
 *   sessionName: 'cdk-deploy-session',
 *   durationSeconds: 3600,
 *   assumedBy: 'arn:aws:iam::123456789012:user/Developer',
 *   timestamp: new Date()
 * };
 * ```
 */
export interface AssumedRole {
  /**
   * The ARN of the IAM role that was assumed.
   */
  roleArn: string;

  /**
   * The session name used for the assumed role session.
   * This identifies the session and appears in CloudTrail logs.
   */
  sessionName?: string;

  /**
   * Duration in seconds for the assumed role session.
   * Defaults to 3600 (1 hour) if not specified in the AssumeRole call.
   */
  durationSeconds?: number;

  /**
   * The IAM principal (role or user ARN) that assumed this role.
   * This creates a chain showing the sequence of role assumptions.
   */
  assumedBy?: string;

  /**
   * Timestamp when the role was assumed.
   */
  timestamp: Date;
}

/**
 * Represents the chain of roles assumed during execution.
 *
 * The role chain tracks the sequence of STS AssumeRole calls, allowing
 * you to understand the full path from the initial identity to the
 * current effective identity.
 *
 * @example
 * ```typescript
 * const roleChain: RoleChain = {
 *   initialPrincipal: 'arn:aws:iam::111111111111:user/Developer',
 *   roles: [
 *     { roleArn: 'arn:aws:iam::222222222222:role/CrossAccountRole', ... },
 *     { roleArn: 'arn:aws:iam::222222222222:role/DeployRole', ... }
 *   ]
 * };
 * ```
 */
export interface RoleChain {
  /**
   * The ordered list of roles that were assumed, in chronological order.
   * The first role in the array was assumed first, and so on.
   */
  roles: AssumedRole[];

  /**
   * The original/starting principal before any roles were assumed.
   * This is typically the IAM user or role that initiated the test.
   */
  initialPrincipal?: string;
}

/**
 * Configuration options for the permissions middleware.
 *
 * These options control what API calls are captured and how role
 * chain tracking behaves. Use filtering options to focus on specific
 * services or exclude noisy API calls.
 *
 * @example
 * ```typescript
 * const options: PermissionsMiddlewareOptions = {
 *   // Only track S3 and DynamoDB calls
 *   includeServices: ['s3', 'dynamodb'],
 *   // Don't track STS GetCallerIdentity
 *   excludeActions: ['sts:GetCallerIdentity'],
 *   // Track role assumptions
 *   trackRoleChain: true,
 *   // Set the starting identity
 *   initialPrincipal: 'arn:aws:iam::123456789012:user/TestUser'
 * };
 * ```
 */
export interface PermissionsMiddlewareOptions {
  /**
   * List of service names to include (whitelist).
   * If provided, only calls to these services will be captured.
   * Service names should be lowercase (e.g., 's3', 'dynamodb').
   *
   * @example ['s3', 'dynamodb', 'lambda']
   */
  includeServices?: string[];

  /**
   * List of service names to exclude (blacklist).
   * Calls to these services will not be captured.
   * Exclusions take precedence over inclusions.
   *
   * @example ['sts', 'cloudwatch']
   */
  excludeServices?: string[];

  /**
   * List of actions to include in format 'service:action'.
   * If provided, only these specific actions will be captured.
   *
   * @example ['s3:GetObject', 's3:PutObject']
   */
  includeActions?: string[];

  /**
   * List of actions to exclude in format 'service:action'.
   * These specific actions will not be captured.
   * Exclusions take precedence over inclusions.
   *
   * @example ['sts:GetCallerIdentity', 'cloudwatch:PutMetricData']
   */
  excludeActions?: string[];

  /**
   * Whether to track STS AssumeRole calls separately for role chain tracking.
   * When enabled, AssumeRole calls update the current principal context.
   *
   * @default true
   */
  trackRoleChain?: boolean;

  /**
   * The initial principal making the calls.
   * This is used as the starting point for role chain tracking and
   * will be recorded as the `assumedBy` value for the first role assumption.
   *
   * @example 'arn:aws:iam::123456789012:user/TestUser'
   */
  initialPrincipal?: string;
}

/**
 * Result of collecting permissions from a test run.
 *
 * This interface aggregates all the data collected by the PermissionsCollector,
 * including API calls, assumed roles, and the complete role chain.
 *
 * @example
 * ```typescript
 * const permissions: CollectedPermissions = collector.getCollectedPermissions();
 * console.log(`Captured ${permissions.apiCalls.length} API calls`);
 * console.log(`Assumed ${permissions.assumedRoles.length} roles`);
 * ```
 */
export interface CollectedPermissions {
  /**
   * All captured API calls made during the test run.
   * Calls are in chronological order.
   */
  apiCalls: CapturedApiCall[];

  /**
   * All roles that were assumed via STS AssumeRole during the test run.
   * Roles are in chronological order of assumption.
   */
  assumedRoles: AssumedRole[];

  /**
   * The role chain showing the sequence of role assumptions.
   * Includes the initial principal and all assumed roles.
   */
  roleChain: RoleChain;
}
