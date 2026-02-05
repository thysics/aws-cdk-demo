/**
 * Permissions Tracker
 *
 * Tracks IAM actions and role assumptions during test execution.
 */

import type {
  RecordedAction,
  RoleAssumption,
  AggregatedAction,
  PermissionsTrackingOptions,
  PermissionsSnapshot,
} from './types';

/**
 * Current version of the snapshot format
 */
export const SNAPSHOT_VERSION = '1.0.0';

/**
 * Global instance for singleton pattern
 */
let globalTracker: PermissionsTracker | undefined;

/**
 * Tracks IAM permissions used during test execution
 */
export class PermissionsTracker {
  /**
   * Get the global tracker instance
   *
   * @returns The global tracker instance, or undefined if not initialized
   */
  public static getInstance(): PermissionsTracker | undefined {
    return globalTracker;
  }

  /**
   * Initialize the global tracker instance
   *
   * @param options Options for the tracker
   * @returns The initialized tracker instance
   */
  public static initialize(options: PermissionsTrackingOptions): PermissionsTracker {
    globalTracker = new PermissionsTracker(options);
    return globalTracker;
  }

  /**
   * Clear the global tracker instance
   */
  public static clear(): void {
    globalTracker = undefined;
  }

  private readonly actions: RecordedAction[] = [];
  private readonly roles: RoleAssumption[] = [];
  private readonly options: PermissionsTrackingOptions;
  private readonly startTime: Date;

  constructor(options: PermissionsTrackingOptions) {
    this.options = options;
    this.startTime = new Date();
  }

  /**
   * Record an IAM action
   *
   * @param service The AWS service name
   * @param action The API action name
   */
  public recordAction(service: string, action: string): void {
    const normalizedService = this.normalizeServiceName(service);
    const normalizedAction = this.normalizeActionName(action);

    // Check if this action should be excluded
    if (this.shouldExclude(normalizedService, normalizedAction)) {
      return;
    }

    this.actions.push({
      service: normalizedService,
      action: normalizedAction,
    });

    // Check if this is a role assumption
    if (normalizedService === 'sts' && normalizedAction === 'AssumeRole') {
      // Note: Role ARN will be captured separately via recordRoleAssumption
    }
  }

  /**
   * Record a role assumption
   *
   * @param roleArn The ARN of the role being assumed
   * @param sessionName The session name for the assumption
   * @param externalId The external ID, if any
   */
  public recordRoleAssumption(
    roleArn: string,
    sessionName?: string,
    externalId?: string,
  ): void {
    // Check if we've already recorded this role
    const existingRole = this.roles.find(r => r.roleArn === roleArn);
    if (!existingRole) {
      this.roles.push({
        roleArn,
        sessionName,
        externalId,
      });
    }
  }

  /**
   * Get the aggregated actions
   *
   * @returns Array of aggregated actions with counts
   */
  public getAggregatedActions(): AggregatedAction[] {
    const actionMap = new Map<string, number>();

    for (const action of this.actions) {
      const key = `${action.service}:${action.action}`;
      actionMap.set(key, (actionMap.get(key) || 0) + 1);
    }

    const result: AggregatedAction[] = [];
    for (const [key, count] of actionMap.entries()) {
      const [service, action] = key.split(':');
      result.push({ service, action, count });
    }

    // Sort by service, then by action for consistent output
    return result.sort((a, b) => {
      if (a.service !== b.service) {
        return a.service.localeCompare(b.service);
      }
      return a.action.localeCompare(b.action);
    });
  }

  /**
   * Get the recorded roles
   *
   * @returns Array of role assumptions
   */
  public getRoles(): RoleAssumption[] {
    // Sort by roleArn for consistent output
    return [...this.roles].sort((a, b) => a.roleArn.localeCompare(b.roleArn));
  }

  /**
   * Generate a permissions snapshot
   *
   * @returns The permissions snapshot object
   */
  public generateSnapshot(): PermissionsSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      timestamp: this.startTime.toISOString(),
      testName: this.options.testName,
      roles: this.getRoles(),
      actions: this.getAggregatedActions(),
    };
  }

  /**
   * Reset the tracker, clearing all recorded actions and roles
   */
  public reset(): void {
    this.actions.length = 0;
    this.roles.length = 0;
  }

  /**
   * Get the raw list of recorded actions
   *
   * @returns Array of all recorded actions
   */
  public getRawActions(): RecordedAction[] {
    return [...this.actions];
  }

  /**
   * Check if an action should be excluded from tracking
   */
  private shouldExclude(service: string, action: string): boolean {
    // Check service exclusion
    if (this.options.excludeServices?.includes(service)) {
      return true;
    }

    // Check action exclusion
    const actionKey = `${service}:${action}`;
    if (this.options.excludeActions?.includes(actionKey)) {
      return true;
    }

    return false;
  }

  /**
   * Normalize service name to lowercase
   */
  private normalizeServiceName(service: string): string {
    // Handle various formats:
    // - @aws-sdk/client-s3 -> s3
    // - S3 -> s3
    // - client-s3 -> s3

    let normalized = service.toLowerCase();

    // Remove @aws-sdk/client- prefix
    if (normalized.startsWith('@aws-sdk/client-')) {
      normalized = normalized.replace('@aws-sdk/client-', '');
    }

    // Remove client- prefix
    if (normalized.startsWith('client-')) {
      normalized = normalized.replace('client-', '');
    }

    return normalized;
  }

  /**
   * Normalize action name to PascalCase
   */
  private normalizeActionName(action: string): string {
    // Handle various formats:
    // - getObject -> GetObject
    // - GetObjectCommand -> GetObject
    // - GetObject -> GetObject

    let normalized = action;

    // Remove Command suffix
    if (normalized.endsWith('Command')) {
      normalized = normalized.slice(0, -7);
    }

    // Capitalize first letter
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);

    return normalized;
  }
}
