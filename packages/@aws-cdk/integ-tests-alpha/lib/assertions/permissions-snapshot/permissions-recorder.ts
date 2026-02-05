/**
 * Permissions Recorder
 *
 * This module provides a recorder that collects IAM actions and role
 * assumptions during test execution. It maintains a deduplicated and
 * sorted list of recorded permissions.
 */

import type {
  PermissionsSnapshot,
  PermissionsSnapshotOptions,
  RecordedIamAction,
  RecordedRoleAssumption,
} from './types';
import { PERMISSIONS_SNAPSHOT_VERSION } from './types';

/**
 * Records IAM actions and role assumptions during test execution
 */
export class PermissionsRecorder {
  private readonly actions: Map<string, RecordedIamAction> = new Map();
  private readonly roleAssumptions: Map<string, RecordedRoleAssumption> = new Map();
  private readonly includeTimestamps: boolean;
  private readonly includeResources: boolean;
  private isRecording: boolean = false;

  constructor(options: Partial<PermissionsSnapshotOptions> = {}) {
    this.includeTimestamps = options.includeTimestamps ?? false;
    this.includeResources = options.includeResources ?? false;
  }

  /**
   * Start recording permissions
   */
  public startRecording(): void {
    this.isRecording = true;
  }

  /**
   * Stop recording permissions
   */
  public stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Check if the recorder is currently recording
   */
  public isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Record an IAM action
   *
   * @param action The action to record
   */
  public recordAction(action: RecordedIamAction): void {
    if (!this.isRecording) {
      return;
    }

    // Create a unique key for deduplication
    const key = this.createActionKey(action);

    // Only store the first occurrence (for consistent snapshots)
    if (!this.actions.has(key)) {
      const normalizedAction = this.normalizeAction(action);
      this.actions.set(key, normalizedAction);
    }
  }

  /**
   * Record a role assumption
   *
   * @param assumption The role assumption to record
   */
  public recordRoleAssumption(assumption: RecordedRoleAssumption): void {
    if (!this.isRecording) {
      return;
    }

    // Create a unique key for deduplication
    const key = this.createRoleAssumptionKey(assumption);

    // Only store the first occurrence
    if (!this.roleAssumptions.has(key)) {
      const normalizedAssumption = this.normalizeRoleAssumption(assumption);
      this.roleAssumptions.set(key, normalizedAssumption);
    }
  }

  /**
   * Get all recorded actions
   */
  public getActions(): RecordedIamAction[] {
    return this.sortActions([...this.actions.values()]);
  }

  /**
   * Get all recorded role assumptions
   */
  public getRoleAssumptions(): RecordedRoleAssumption[] {
    return this.sortRoleAssumptions([...this.roleAssumptions.values()]);
  }

  /**
   * Clear all recorded data
   */
  public clear(): void {
    this.actions.clear();
    this.roleAssumptions.clear();
  }

  /**
   * Create a permissions snapshot from the recorded data
   *
   * @param options Options for creating the snapshot
   */
  public createSnapshot(options: PermissionsSnapshotOptions): PermissionsSnapshot {
    const actions = this.getActions();
    const roleAssumptions = this.getRoleAssumptions();

    // Create action summary for quick reference
    const actionSummary = this.createActionSummary(actions);

    return {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      testName: options.testName,
      timestamp: new Date().toISOString(),
      actions,
      roleAssumptions,
      actionSummary,
    };
  }

  /**
   * Create a unique key for an action
   */
  private createActionKey(action: RecordedIamAction): string {
    const parts = [action.service.toLowerCase(), action.action.toLowerCase()];

    // Include resources in key if configured
    if (this.includeResources && action.resources?.length) {
      parts.push(...action.resources.sort());
    }

    return parts.join(':');
  }

  /**
   * Create a unique key for a role assumption
   */
  private createRoleAssumptionKey(assumption: RecordedRoleAssumption): string {
    // Normalize the role ARN for comparison
    return assumption.roleArn.toLowerCase();
  }

  /**
   * Normalize an action for consistent storage
   */
  private normalizeAction(action: RecordedIamAction): RecordedIamAction {
    const normalized: RecordedIamAction = {
      service: action.service.toLowerCase(),
      action: action.action,
    };

    if (this.includeResources && action.resources?.length) {
      (normalized as any).resources = [...action.resources].sort();
    }

    if (this.includeTimestamps && action.timestamp) {
      (normalized as any).timestamp = action.timestamp;
    }

    return normalized;
  }

  /**
   * Normalize a role assumption for consistent storage
   */
  private normalizeRoleAssumption(
    assumption: RecordedRoleAssumption,
  ): RecordedRoleAssumption {
    const normalized: RecordedRoleAssumption = {
      roleArn: assumption.roleArn,
    };

    if (assumption.sessionName) {
      (normalized as any).sessionName = assumption.sessionName;
    }

    if (this.includeTimestamps && assumption.timestamp) {
      (normalized as any).timestamp = assumption.timestamp;
    }

    if (assumption.assumedBy) {
      (normalized as any).assumedBy = assumption.assumedBy;
    }

    return normalized;
  }

  /**
   * Sort actions for consistent ordering
   */
  private sortActions(actions: RecordedIamAction[]): RecordedIamAction[] {
    return actions.sort((a, b) => {
      // Sort by service first
      const serviceCompare = a.service.localeCompare(b.service);
      if (serviceCompare !== 0) {
        return serviceCompare;
      }

      // Then by action
      return a.action.localeCompare(b.action);
    });
  }

  /**
   * Sort role assumptions for consistent ordering
   */
  private sortRoleAssumptions(
    assumptions: RecordedRoleAssumption[],
  ): RecordedRoleAssumption[] {
    return assumptions.sort((a, b) => a.roleArn.localeCompare(b.roleArn));
  }

  /**
   * Create a summary of unique service:action pairs
   */
  private createActionSummary(actions: RecordedIamAction[]): string[] {
    const summary = new Set<string>();

    for (const action of actions) {
      summary.add(`${action.service}:${action.action}`);
    }

    return [...summary].sort();
  }
}

/**
 * Global permissions recorder for convenient access
 */
let globalRecorder: PermissionsRecorder | undefined;

/**
 * Get or create the global permissions recorder
 */
export function getGlobalRecorder(): PermissionsRecorder {
  if (!globalRecorder) {
    globalRecorder = new PermissionsRecorder();
  }
  return globalRecorder;
}

/**
 * Set a custom global permissions recorder
 */
export function setGlobalRecorder(recorder: PermissionsRecorder): void {
  globalRecorder = recorder;
}

/**
 * Clear the global permissions recorder
 */
export function clearGlobalRecorder(): void {
  globalRecorder?.clear();
  globalRecorder = undefined;
}
