/**
 * Snapshot comparison utilities for permission tracking.
 *
 * Provides functions to compare permission snapshots and generate
 * human-readable diff output for CLI display.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import { PermissionSnapshot } from './types';

/**
 * Represents the differences between two permission snapshots.
 */
export interface SnapshotDiff {
  /**
   * True if there are any changes between the snapshots.
   */
  hasChanges: boolean;

  /**
   * Role ARNs that were added (present in current but not in baseline).
   */
  addedRoles: string[];

  /**
   * Role ARNs that were removed (present in baseline but not in current).
   */
  removedRoles: string[];

  /**
   * Services that were added (present in current but not in baseline).
   */
  addedServices: string[];

  /**
   * Services that were removed (present in baseline but not in current).
   */
  removedServices: string[];

  /**
   * Actions that were added per service.
   * Keys are service names, values are arrays of added action names.
   */
  addedActions: Record<string, string[]>;

  /**
   * Actions that were removed per service.
   * Keys are service names, values are arrays of removed action names.
   */
  removedActions: Record<string, string[]>;
}

/**
 * Compare two permission snapshots and return the differences.
 *
 * @param baseline - the expected/baseline snapshot, or undefined for new tests.
 * @param current - the current snapshot from the test run.
 * @returns the diff between the snapshots.
 *
 * @example
 * ```typescript
 * const baseline = readPermissionSnapshot('/path/to/baseline.json');
 * const current = tracker.getSnapshot();
 * const diff = compareSnapshots(baseline, current);
 *
 * if (diff.hasChanges) {
 *   console.log('Permissions have changed!');
 *   console.log('Added roles:', diff.addedRoles);
 *   console.log('Removed roles:', diff.removedRoles);
 * }
 * ```
 */
export function compareSnapshots(
  baseline: PermissionSnapshot | undefined,
  current: PermissionSnapshot
): SnapshotDiff {
  // handle case where baseline doesn't exist (new test)
  if (!baseline) {
    return {
      hasChanges: true,
      addedRoles: [...current.roles],
      removedRoles: [],
      addedServices: Object.keys(current.actions).sort(),
      removedServices: [],
      addedActions: { ...current.actions },
      removedActions: {},
    };
  }

  const baselineRoles = new Set(baseline.roles);
  const currentRoles = new Set(current.roles);

  const addedRoles = current.roles.filter(role => !baselineRoles.has(role));
  const removedRoles = baseline.roles.filter(role => !currentRoles.has(role));

  const baselineServices = new Set(Object.keys(baseline.actions));
  const currentServices = new Set(Object.keys(current.actions));

  const addedServices = [...currentServices].filter(s => !baselineServices.has(s)).sort();
  const removedServices = [...baselineServices].filter(s => !currentServices.has(s)).sort();

  const addedActions: Record<string, string[]> = {};
  const removedActions: Record<string, string[]> = {};

  // check for added actions in existing and new services
  for (const service of currentServices) {
    const baselineActions = new Set(baseline.actions[service] ?? []);
    const currentActions = current.actions[service] ?? [];
    const added = currentActions.filter(action => !baselineActions.has(action));
    if (added.length > 0) {
      addedActions[service] = added.sort();
    }
  }

  // check for removed actions in existing and removed services
  for (const service of baselineServices) {
    const currentActions = new Set(current.actions[service] ?? []);
    const baselineActionsArr = baseline.actions[service] ?? [];
    const removed = baselineActionsArr.filter(action => !currentActions.has(action));
    if (removed.length > 0) {
      removedActions[service] = removed.sort();
    }
  }

  const hasChanges =
    addedRoles.length > 0 ||
    removedRoles.length > 0 ||
    addedServices.length > 0 ||
    removedServices.length > 0 ||
    Object.keys(addedActions).length > 0 ||
    Object.keys(removedActions).length > 0;

  return {
    hasChanges,
    addedRoles,
    removedRoles,
    addedServices,
    removedServices,
    addedActions,
    removedActions,
  };
}

/**
 * Format a snapshot diff for display in CLI output.
 *
 * Produces a human-readable string showing what permissions have changed,
 * with additions marked with '+' and removals marked with '-'.
 *
 * @param diff - the snapshot diff to format.
 * @returns a formatted string for CLI display.
 *
 * @example
 * ```typescript
 * const diff = compareSnapshots(baseline, current);
 * if (diff.hasChanges) {
 *   console.log(formatSnapshotDiff(diff));
 * }
 * ```
 */
export function formatSnapshotDiff(diff: SnapshotDiff): string {
  if (!diff.hasChanges) {
    return 'No permission changes detected.';
  }

  const lines: string[] = ['Permission snapshot has changed:', ''];

  // format role changes
  if (diff.addedRoles.length > 0 || diff.removedRoles.length > 0) {
    lines.push('Roles:');
    for (const role of diff.removedRoles) {
      lines.push(`  - ${role}`);
    }
    for (const role of diff.addedRoles) {
      lines.push(`  + ${role}`);
    }
    lines.push('');
  }

  // format service additions
  if (diff.addedServices.length > 0) {
    lines.push('New services:');
    for (const service of diff.addedServices) {
      lines.push(`  + ${service}`);
      const actions = diff.addedActions[service] ?? [];
      for (const action of actions) {
        lines.push(`      + ${action}`);
      }
    }
    lines.push('');
  }

  // format service removals
  if (diff.removedServices.length > 0) {
    lines.push('Removed services:');
    for (const service of diff.removedServices) {
      lines.push(`  - ${service}`);
      const actions = diff.removedActions[service] ?? [];
      for (const action of actions) {
        lines.push(`      - ${action}`);
      }
    }
    lines.push('');
  }

  // format action changes in existing services
  const existingServicesWithChanges = new Set([
    ...Object.keys(diff.addedActions).filter(s => !diff.addedServices.includes(s)),
    ...Object.keys(diff.removedActions).filter(s => !diff.removedServices.includes(s)),
  ]);

  if (existingServicesWithChanges.size > 0) {
    lines.push('Changed services:');
    for (const service of [...existingServicesWithChanges].sort()) {
      lines.push(`  ${service}:`);
      const removed = diff.removedActions[service] ?? [];
      const added = diff.addedActions[service] ?? [];
      for (const action of removed) {
        lines.push(`    - ${action}`);
      }
      for (const action of added) {
        lines.push(`    + ${action}`);
      }
    }
    lines.push('');
  }

  lines.push('To update the snapshot, run with --update-permissions-snapshot');

  return lines.join('\n');
}

/**
 * Check if two snapshots are equal.
 *
 * @param snapshot1 - first snapshot to compare.
 * @param snapshot2 - second snapshot to compare.
 * @returns true if the snapshots are equivalent.
 */
export function snapshotsAreEqual(
  snapshot1: PermissionSnapshot | undefined,
  snapshot2: PermissionSnapshot | undefined
): boolean {
  if (snapshot1 === undefined && snapshot2 === undefined) {
    return true;
  }
  if (snapshot1 === undefined || snapshot2 === undefined) {
    return false;
  }
  const diff = compareSnapshots(snapshot1, snapshot2);
  return !diff.hasChanges;
}
