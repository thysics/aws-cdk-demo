import type {
  RecordedAction,
  RecordedRoleAssumption,
  PermissionsSnapshotOptions,
} from './types';

/**
 * Tracks IAM permissions (actions and role assumptions) during test execution.
 *
 * This class serves as the central registry for recording all AWS SDK calls
 * and role assumptions made during integration test execution.
 */
export class PermissionsTracker {
  private static instance: PermissionsTracker | undefined;

  private readonly recordedActions: RecordedAction[] = [];
  private readonly recordedRoleAssumptions: RecordedRoleAssumption[] = [];
  private readonly options: PermissionsSnapshotOptions;
  private isRecording: boolean = false;

  /**
   * Get the global singleton instance of PermissionsTracker
   */
  public static getInstance(options?: PermissionsSnapshotOptions): PermissionsTracker {
    if (!PermissionsTracker.instance) {
      PermissionsTracker.instance = new PermissionsTracker(options);
    }
    return PermissionsTracker.instance;
  }

  /**
   * Reset the global instance (useful for testing)
   */
  public static resetInstance(): void {
    if (PermissionsTracker.instance) {
      PermissionsTracker.instance.stopRecording();
    }
    PermissionsTracker.instance = undefined;
  }

  private constructor(options: PermissionsSnapshotOptions = {}) {
    this.options = {
      recordActions: true,
      recordRoleAssumptions: true,
      failOnChange: true,
      ...options,
    };
  }

  /**
   * Start recording permissions
   */
  public startRecording(): void {
    this.isRecording = true;
    this.recordedActions.length = 0;
    this.recordedRoleAssumptions.length = 0;
  }

  /**
   * Stop recording permissions
   */
  public stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Check if currently recording
   */
  public get recording(): boolean {
    return this.isRecording;
  }

  /**
   * Record an AWS API action
   */
  public recordAction(service: string, action: string, resource?: string): void {
    if (!this.isRecording || !this.options.recordActions) {
      return;
    }

    // Check if this action should be ignored
    const actionKey = `${service}:${action}`;
    if (this.options.ignoreActions?.includes(actionKey)) {
      return;
    }

    const recordedAction: RecordedAction = {
      service: this.normalizeServiceName(service),
      action,
      resource,
      timestamp: new Date().toISOString(),
    };

    this.recordedActions.push(recordedAction);
  }

  /**
   * Record an IAM role assumption
   */
  public recordRoleAssumption(
    roleArn: string,
    roleSessionName?: string,
    sourceIdentity?: string,
  ): void {
    if (!this.isRecording || !this.options.recordRoleAssumptions) {
      return;
    }

    // Check if this role should be ignored
    if (this.options.ignoreRoles?.some(ignore => roleArn.includes(ignore))) {
      return;
    }

    const recordedAssumption: RecordedRoleAssumption = {
      roleArn,
      roleSessionName,
      sourceIdentity,
      timestamp: new Date().toISOString(),
    };

    this.recordedRoleAssumptions.push(recordedAssumption);
  }

  /**
   * Get all recorded actions
   */
  public getRecordedActions(): ReadonlyArray<RecordedAction> {
    return [...this.recordedActions];
  }

  /**
   * Get all recorded role assumptions
   */
  public getRecordedRoleAssumptions(): ReadonlyArray<RecordedRoleAssumption> {
    return [...this.recordedRoleAssumptions];
  }

  /**
   * Get the current options
   */
  public getOptions(): PermissionsSnapshotOptions {
    return { ...this.options };
  }

  /**
   * Clear all recorded data
   */
  public clear(): void {
    this.recordedActions.length = 0;
    this.recordedRoleAssumptions.length = 0;
  }

  /**
   * Normalize AWS service name to lowercase format
   */
  private normalizeServiceName(service: string): string {
    // Handle both SDK v2 style (S3) and v3 style (@aws-sdk/client-s3)
    let normalized = service.toLowerCase();
    
    // Remove @aws-sdk/client- prefix if present
    if (normalized.startsWith('@aws-sdk/client-')) {
      normalized = normalized.replace('@aws-sdk/client-', '');
    }
    
    // Remove -client suffix if present
    if (normalized.endsWith('-client')) {
      normalized = normalized.replace(/-client$/, '');
    }
    
    return normalized;
  }
}
