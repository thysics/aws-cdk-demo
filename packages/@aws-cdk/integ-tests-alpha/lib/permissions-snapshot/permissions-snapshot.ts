import * as fs from 'fs';
import * as path from 'path';
import { PermissionsTracker } from './permissions-tracker';
import type {
  PermissionsSnapshot,
  PermissionsSnapshotOptions,
  SnapshotComparisonResult,
  ActionSummary,
  RecordedAction,
  RecordedRoleAssumption,
} from './types';
import { PERMISSIONS_SNAPSHOT_VERSION } from './types';

/**
 * Filename for permissions snapshot files
 */
export const PERMISSIONS_SNAPSHOT_FILENAME = 'permissions.snapshot.json';

/**
 * Manages permissions snapshots for integration tests.
 *
 * This class handles:
 * - Creating snapshots from recorded permissions
 * - Loading and saving snapshot files
 * - Comparing snapshots and detecting changes
 * - Formatting diff output for test failures
 */
export class PermissionsSnapshotManager {
  private readonly options: PermissionsSnapshotOptions;
  private readonly tracker: PermissionsTracker;

  constructor(
    private readonly testName: string,
    options: PermissionsSnapshotOptions = {},
  ) {
    this.options = {
      recordActions: true,
      recordRoleAssumptions: true,
      failOnChange: true,
      ...options,
    };
    this.tracker = PermissionsTracker.getInstance(this.options);
  }

  /**
   * Start recording permissions for the test
   */
  public startRecording(): void {
    this.tracker.startRecording();
  }

  /**
   * Stop recording and create a snapshot
   */
  public stopRecordingAndCreateSnapshot(): PermissionsSnapshot {
    this.tracker.stopRecording();

    const actions = this.tracker.getRecordedActions();
    const roleAssumptions = this.tracker.getRecordedRoleAssumptions();

    return this.createSnapshot([...actions], [...roleAssumptions]);
  }

  /**
   * Create a permissions snapshot from recorded data
   */
  public createSnapshot(
    actions: RecordedAction[],
    roleAssumptions: RecordedRoleAssumption[],
  ): PermissionsSnapshot {
    const actionSummary = this.createActionSummary(actions);

    return {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      testName: this.testName,
      createdAt: new Date().toISOString(),
      actions: this.sortActions(actions),
      roleAssumptions: this.sortRoleAssumptions(roleAssumptions),
      actionSummary: this.sortActionSummary(actionSummary),
    };
  }

  /**
   * Save a snapshot to file
   */
  public saveSnapshot(snapshot: PermissionsSnapshot, snapshotDir: string): void {
    const filePath = this.getSnapshotFilePath(snapshotDir);
    
    // Ensure directory exists
    fs.mkdirSync(snapshotDir, { recursive: true });
    
    // Write snapshot with pretty formatting
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  }

  /**
   * Load a snapshot from file
   */
  public loadSnapshot(snapshotDir: string): PermissionsSnapshot | undefined {
    const filePath = this.getSnapshotFilePath(snapshotDir);
    
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as PermissionsSnapshot;
    } catch (error) {
      console.warn(`Failed to load permissions snapshot: ${error}`);
      return undefined;
    }
  }

  /**
   * Compare two snapshots and return the differences
   */
  public compareSnapshots(
    baseline: PermissionsSnapshot,
    current: PermissionsSnapshot,
  ): SnapshotComparisonResult {
    // Compare action summaries (ignoring timestamps and counts for equality)
    const baselineActionKeys = new Set(
      baseline.actionSummary.map(a => `${a.service}:${a.action}`),
    );
    const currentActionKeys = new Set(
      current.actionSummary.map(a => `${a.service}:${a.action}`),
    );

    // Find added actions (in current but not in baseline)
    const addedActions = current.actions.filter(
      a => !baselineActionKeys.has(`${a.service}:${a.action}`),
    );

    // Find removed actions (in baseline but not in current)
    const removedActions = baseline.actionSummary.filter(
      a => !currentActionKeys.has(`${a.service}:${a.action}`),
    );

    // Compare role assumptions
    const baselineRoleArns = new Set(
      baseline.roleAssumptions.map(r => r.roleArn),
    );
    const currentRoleArns = new Set(
      current.roleAssumptions.map(r => r.roleArn),
    );

    const addedRoleAssumptions = current.roleAssumptions.filter(
      r => !baselineRoleArns.has(r.roleArn),
    );

    const removedRoleAssumptions = baseline.roleAssumptions.filter(
      r => !currentRoleArns.has(r.roleArn),
    );

    const matches = 
      addedActions.length === 0 &&
      removedActions.length === 0 &&
      addedRoleAssumptions.length === 0 &&
      removedRoleAssumptions.length === 0;

    const diffMessage = matches ? undefined : this.formatDiffMessage({
      matches,
      addedActions,
      removedActions,
      addedRoleAssumptions,
      removedRoleAssumptions,
    });

    return {
      matches,
      addedActions,
      removedActions,
      addedRoleAssumptions,
      removedRoleAssumptions,
      diffMessage,
    };
  }

  /**
   * Validate the current recording against an existing snapshot
   *
   * @returns true if the snapshot matches or was updated, throws if there are changes and failOnChange is true
   */
  public validateAgainstSnapshot(snapshotDir: string): SnapshotComparisonResult {
    const currentSnapshot = this.stopRecordingAndCreateSnapshot();
    const baselineSnapshot = this.loadSnapshot(snapshotDir);

    // If no baseline exists, create one
    if (!baselineSnapshot) {
      console.log(`No existing permissions snapshot found. Creating new snapshot at: ${snapshotDir}`);
      this.saveSnapshot(currentSnapshot, snapshotDir);
      return {
        matches: true,
        addedActions: [],
        removedActions: [],
        addedRoleAssumptions: [],
        removedRoleAssumptions: [],
      };
    }

    const comparison = this.compareSnapshots(baselineSnapshot, currentSnapshot);

    if (!comparison.matches) {
      if (this.options.updateSnapshot) {
        console.log(`Permissions snapshot changed. Updating snapshot at: ${snapshotDir}`);
        this.saveSnapshot(currentSnapshot, snapshotDir);
        return {
          ...comparison,
          matches: true,
        };
      }

      if (this.options.failOnChange) {
        throw new PermissionsSnapshotError(
          `Permissions snapshot mismatch for test '${this.testName}':\n\n${comparison.diffMessage}`,
          comparison,
        );
      }
    }

    return comparison;
  }

  /**
   * Get the file path for the snapshot
   */
  private getSnapshotFilePath(snapshotDir: string): string {
    return path.join(snapshotDir, PERMISSIONS_SNAPSHOT_FILENAME);
  }

  /**
   * Create an action summary from recorded actions
   */
  private createActionSummary(actions: RecordedAction[]): ActionSummary[] {
    const summary = new Map<string, ActionSummary>();

    for (const action of actions) {
      const key = `${action.service}:${action.action}`;
      const existing = summary.get(key);

      if (existing) {
        summary.set(key, {
          ...existing,
          count: existing.count + 1,
        });
      } else {
        summary.set(key, {
          service: action.service,
          action: action.action,
          count: 1,
        });
      }
    }

    return Array.from(summary.values());
  }

  /**
   * Sort actions for consistent snapshot output
   */
  private sortActions(actions: RecordedAction[]): RecordedAction[] {
    return [...actions].sort((a, b) => {
      const serviceCompare = a.service.localeCompare(b.service);
      if (serviceCompare !== 0) return serviceCompare;
      const actionCompare = a.action.localeCompare(b.action);
      if (actionCompare !== 0) return actionCompare;
      return a.timestamp.localeCompare(b.timestamp);
    });
  }

  /**
   * Sort role assumptions for consistent snapshot output
   */
  private sortRoleAssumptions(
    roleAssumptions: RecordedRoleAssumption[],
  ): RecordedRoleAssumption[] {
    return [...roleAssumptions].sort((a, b) => {
      const roleCompare = a.roleArn.localeCompare(b.roleArn);
      if (roleCompare !== 0) return roleCompare;
      return a.timestamp.localeCompare(b.timestamp);
    });
  }

  /**
   * Sort action summary for consistent snapshot output
   */
  private sortActionSummary(summary: ActionSummary[]): ActionSummary[] {
    return [...summary].sort((a, b) => {
      const serviceCompare = a.service.localeCompare(b.service);
      if (serviceCompare !== 0) return serviceCompare;
      return a.action.localeCompare(b.action);
    });
  }

  /**
   * Format a human-readable diff message
   */
  private formatDiffMessage(result: SnapshotComparisonResult): string {
    const lines: string[] = [];

    if (result.addedActions.length > 0) {
      lines.push('Added IAM Actions:');
      const uniqueAdded = this.getUniqueActionKeys(result.addedActions);
      for (const action of uniqueAdded) {
        lines.push(`  + ${action}`);
      }
      lines.push('');
    }

    if (result.removedActions.length > 0) {
      lines.push('Removed IAM Actions:');
      for (const action of result.removedActions) {
        lines.push(`  - ${action.service}:${action.action}`);
      }
      lines.push('');
    }

    if (result.addedRoleAssumptions.length > 0) {
      lines.push('Added Role Assumptions:');
      const uniqueRoles = [...new Set(result.addedRoleAssumptions.map(r => r.roleArn))];
      for (const roleArn of uniqueRoles) {
        lines.push(`  + ${roleArn}`);
      }
      lines.push('');
    }

    if (result.removedRoleAssumptions.length > 0) {
      lines.push('Removed Role Assumptions:');
      const uniqueRoles = [...new Set(result.removedRoleAssumptions.map(r => r.roleArn))];
      for (const roleArn of uniqueRoles) {
        lines.push(`  - ${roleArn}`);
      }
      lines.push('');
    }

    lines.push('To update the snapshot, run the test with --update-permissions-snapshot');
    lines.push('If this change is expected, review and commit the updated snapshot.');

    return lines.join('\n');
  }

  /**
   * Get unique action keys from a list of recorded actions
   */
  private getUniqueActionKeys(actions: RecordedAction[]): string[] {
    const unique = new Set<string>();
    for (const action of actions) {
      unique.add(`${action.service}:${action.action}`);
    }
    return Array.from(unique).sort();
  }
}

/**
 * Error thrown when permissions snapshot validation fails
 */
export class PermissionsSnapshotError extends Error {
  constructor(
    message: string,
    public readonly comparisonResult: SnapshotComparisonResult,
  ) {
    super(message);
    this.name = 'PermissionsSnapshotError';
    
    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PermissionsSnapshotError);
    }
  }
}
