import {
  CapturedApiCall,
  AssumedRole,
  RoleChain,
  CollectedPermissions,
  PermissionsMiddlewareOptions,
} from './types';

/**
 * Singleton class to aggregate permissions across multiple SDK clients during a test run.
 *
 * The PermissionsCollector maintains a central registry of all captured API calls and assumed roles,
 * allowing multiple SDK clients using the permissions middleware to report to a single
 * collection point. This is essential for integration tests that use multiple AWS SDK clients.
 *
 * ## Usage
 *
 * The collector follows the singleton pattern. Use `getInstance()` to get the shared instance:
 *
 * ```typescript
 * // Get the singleton instance
 * const collector = PermissionsCollector.getInstance();
 *
 * // Configure options (optional)
 * collector.configure({
 *   initialPrincipal: 'arn:aws:iam::123456789012:user/test',
 *   excludeServices: ['sts']
 * });
 *
 * // Reset before each test
 * collector.reset();
 *
 * // ... run test with SDK clients that have middleware attached ...
 *
 * // After test, get all collected permissions
 * const permissions = collector.getCollectedPermissions();
 * ```
 *
 * ## Thread Safety
 *
 * The collector uses a singleton instance that is shared across all SDK clients.
 * For test isolation, always call `reset()` before each test run.
 *
 * @see {@link createPermissionsMiddleware} - Factory function to create middleware
 * @see {@link PermissionsSnapshot} - Class to serialize collected permissions
 */
export class PermissionsCollector {
  private static instance: PermissionsCollector | null = null;

  private apiCalls: CapturedApiCall[] = [];
  private assumedRoles: AssumedRole[] = [];
  private roleChain: RoleChain = { roles: [] };
  private currentPrincipal?: string;
  private options: PermissionsMiddlewareOptions = {};

  private constructor() {}

  /**
   * Gets the singleton instance of the PermissionsCollector.
   *
   * Creates a new instance if one doesn't exist. This instance is shared
   * across all SDK clients using the permissions middleware.
   *
   * @returns The singleton PermissionsCollector instance
   *
   * @example
   * ```typescript
   * const collector = PermissionsCollector.getInstance();
   * ```
   */
  public static getInstance(): PermissionsCollector {
    if (!PermissionsCollector.instance) {
      PermissionsCollector.instance = new PermissionsCollector();
    }
    return PermissionsCollector.instance;
  }

  /**
   * Resets the singleton instance to null.
   *
   * This completely destroys the existing instance. Useful for testing
   * the collector itself or for complete isolation between test suites.
   * For most cases, prefer using `reset()` on the instance instead.
   *
   * @example
   * ```typescript
   * // Completely reset the singleton (rare)
   * PermissionsCollector.resetInstance();
   * ```
   */
  public static resetInstance(): void {
    PermissionsCollector.instance = null;
  }

  /**
   * Configures the collector with middleware options.
   *
   * Options set here affect filtering behavior for all API calls
   * recorded by the collector. If `initialPrincipal` is provided,
   * it will be set as the starting point for role chain tracking.
   *
   * @param options - Configuration options for filtering and role chain tracking
   *
   * @example
   * ```typescript
   * collector.configure({
   *   initialPrincipal: 'arn:aws:iam::123456789012:user/test',
   *   excludeServices: ['cloudwatch'],
   *   trackRoleChain: true
   * });
   * ```
   */
  public configure(options: PermissionsMiddlewareOptions): void {
    this.options = options;
    if (options.initialPrincipal) {
      this.currentPrincipal = options.initialPrincipal;
      this.roleChain.initialPrincipal = options.initialPrincipal;
    }
  }

  /**
   * Gets a copy of the current configuration options.
   *
   * @returns A shallow copy of the current options
   */
  public getOptions(): PermissionsMiddlewareOptions {
    return { ...this.options };
  }

  /**
   * Resets all collected data while preserving configuration.
   *
   * Call this before each test run to ensure clean data collection.
   * The initial principal (if configured) is preserved.
   *
   * @example
   * ```typescript
   * // Before each test
   * collector.reset();
   * ```
   */
  public reset(): void {
    this.apiCalls = [];
    this.assumedRoles = [];
    this.roleChain = { roles: [], initialPrincipal: this.options.initialPrincipal };
    this.currentPrincipal = this.options.initialPrincipal;
  }

  /**
   * Records an API call made through an SDK client.
   *
   * This method is called by the middleware for each intercepted API call.
   * The call is only recorded if it passes the configured filters.
   *
   * @param call - The captured API call to record
   *
   * @example
   * ```typescript
   * collector.recordApiCall({
   *   service: 's3',
   *   action: 'GetObject',
   *   region: 'us-east-1',
   *   timestamp: new Date()
   * });
   * ```
   */
  public recordApiCall(call: CapturedApiCall): void {
    // Apply filters
    if (!this.shouldCapture(call.service, call.action)) {
      return;
    }

    // Add current principal if not set
    const callWithPrincipal: CapturedApiCall = {
      ...call,
      principal: call.principal || this.currentPrincipal,
    };

    this.apiCalls.push(callWithPrincipal);
  }

  /**
   * Records an STS AssumeRole call and updates the role chain.
   *
   * This method is called by the middleware when it detects an AssumeRole call.
   * It updates the current principal to the assumed role's ARN, so subsequent
   * API calls will be attributed to the new role.
   *
   * @param assumedRole - The assumed role details to record
   *
   * @example
   * ```typescript
   * collector.recordAssumedRole({
   *   roleArn: 'arn:aws:iam::123456789012:role/DeployRole',
   *   sessionName: 'cdk-session',
   *   durationSeconds: 3600,
   *   timestamp: new Date()
   * });
   * ```
   */
  public recordAssumedRole(assumedRole: AssumedRole): void {
    if (this.options.trackRoleChain === false) {
      return;
    }

    const roleWithAssumer: AssumedRole = {
      ...assumedRole,
      assumedBy: assumedRole.assumedBy || this.currentPrincipal,
    };

    this.assumedRoles.push(roleWithAssumer);
    this.roleChain.roles.push(roleWithAssumer);

    // Update current principal to the assumed role
    this.currentPrincipal = assumedRole.roleArn;
  }

  /**
   * Gets the current principal (the most recently assumed role or initial principal).
   *
   * @returns The current principal ARN, or undefined if not set
   */
  public getCurrentPrincipal(): string | undefined {
    return this.currentPrincipal;
  }

  /**
   * Manually sets the current principal.
   *
   * Use this to override the principal context, for example when
   * using credentials from a source other than STS AssumeRole.
   *
   * @param principal - The principal ARN to set
   */
  public setCurrentPrincipal(principal: string): void {
    this.currentPrincipal = principal;
  }

  /**
   * Gets a copy of all collected API calls.
   *
   * @returns Array of captured API calls in chronological order
   */
  public getApiCalls(): CapturedApiCall[] {
    return [...this.apiCalls];
  }

  /**
   * Gets a copy of all assumed roles.
   *
   * @returns Array of assumed roles in chronological order
   */
  public getAssumedRoles(): AssumedRole[] {
    return [...this.assumedRoles];
  }

  /**
   * Gets a copy of the complete role chain.
   *
   * @returns The role chain including initial principal and all assumed roles
   */
  public getRoleChain(): RoleChain {
    return {
      ...this.roleChain,
      roles: [...this.roleChain.roles],
    };
  }

  /**
   * Gets all collected permissions data as a single object.
   *
   * This is the primary method to retrieve data for creating a snapshot.
   *
   * @returns All collected permissions including API calls, roles, and role chain
   *
   * @example
   * ```typescript
   * const permissions = collector.getCollectedPermissions();
   * const snapshot = PermissionsSnapshot.fromCollector(collector, { testName: 'my-test' });
   * ```
   */
  public getCollectedPermissions(): CollectedPermissions {
    return {
      apiCalls: this.getApiCalls(),
      assumedRoles: this.getAssumedRoles(),
      roleChain: this.getRoleChain(),
    };
  }

  /**
   * Gets a deduplicated, sorted list of unique permissions in service:action format.
   *
   * This is useful for generating a summary of what permissions were used,
   * without duplicates from repeated API calls.
   *
   * @returns Sorted array of unique permission strings (e.g., ['s3:GetObject', 's3:PutObject'])
   *
   * @example
   * ```typescript
   * const uniquePermissions = collector.getUniquePermissions();
   * console.log(uniquePermissions);
   * // ['cloudformation:CreateStack', 's3:GetObject', 's3:PutObject']
   * ```
   */
  public getUniquePermissions(): string[] {
    const permissionSet = new Set<string>();
    for (const call of this.apiCalls) {
      permissionSet.add(`${call.service}:${call.action}`);
    }
    return Array.from(permissionSet).sort();
  }

  /**
   * Determines if a call should be captured based on filter configuration.
   *
   * Exclusion filters take precedence over inclusion filters. If no filters
   * are configured, all calls are captured.
   *
   * @param service - The service name to check
   * @param action - The action name to check
   * @returns true if the call should be captured, false if it should be filtered out
   */
  private shouldCapture(service: string, action: string): boolean {
    const { includeServices, excludeServices, includeActions, excludeActions } = this.options;
    const fullAction = `${service}:${action}`;

    // Check exclude lists first (they take precedence)
    if (excludeServices && excludeServices.includes(service)) {
      return false;
    }
    if (excludeActions && excludeActions.includes(fullAction)) {
      return false;
    }

    // Check include lists (if specified, only allow what's included)
    if (includeServices && includeServices.length > 0) {
      if (!includeServices.includes(service)) {
        return false;
      }
    }
    if (includeActions && includeActions.length > 0) {
      if (!includeActions.includes(fullAction)) {
        return false;
      }
    }

    return true;
  }
}
