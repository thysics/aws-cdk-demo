/**
 * Snapshot comparator for detecting permission changes.
 *
 * This module provides functionality to compare two permissions snapshots
 * and generate detailed diffs showing what changed.
 */

import { RecordedAction, RecordedRole, PermissionsSnapshot } from './types';
import { SnapshotFile, extractSnapshot, normalizeActions, normalizeRoles } from './snapshot-format';

/**
 * Represents a diff between two sets of actions.
 */
export interface ActionsDiff {
  /**
   * Actions that were added (present in current but not baseline).
   */
  added: RecordedAction[];

  /**
   * Actions that were removed (present in baseline but not current).
   */
  removed: RecordedAction[];
}

/**
 * Represents a diff between two sets of roles.
 */
export interface RolesDiff {
  /**
   * Roles that were added (present in current but not baseline).
   */
  added: RecordedRole[];

  /**
   * Roles that were removed (present in baseline but not current).
   */
  removed: RecordedRole[];
}

/**
 * Complete diff result between two snapshots.
 */
export interface SnapshotDiff {
  /**
   * Whether there are any differences.
   */
  hasDifferences: boolean;

  /**
   * Differences in actions.
   */
  actions: ActionsDiff;

  /**
   * Differences in assumed roles.
   */
  roles: RolesDiff;

  /**
   * Total number of changes (additions + removals).
   */
  totalChanges: number;
}

/**
 * Compare two permissions snapshots.
 *
 * @param baseline - The baseline (expected) snapshot
 * @param current - The current (actual) snapshot
 * @returns Detailed diff between the two snapshots
 */
export function compareSnapshots(
  baseline: PermissionsSnapshot,
  current: PermissionsSnapshot,
): SnapshotDiff {
  const baselineActions = normalizeActions(baseline.actions);
  const currentActions = normalizeActions(current.actions);
  const baselineRoles = normalizeRoles(baseline.assumedRoles);
  const currentRoles = normalizeRoles(current.assumedRoles);

  const actionsDiff = compareActions(baselineActions, currentActions);
  const rolesDiff = compareRoles(baselineRoles, currentRoles);

  const totalChanges =
    actionsDiff.added.length +
    actionsDiff.removed.length +
    rolesDiff.added.length +
    rolesDiff.removed.length;

  return {
    hasDifferences: totalChanges > 0,
    actions: actionsDiff,
    roles: rolesDiff,
    totalChanges,
  };
}

/**
 * Compare two snapshot files.
 *
 * @param baseline - The baseline snapshot file (or null for new snapshot)
 * @param current - The current snapshot file
 * @returns Detailed diff between the two snapshots
 */
export function compareSnapshotFiles(
  baseline: SnapshotFile | null,
  current: SnapshotFile,
): SnapshotDiff {
  const baselineSnapshot: PermissionsSnapshot = baseline
    ? extractSnapshot(baseline)
    : { actions: [], assumedRoles: [] };

  const currentSnapshot = extractSnapshot(current);

  return compareSnapshots(baselineSnapshot, currentSnapshot);
}

/**
 * Compare two sets of actions.
 */
function compareActions(
  baseline: RecordedAction[],
  current: RecordedAction[],
): ActionsDiff {
  const baselineSet = new Set(baseline.map(a => actionKey(a)));
  const currentSet = new Set(current.map(a => actionKey(a)));

  const added = current.filter(a => !baselineSet.has(actionKey(a)));
  const removed = baseline.filter(a => !currentSet.has(actionKey(a)));

  return { added, removed };
}

/**
 * Compare two sets of roles.
 */
function compareRoles(
  baseline: RecordedRole[],
  current: RecordedRole[],
): RolesDiff {
  const baselineSet = new Set(baseline.map(r => r.roleArn));
  const currentSet = new Set(current.map(r => r.roleArn));

  const added = current.filter(r => !baselineSet.has(r.roleArn));
  const removed = baseline.filter(r => !currentSet.has(r.roleArn));

  return { added, removed };
}

/**
 * Generate a unique key for an action.
 */
function actionKey(action: RecordedAction): string {
  return `${action.service}:${action.action}`;
}

/**
 * Format a diff as a human-readable string.
 *
 * @param diff - The diff to format
 * @returns A multi-line string describing the changes
 */
export function formatDiff(diff: SnapshotDiff): string {
  if (!diff.hasDifferences) {
    return 'No differences detected.';
  }

  const lines: string[] = [];
  lines.push(`Permissions snapshot changed (${diff.totalChanges} changes):`);
  lines.push('');

  // Actions diff
  if (diff.actions.added.length > 0 || diff.actions.removed.length > 0) {
    lines.push('Actions:');
    for (const action of diff.actions.added) {
      lines.push(`  + ${action.service}:${action.action}`);
    }
    for (const action of diff.actions.removed) {
      lines.push(`  - ${action.service}:${action.action}`);
    }
    lines.push('');
  }

  // Roles diff
  if (diff.roles.added.length > 0 || diff.roles.removed.length > 0) {
    lines.push('Assumed Roles:');
    for (const role of diff.roles.added) {
      lines.push(`  + ${role.roleArn} (via ${role.assumedVia})`);
    }
    for (const role of diff.roles.removed) {
      lines.push(`  - ${role.roleArn} (via ${role.assumedVia})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check if a snapshot matches a baseline.
 *
 * This is a convenience function that returns true if there are no differences.
 *
 * @param baseline - The baseline snapshot (or null)
 * @param current - The current snapshot
 * @returns True if the snapshots match
 */
export function snapshotsMatch(
  baseline: PermissionsSnapshot | null,
  current: PermissionsSnapshot,
): boolean {
  const baselineSnapshot = baseline ?? { actions: [], assumedRoles: [] };
  const diff = compareSnapshots(baselineSnapshot, current);
  return !diff.hasDifferences;
}
