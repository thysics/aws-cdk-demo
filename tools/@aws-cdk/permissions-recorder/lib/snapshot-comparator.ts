/**
 * Snapshot comparison logic and failure reporting for permissions snapshots
 */

import { PermissionsSnapshot } from './types';

/**
 * Interface representing the differences between two snapshots
 */
export interface SnapshotDiff {
  /**
   * Roles that were added (present in actual but not in expected)
   */
  readonly addedRoles: string[];

  /**
   * Roles that were removed (present in expected but not in actual)
   */
  readonly removedRoles: string[];

  /**
   * Actions that were added (present in actual but not in expected)
   */
  readonly addedActions: string[];

  /**
   * Actions that were removed (present in expected but not in actual)
   */
  readonly removedActions: string[];

  /**
   * Actions with changed call counts
   */
  readonly changedActionCounts: Array<{
    action: string;
    oldCount: number;
    newCount: number;
  }>;
}

/**
 * Compare two permissions snapshots and return their differences
 *
 * @param expected - The expected (baseline) snapshot
 * @param actual - The actual (current) snapshot
 * @returns A SnapshotDiff object describing the differences
 */
export function compareSnapshots(
  expected: PermissionsSnapshot,
  actual: PermissionsSnapshot,
): SnapshotDiff {
  // Compare roles
  const expectedRoles = new Set(expected.roles);
  const actualRoles = new Set(actual.roles);

  const addedRoles = actual.roles.filter((role) => !expectedRoles.has(role));
  const removedRoles = expected.roles.filter((role) => !actualRoles.has(role));

  // Compare actions
  const expectedActions = new Set(Object.keys(expected.actions));
  const actualActions = new Set(Object.keys(actual.actions));

  const addedActions = Object.keys(actual.actions).filter(
    (action) => !expectedActions.has(action),
  );
  const removedActions = Object.keys(expected.actions).filter(
    (action) => !actualActions.has(action),
  );

  // Find changed action counts (actions that exist in both but have different counts)
  const changedActionCounts: Array<{
    action: string;
    oldCount: number;
    newCount: number;
  }> = [];

  for (const action of Object.keys(expected.actions)) {
    if (actualActions.has(action)) {
      const oldCount = expected.actions[action];
      const newCount = actual.actions[action];
      if (oldCount !== newCount) {
        changedActionCounts.push({ action, oldCount, newCount });
      }
    }
  }

  // Sort all arrays for deterministic output
  addedRoles.sort();
  removedRoles.sort();
  addedActions.sort();
  removedActions.sort();
  changedActionCounts.sort((a, b) => a.action.localeCompare(b.action));

  return {
    addedRoles,
    removedRoles,
    addedActions,
    removedActions,
    changedActionCounts,
  };
}

/**
 * Check if the diff contains any differences
 *
 * @param diff - The snapshot diff to check
 * @returns true if there are differences, false otherwise
 */
export function hasDifferences(diff: SnapshotDiff): boolean {
  return (
    diff.addedRoles.length > 0 ||
    diff.removedRoles.length > 0 ||
    diff.addedActions.length > 0 ||
    diff.removedActions.length > 0 ||
    diff.changedActionCounts.length > 0
  );
}

/**
 * Format the diff as a human-readable string
 *
 * @param diff - The snapshot diff to format
 * @param testName - Optional test name to include in the output
 * @returns Human-readable diff output
 */
export function formatDiff(diff: SnapshotDiff, testName?: string): string {
  if (!hasDifferences(diff)) {
    return 'No differences found.';
  }

  const lines: string[] = [];

  if (testName) {
    lines.push(`Permissions snapshot mismatch for test: ${testName}`);
    lines.push('');
  }

  if (diff.addedRoles.length > 0) {
    lines.push('ADDED ROLES:');
    for (const role of diff.addedRoles) {
      lines.push(`  + ${role}`);
    }
    lines.push('');
  }

  if (diff.removedRoles.length > 0) {
    lines.push('REMOVED ROLES:');
    for (const role of diff.removedRoles) {
      lines.push(`  - ${role}`);
    }
    lines.push('');
  }

  if (diff.addedActions.length > 0) {
    lines.push('ADDED ACTIONS:');
    for (const action of diff.addedActions) {
      lines.push(`  + ${action}`);
    }
    lines.push('');
  }

  if (diff.removedActions.length > 0) {
    lines.push('REMOVED ACTIONS:');
    for (const action of diff.removedActions) {
      lines.push(`  - ${action}`);
    }
    lines.push('');
  }

  if (diff.changedActionCounts.length > 0) {
    lines.push('CHANGED ACTION COUNTS:');
    for (const { action, oldCount, newCount } of diff.changedActionCounts) {
      lines.push(`  ~ ${action}: ${oldCount} -> ${newCount}`);
    }
    lines.push('');
  }

  lines.push('To update the snapshot, run with CDK_INTEG_UPDATE_PERMISSIONS=true');

  return lines.join('\n');
}

/**
 * Format the diff for GitHub Actions output
 *
 * Uses ::warning:: and ::error:: syntax for visibility in GitHub Actions logs.
 *
 * @param diff - The snapshot diff to format
 * @param testFile - Optional test file path for GitHub Actions file annotation
 * @returns GitHub Actions formatted output
 */
export function formatDiffForGitHub(diff: SnapshotDiff, testFile?: string): string {
  if (!hasDifferences(diff)) {
    return '';
  }

  const messages: string[] = [];
  const fileAnnotation = testFile ? ` file=${testFile}` : '';

  // Summarize changes
  const changes: string[] = [];

  if (diff.addedRoles.length > 0) {
    changes.push(`Added roles: ${diff.addedRoles.join(', ')}`);
  }
  if (diff.removedRoles.length > 0) {
    changes.push(`Removed roles: ${diff.removedRoles.join(', ')}`);
  }
  if (diff.addedActions.length > 0) {
    changes.push(`Added actions: ${diff.addedActions.join(', ')}`);
  }
  if (diff.removedActions.length > 0) {
    changes.push(`Removed actions: ${diff.removedActions.join(', ')}`);
  }
  if (diff.changedActionCounts.length > 0) {
    const countChanges = diff.changedActionCounts.map(
      ({ action, oldCount, newCount }) => `${action}: ${oldCount}->${newCount}`,
    );
    changes.push(`Changed counts: ${countChanges.join(', ')}`);
  }

  // Generate warning message for each change category
  for (const change of changes) {
    messages.push(`::warning${fileAnnotation}::Permissions changed: ${change}`);
  }

  return messages.join('\n');
}

/**
 * Create a summary message for the diff
 *
 * @param diff - The snapshot diff to summarize
 * @returns A brief summary of the differences
 */
export function summarizeDiff(diff: SnapshotDiff): string {
  if (!hasDifferences(diff)) {
    return 'No changes';
  }

  const parts: string[] = [];

  if (diff.addedRoles.length > 0) {
    parts.push(`${diff.addedRoles.length} role(s) added`);
  }
  if (diff.removedRoles.length > 0) {
    parts.push(`${diff.removedRoles.length} role(s) removed`);
  }
  if (diff.addedActions.length > 0) {
    parts.push(`${diff.addedActions.length} action(s) added`);
  }
  if (diff.removedActions.length > 0) {
    parts.push(`${diff.removedActions.length} action(s) removed`);
  }
  if (diff.changedActionCounts.length > 0) {
    parts.push(`${diff.changedActionCounts.length} action count(s) changed`);
  }

  return parts.join(', ');
}
