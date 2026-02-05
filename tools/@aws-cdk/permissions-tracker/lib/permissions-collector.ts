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
 * This collector maintains a central registry of all captured API calls and assumed roles,
 * allowing multiple SDK clients using the permissions middleware to report to a single
 * collection point.
 *
 * @example
 * ```typescript
 * // Initialize the collector before creating SDK clients
 * const collector = PermissionsCollector.getInstance();
 * collector.reset();
 *
 * // After test run, get all collected permissions
 * const permissions = collector.getCollectedPermissions();
 * ```
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
   * Creates a new instance if one doesn't exist.
   */
  public static getInstance(): PermissionsCollector {
    if (!PermissionsCollector.instance) {
      PermissionsCollector.instance = new PermissionsCollector();
    }
    return PermissionsCollector.instance;
  }

  /**
   * Resets the singleton instance. Useful for testing or starting fresh.
   */
  public static resetInstance(): void {
    PermissionsCollector.instance = null;
  }

  /**
   * Configures the collector with options.
   */
  public configure(options: PermissionsMiddlewareOptions): void {
    this.options = options;
    if (options.initialPrincipal) {
      this.currentPrincipal = options.initialPrincipal;
      this.roleChain.initialPrincipal = options.initialPrincipal;
    }
  }

  /**
   * Gets the current configuration options.
   */
  public getOptions(): PermissionsMiddlewareOptions {
    return { ...this.options };
  }

  /**
   * Resets all collected data.
   */
  public reset(): void {
    this.apiCalls = [];
    this.assumedRoles = [];
    this.roleChain = { roles: [], initialPrincipal: this.options.initialPrincipal };
    this.currentPrincipal = this.options.initialPrincipal;
  }

  /**
   * Records an API call.
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
   */
  public getCurrentPrincipal(): string | undefined {
    return this.currentPrincipal;
  }

  /**
   * Sets the current principal manually.
   */
  public setCurrentPrincipal(principal: string): void {
    this.currentPrincipal = principal;
  }

  /**
   * Gets all collected API calls.
   */
  public getApiCalls(): CapturedApiCall[] {
    return [...this.apiCalls];
  }

  /**
   * Gets all assumed roles.
   */
  public getAssumedRoles(): AssumedRole[] {
    return [...this.assumedRoles];
  }

  /**
   * Gets the complete role chain.
   */
  public getRoleChain(): RoleChain {
    return {
      ...this.roleChain,
      roles: [...this.roleChain.roles],
    };
  }

  /**
   * Gets all collected permissions data.
   */
  public getCollectedPermissions(): CollectedPermissions {
    return {
      apiCalls: this.getApiCalls(),
      assumedRoles: this.getAssumedRoles(),
      roleChain: this.getRoleChain(),
    };
  }

  /**
   * Gets a summary of unique permissions in service:action format.
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
