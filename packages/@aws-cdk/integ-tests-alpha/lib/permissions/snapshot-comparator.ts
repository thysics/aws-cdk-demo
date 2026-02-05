import type { PermissionsSnapshot } from './types';

/**
 * Represents the differences between two permissions snapshots
 */
export interface SnapshotDiff {
  /**
   * Whether there are any differences between the snapshots
   */
  readonly hasChanges: boolean;

  /**
   * Role ARNs that are in the current snapshot but not in the expected snapshot
   */
  readonly addedRoles: string[];

  /**
   * Role ARNs that are in the expected snapshot but not in the current snapshot
   */
  readonly removedRoles: string[];

  /**
   * IAM actions (in service:action format) that are in the current snapshot but not expected
   */
  readonly addedActions: string[];

  /**
   * IAM actions (in service:action format) that are in the expected snapshot but not in current
   */
  readonly removedActions: string[];
}

/**
 * Utility class for comparing permissions snapshots and generating human-readable diffs.
 *
 * @example
 * ```typescript
 * import { PermissionsSnapshotComparator } from './snapshot-comparator';
 *
 * const diff = PermissionsSnapshotComparator.compare(currentSnapshot, expectedSnapshot);
 * if (diff.hasChanges) {
 *   console.log(PermissionsSnapshotComparator.formatDiff(diff));
 * }
 * ```
 */
export class PermissionsSnapshotComparator {
  /**
   * Compares two snapshots and returns the differences.
   *
   * Comparison is based on unique sets of roles/actions, ignoring order and duplicates.
   *
   * @param current The current/new permissions snapshot
   * @param expected The expected/baseline permissions snapshot (from disk)
   * @returns A SnapshotDiff describing the differences
   */
  public static compare(
    current: PermissionsSnapshot,
    expected: PermissionsSnapshot | undefined,
  ): SnapshotDiff {
    // If no expected snapshot exists, everything in current is "added"
    if (!expected) {
      const currentRoles = PermissionsSnapshotComparator.getUniqueRoles(current);
      const currentActions = PermissionsSnapshotComparator.getUniqueActions(current);

      return {
        hasChanges: currentRoles.length > 0 || currentActions.length > 0,
        addedRoles: currentRoles.sort(),
        removedRoles: [],
        addedActions: currentActions.sort(),
        removedActions: [],
      };
    }

    // Get unique sets
    const currentRolesSet = new Set(PermissionsSnapshotComparator.getUniqueRoles(current));
    const expectedRolesSet = new Set(PermissionsSnapshotComparator.getUniqueRoles(expected));
    const currentActionsSet = new Set(PermissionsSnapshotComparator.getUniqueActions(current));
    const expectedActionsSet = new Set(PermissionsSnapshotComparator.getUniqueActions(expected));

    // Calculate differences
    const addedRoles = [...currentRolesSet].filter(r => !expectedRolesSet.has(r)).sort();
    const removedRoles = [...expectedRolesSet].filter(r => !currentRolesSet.has(r)).sort();
    const addedActions = [...currentActionsSet].filter(a => !expectedActionsSet.has(a)).sort();
    const removedActions = [...expectedActionsSet].filter(a => !currentActionsSet.has(a)).sort();

    const hasChanges = addedRoles.length > 0 ||
      removedRoles.length > 0 ||
      addedActions.length > 0 ||
      removedActions.length > 0;

    return {
      hasChanges,
      addedRoles,
      removedRoles,
      addedActions,
      removedActions,
    };
  }

  /**
   * Formats the diff into a human-readable string.
   *
   * @param diff The snapshot diff to format
   * @returns A human-readable string describing the differences
   */
  public static formatDiff(diff: SnapshotDiff): string {
    if (!diff.hasChanges) {
      return 'No permissions changes detected.';
    }

    const lines: string[] = ['Permissions snapshot mismatch:', ''];

    if (diff.addedRoles.length > 0) {
      lines.push('Added roles:');
      for (const role of diff.addedRoles) {
        lines.push(`  + ${role}`);
      }
      lines.push('');
    }

    if (diff.removedRoles.length > 0) {
      lines.push('Removed roles:');
      for (const role of diff.removedRoles) {
        lines.push(`  - ${role}`);
      }
      lines.push('');
    }

    if (diff.addedActions.length > 0) {
      lines.push('Added actions:');
      for (const action of diff.addedActions) {
        lines.push(`  + ${action}`);
      }
      lines.push('');
    }

    if (diff.removedActions.length > 0) {
      lines.push('Removed actions:');
      for (const action of diff.removedActions) {
        lines.push(`  - ${action}`);
      }
      lines.push('');
    }

    lines.push('Run with --update-permissions-snapshot to update the snapshot.');

    return lines.join('\n');
  }

  /**
   * Extracts unique role ARNs from a snapshot
   */
  private static getUniqueRoles(snapshot: PermissionsSnapshot): string[] {
    return [...new Set(snapshot.assumedRoles.map(r => r.roleArn))];
  }

  /**
   * Extracts unique IAM actions (in service:action format) from a snapshot
   */
  private static getUniqueActions(snapshot: PermissionsSnapshot): string[] {
    return [...new Set(snapshot.iamActions.map(a => `${a.service}:${a.action}`))];
  }
}
