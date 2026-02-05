/**
 * Permissions Snapshot
 *
 * This module provides functionality to save, load, and compare
 * permissions snapshots. Snapshots are stored as JSON files alongside
 * integration test snapshots.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PermissionsSnapshot,
  PermissionsSnapshotConfig,
  PermissionsSnapshotDiff,
  RecordedIamAction,
  RecordedRoleAssumption,
} from './types';
import { PERMISSIONS_SNAPSHOT_VERSION } from './types';

/**
 * Default filename for permissions snapshots
 */
export const PERMISSIONS_SNAPSHOT_FILENAME = 'permissions.snapshot.json';

/**
 * Manages permissions snapshot storage and comparison
 */
export class PermissionsSnapshotManager {
  private readonly config: PermissionsSnapshotConfig;

  constructor(config: PermissionsSnapshotConfig = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      failOnChanges: config.failOnChanges ?? true,
      updateSnapshot: config.updateSnapshot ?? false,
      snapshotPath: config.snapshotPath,
    };
  }

  /**
   * Check if permissions snapshot is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled ?? false;
  }

  /**
   * Save a permissions snapshot to disk
   *
   * @param snapshot The snapshot to save
   * @param snapshotDir Directory to save the snapshot (e.g., integ.test.js.snapshot/)
   */
  public saveSnapshot(snapshot: PermissionsSnapshot, snapshotDir: string): void {
    const filePath = this.getSnapshotPath(snapshotDir);

    // Ensure the directory exists
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    // Remove timestamp from snapshot for deterministic comparison
    const snapshotToSave = this.prepareSnapshotForStorage(snapshot);

    // Write the snapshot with pretty formatting
    const content = JSON.stringify(snapshotToSave, null, 2) + '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load a permissions snapshot from disk
   *
   * @param snapshotDir Directory containing the snapshot
   * @returns The loaded snapshot, or undefined if not found
   */
  public loadSnapshot(snapshotDir: string): PermissionsSnapshot | undefined {
    const filePath = this.getSnapshotPath(snapshotDir);

    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const snapshot = JSON.parse(content) as PermissionsSnapshot;

      // Validate the snapshot version
      if (!this.isCompatibleVersion(snapshot.version)) {
        console.warn(
          `Permissions snapshot version mismatch: expected ${PERMISSIONS_SNAPSHOT_VERSION}, got ${snapshot.version}`,
        );
      }

      return snapshot;
    } catch (error) {
      console.error(`Failed to load permissions snapshot from ${filePath}:`, error);
      return undefined;
    }
  }

  /**
   * Compare two permissions snapshots
   *
   * @param baseline The baseline snapshot to compare against
   * @param current The current snapshot from test execution
   * @returns The diff result
   */
  public compareSnapshots(
    baseline: PermissionsSnapshot,
    current: PermissionsSnapshot,
  ): PermissionsSnapshotDiff {
    const addedActions = this.findAddedActions(baseline.actions, current.actions);
    const removedActions = this.findRemovedActions(baseline.actions, current.actions);
    const addedRoleAssumptions = this.findAddedRoleAssumptions(
      baseline.roleAssumptions,
      current.roleAssumptions,
    );
    const removedRoleAssumptions = this.findRemovedRoleAssumptions(
      baseline.roleAssumptions,
      current.roleAssumptions,
    );

    const hasDifferences =
      addedActions.length > 0 ||
      removedActions.length > 0 ||
      addedRoleAssumptions.length > 0 ||
      removedRoleAssumptions.length > 0;

    const summary = this.createDiffSummary({
      addedActions,
      removedActions,
      addedRoleAssumptions,
      removedRoleAssumptions,
    });

    return {
      hasDifferences,
      addedActions,
      removedActions,
      addedRoleAssumptions,
      removedRoleAssumptions,
      summary,
    };
  }

  /**
   * Validate a snapshot against a baseline and handle the result
   *
   * @param current The current snapshot from test execution
   * @param snapshotDir Directory containing the baseline snapshot
   * @returns True if validation passed, false if there are differences
   */
  public validateSnapshot(
    current: PermissionsSnapshot,
    snapshotDir: string,
  ): { passed: boolean; diff?: PermissionsSnapshotDiff } {
    const baseline = this.loadSnapshot(snapshotDir);

    // If no baseline exists, save the current snapshot as baseline
    if (!baseline) {
      console.log(`No baseline permissions snapshot found. Creating new snapshot.`);
      this.saveSnapshot(current, snapshotDir);
      return { passed: true };
    }

    const diff = this.compareSnapshots(baseline, current);

    if (diff.hasDifferences) {
      if (this.config.updateSnapshot) {
        console.log(`Updating permissions snapshot due to changes.`);
        this.saveSnapshot(current, snapshotDir);
        return { passed: true, diff };
      }

      console.error(`Permissions snapshot has changes:\n${diff.summary}`);
      return { passed: !this.config.failOnChanges, diff };
    }

    return { passed: true };
  }

  /**
   * Get the path to the snapshot file
   */
  private getSnapshotPath(snapshotDir: string): string {
    if (this.config.snapshotPath) {
      return path.resolve(snapshotDir, this.config.snapshotPath);
    }
    return path.join(snapshotDir, PERMISSIONS_SNAPSHOT_FILENAME);
  }

  /**
   * Check if a snapshot version is compatible
   */
  private isCompatibleVersion(version: string): boolean {
    // For now, only exact version match is supported
    // Future versions may support backwards compatibility
    return version === PERMISSIONS_SNAPSHOT_VERSION;
  }

  /**
   * Prepare a snapshot for storage by removing non-deterministic fields
   */
  private prepareSnapshotForStorage(snapshot: PermissionsSnapshot): PermissionsSnapshot {
    return {
      ...snapshot,
      // Remove timestamp for deterministic comparison
      timestamp: '',
      // Remove timestamps from actions
      actions: snapshot.actions.map((action) => ({
        ...action,
        timestamp: undefined,
      })),
      // Remove timestamps from role assumptions
      roleAssumptions: snapshot.roleAssumptions.map((assumption) => ({
        ...assumption,
        timestamp: undefined,
      })),
    };
  }

  /**
   * Find actions that are in current but not in baseline
   */
  private findAddedActions(
    baseline: RecordedIamAction[],
    current: RecordedIamAction[],
  ): RecordedIamAction[] {
    const baselineSet = new Set(baseline.map((a) => this.actionKey(a)));
    return current.filter((a) => !baselineSet.has(this.actionKey(a)));
  }

  /**
   * Find actions that are in baseline but not in current
   */
  private findRemovedActions(
    baseline: RecordedIamAction[],
    current: RecordedIamAction[],
  ): RecordedIamAction[] {
    const currentSet = new Set(current.map((a) => this.actionKey(a)));
    return baseline.filter((a) => !currentSet.has(this.actionKey(a)));
  }

  /**
   * Find role assumptions that are in current but not in baseline
   */
  private findAddedRoleAssumptions(
    baseline: RecordedRoleAssumption[],
    current: RecordedRoleAssumption[],
  ): RecordedRoleAssumption[] {
    const baselineSet = new Set(baseline.map((r) => r.roleArn.toLowerCase()));
    return current.filter((r) => !baselineSet.has(r.roleArn.toLowerCase()));
  }

  /**
   * Find role assumptions that are in baseline but not in current
   */
  private findRemovedRoleAssumptions(
    baseline: RecordedRoleAssumption[],
    current: RecordedRoleAssumption[],
  ): RecordedRoleAssumption[] {
    const currentSet = new Set(current.map((r) => r.roleArn.toLowerCase()));
    return baseline.filter((r) => !currentSet.has(r.roleArn.toLowerCase()));
  }

  /**
   * Create a unique key for an action
   */
  private actionKey(action: RecordedIamAction): string {
    return `${action.service.toLowerCase()}:${action.action.toLowerCase()}`;
  }

  /**
   * Create a human-readable summary of differences
   */
  private createDiffSummary(diff: Omit<PermissionsSnapshotDiff, 'hasDifferences' | 'summary'>): string {
    const lines: string[] = [];

    if (diff.addedActions.length > 0) {
      lines.push('Added IAM Actions:');
      for (const action of diff.addedActions) {
        lines.push(`  + ${action.service}:${action.action}`);
      }
    }

    if (diff.removedActions.length > 0) {
      lines.push('Removed IAM Actions:');
      for (const action of diff.removedActions) {
        lines.push(`  - ${action.service}:${action.action}`);
      }
    }

    if (diff.addedRoleAssumptions.length > 0) {
      lines.push('Added Role Assumptions:');
      for (const assumption of diff.addedRoleAssumptions) {
        lines.push(`  + ${assumption.roleArn}`);
      }
    }

    if (diff.removedRoleAssumptions.length > 0) {
      lines.push('Removed Role Assumptions:');
      for (const assumption of diff.removedRoleAssumptions) {
        lines.push(`  - ${assumption.roleArn}`);
      }
    }

    if (lines.length === 0) {
      return 'No differences detected.';
    }

    return lines.join('\n');
  }
}

/**
 * Create a permissions snapshot manager with default settings
 */
export function createSnapshotManager(
  config?: PermissionsSnapshotConfig,
): PermissionsSnapshotManager {
  return new PermissionsSnapshotManager(config);
}

/**
 * Check if permissions snapshots are enabled via environment variable
 */
export function isPermissionsSnapshotEnabled(): boolean {
  return process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT === 'true' ||
    process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT === '1';
}

/**
 * Check if snapshot updates are enabled via environment variable
 */
export function isSnapshotUpdateEnabled(): boolean {
  return process.env.CDK_INTEG_UPDATE_PERMISSIONS_SNAPSHOT === 'true' ||
    process.env.CDK_INTEG_UPDATE_PERMISSIONS_SNAPSHOT === '1';
}
