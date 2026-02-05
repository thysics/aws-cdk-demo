import * as fs from 'fs';
import * as path from 'path';
import type {
  PermissionsSnapshot,
  RecordedIamAction,
  RecordedRoleAssumption,
  SnapshotComparisonResult,
  SnapshotComparisonOptions,
} from './types';
import { SNAPSHOT_VERSION } from './permissions-recorder';

/**
 * Default snapshot file name
 */
export const DEFAULT_SNAPSHOT_FILENAME = 'permissions.snapshot.json';

/**
 * Read a permissions snapshot from a file
 * 
 * @param snapshotPath Path to the snapshot file
 * @returns The permissions snapshot or undefined if file doesn't exist
 */
export function readSnapshot(snapshotPath: string): PermissionsSnapshot | undefined {
  if (!fs.existsSync(snapshotPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content) as PermissionsSnapshot;
    
    // Validate version
    if (!snapshot.version) {
      throw new Error('Invalid snapshot format: missing version');
    }

    return snapshot;
  } catch (error) {
    throw new Error(`Failed to read snapshot from ${snapshotPath}: ${error}`);
  }
}

/**
 * Write a permissions snapshot to a file
 * 
 * @param snapshotPath Path to write the snapshot file
 * @param snapshot The permissions snapshot to write
 */
export function writeSnapshot(snapshotPath: string, snapshot: PermissionsSnapshot): void {
  // Ensure the directory exists
  const dir = path.dirname(snapshotPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write with pretty formatting for readability
  const content = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(snapshotPath, content + '\n', 'utf-8');
}

/**
 * Get the default snapshot path for a test file
 * 
 * @param testFilePath Path to the test file
 * @returns Path to the snapshot file
 */
export function getSnapshotPath(testFilePath: string): string {
  const dir = path.dirname(testFilePath);
  const basename = path.basename(testFilePath, path.extname(testFilePath));
  const snapshotDir = path.join(dir, `${basename}.js.snapshot`);
  return path.join(snapshotDir, DEFAULT_SNAPSHOT_FILENAME);
}

/**
 * Compare two lists of IAM actions
 */
function compareActions(
  expected: RecordedIamAction[],
  actual: RecordedIamAction[],
  ignoreResources: boolean,
): { added: RecordedIamAction[]; removed: RecordedIamAction[] } {
  const actionKey = (action: RecordedIamAction): string => {
    if (ignoreResources) {
      return `${action.service}:${action.action}`;
    }
    return `${action.service}:${action.action}:${(action.resources ?? []).sort().join(',')}`;
  };

  const expectedSet = new Set(expected.map(actionKey));
  const actualSet = new Set(actual.map(actionKey));

  const added = actual.filter(a => !expectedSet.has(actionKey(a)));
  const removed = expected.filter(a => !actualSet.has(actionKey(a)));

  return { added, removed };
}

/**
 * Compare two lists of role assumptions
 */
function compareRoles(
  expected: RecordedRoleAssumption[],
  actual: RecordedRoleAssumption[],
): { added: RecordedRoleAssumption[]; removed: RecordedRoleAssumption[] } {
  const expectedArns = new Set(expected.map(r => r.roleArn));
  const actualArns = new Set(actual.map(r => r.roleArn));

  const added = actual.filter(r => !expectedArns.has(r.roleArn));
  const removed = expected.filter(r => !actualArns.has(r.roleArn));

  return { added, removed };
}

/**
 * Compare two permissions snapshots
 * 
 * @param expected The expected (baseline) snapshot
 * @param actual The actual (current) snapshot
 * @param options Comparison options
 * @returns Comparison result with differences
 */
export function compareSnapshots(
  expected: PermissionsSnapshot,
  actual: PermissionsSnapshot,
  options: SnapshotComparisonOptions = {},
): SnapshotComparisonResult {
  const ignoreResourceArns = options.ignoreResourceArns ?? true;
  const allowAdditionalActions = options.allowAdditionalActions ?? false;
  const allowAdditionalRoles = options.allowAdditionalRoles ?? false;

  const actionComparison = compareActions(
    expected.iamActions,
    actual.iamActions,
    ignoreResourceArns,
  );

  const roleComparison = compareRoles(
    expected.assumedRoles,
    actual.assumedRoles,
  );

  // Determine if snapshots match based on options
  let matches = true;

  // Check for removed actions (always a mismatch)
  if (actionComparison.removed.length > 0) {
    matches = false;
  }

  // Check for added actions (mismatch unless allowed)
  if (actionComparison.added.length > 0 && !allowAdditionalActions) {
    matches = false;
  }

  // Check for removed roles (always a mismatch)
  if (roleComparison.removed.length > 0) {
    matches = false;
  }

  // Check for added roles (mismatch unless allowed)
  if (roleComparison.added.length > 0 && !allowAdditionalRoles) {
    matches = false;
  }

  return {
    matches,
    addedActions: actionComparison.added,
    removedActions: actionComparison.removed,
    addedRoles: roleComparison.added,
    removedRoles: roleComparison.removed,
  };
}

/**
 * Format a comparison result as a human-readable string
 * 
 * @param result The comparison result
 * @returns Formatted string describing the differences
 */
export function formatComparisonResult(result: SnapshotComparisonResult): string {
  if (result.matches) {
    return 'Permissions snapshot matches expected.';
  }

  const lines: string[] = ['Permissions snapshot mismatch detected:'];
  lines.push('');

  if (result.addedActions.length > 0) {
    lines.push('Added IAM Actions:');
    for (const action of result.addedActions) {
      lines.push(`  + ${action.service}:${action.action}`);
      if (action.resources?.length) {
        lines.push(`    Resources: ${action.resources.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (result.removedActions.length > 0) {
    lines.push('Removed IAM Actions:');
    for (const action of result.removedActions) {
      lines.push(`  - ${action.service}:${action.action}`);
      if (action.resources?.length) {
        lines.push(`    Resources: ${action.resources.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (result.addedRoles.length > 0) {
    lines.push('Added Role Assumptions:');
    for (const role of result.addedRoles) {
      lines.push(`  + ${role.roleArn}`);
      if (role.sessionName) {
        lines.push(`    Session: ${role.sessionName}`);
      }
    }
    lines.push('');
  }

  if (result.removedRoles.length > 0) {
    lines.push('Removed Role Assumptions:');
    for (const role of result.removedRoles) {
      lines.push(`  - ${role.roleArn}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Assert that permissions snapshots match
 * Throws an error with detailed diff if they don't match
 * 
 * @param snapshotPath Path to the expected snapshot file
 * @param actual The actual permissions snapshot
 * @param options Comparison options
 */
export function assertSnapshotMatch(
  snapshotPath: string,
  actual: PermissionsSnapshot,
  options: SnapshotComparisonOptions = {},
): void {
  const expected = readSnapshot(snapshotPath);

  if (!expected) {
    throw new Error(
      `Permissions snapshot not found at ${snapshotPath}. ` +
      'Run the test with UPDATE_SNAPSHOTS=true to create it.',
    );
  }

  const result = compareSnapshots(expected, actual, options);

  if (!result.matches) {
    throw new Error(
      formatComparisonResult(result) +
      '\nRun the test with UPDATE_SNAPSHOTS=true to update the snapshot.',
    );
  }
}

/**
 * Update or create a permissions snapshot
 * 
 * @param snapshotPath Path to the snapshot file
 * @param snapshot The snapshot to write
 * @param options Options for the update
 */
export function updateSnapshot(
  snapshotPath: string,
  snapshot: PermissionsSnapshot,
  options: { force?: boolean } = {},
): { created: boolean; updated: boolean } {
  const existing = readSnapshot(snapshotPath);

  if (!existing) {
    writeSnapshot(snapshotPath, snapshot);
    return { created: true, updated: false };
  }

  // Compare to see if update is needed
  const result = compareSnapshots(existing, snapshot);

  if (result.matches && !options.force) {
    return { created: false, updated: false };
  }

  writeSnapshot(snapshotPath, snapshot);
  return { created: false, updated: true };
}
