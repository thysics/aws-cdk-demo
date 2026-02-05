/**
 * Types for the permissions tracking system.
 */

/**
 * Represents a single API call captured by the middleware.
 */
export interface CapturedApiCall {
  /** The AWS service name (e.g., 's3', 'sts', 'cloudformation') */
  service: string;
  /** The API action name (e.g., 'GetObject', 'AssumeRole') */
  action: string;
  /** The AWS region where the call was made */
  region?: string;
  /** The AWS account ID */
  account?: string;
  /** Timestamp when the call was made */
  timestamp: Date;
  /** The principal (role ARN or user) that made this call */
  principal?: string;
}

/**
 * Represents an STS AssumeRole call with detailed session information.
 */
export interface AssumedRole {
  /** The ARN of the role that was assumed */
  roleArn: string;
  /** The session name used for the assumed role */
  sessionName?: string;
  /** Duration in seconds for the assumed role session */
  durationSeconds?: number;
  /** The principal that assumed this role */
  assumedBy?: string;
  /** Timestamp when the role was assumed */
  timestamp: Date;
}

/**
 * Represents the chain of roles assumed during execution.
 */
export interface RoleChain {
  /** The ordered list of roles that were assumed */
  roles: AssumedRole[];
  /** The original/starting principal */
  initialPrincipal?: string;
}

/**
 * Configuration options for the permissions middleware.
 */
export interface PermissionsMiddlewareOptions {
  /**
   * List of service names to include (whitelist).
   * If provided, only calls to these services will be captured.
   */
  includeServices?: string[];

  /**
   * List of service names to exclude (blacklist).
   * Calls to these services will not be captured.
   */
  excludeServices?: string[];

  /**
   * List of actions to include in format 'service:action'.
   * If provided, only these specific actions will be captured.
   */
  includeActions?: string[];

  /**
   * List of actions to exclude in format 'service:action'.
   * These specific actions will not be captured.
   */
  excludeActions?: string[];

  /**
   * Whether to track STS AssumeRole calls separately for role chain tracking.
   * @default true
   */
  trackRoleChain?: boolean;

  /**
   * The initial principal making the calls.
   * This is used as the starting point for role chain tracking.
   */
  initialPrincipal?: string;
}

/**
 * Result of collecting permissions from a test run.
 */
export interface CollectedPermissions {
  /** All captured API calls */
  apiCalls: CapturedApiCall[];
  /** All assumed roles */
  assumedRoles: AssumedRole[];
  /** The role chain showing the sequence of role assumptions */
  roleChain: RoleChain;
}
