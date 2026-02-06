/**
 * CLI helper utilities for permission snapshot testing.
 *
 * Provides functions for printing diffs, summaries, prompts, and changelog entries
 * to support the developer workflow for handling permission changes.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import { SnapshotDiff } from './snapshot-comparison';

/**
 * ANSI color codes for terminal output.
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

/**
 * Options for printing permission diff.
 */
export interface PrintDiffOptions {
  /**
   * Whether to include verbose details.
   * @default false
   */
  verbose?: boolean;
}

/**
 * Print permission snapshot diff to console with colors.
 *
 * @param testName - the name of the test.
 * @param diff - the snapshot diff to print.
 * @param options - optional configuration for output format.
 *
 * @example
 * ```typescript
 * const diff = compareSnapshots(baseline, current);
 * if (diff.hasChanges) {
 *   printPermissionDiff('integ.my-test', diff);
 * }
 * ```
 */
export function printPermissionDiff(
  testName: string,
  diff: SnapshotDiff,
  options?: PrintDiffOptions
): void {
  const verbose = options?.verbose ?? false;

  if (!diff.hasChanges) {
    console.log(`${COLORS.green}✓${COLORS.reset} ${testName}: No permission changes`);
    return;
  }

  console.log(`${COLORS.red}✗${COLORS.reset} ${COLORS.bold}${testName}${COLORS.reset}: Permission snapshot has changed`);
  console.log('');

  // print role changes
  if (diff.addedRoles.length > 0 || diff.removedRoles.length > 0) {
    console.log(`${COLORS.cyan}Roles:${COLORS.reset}`);
    for (const role of diff.removedRoles) {
      console.log(`  ${COLORS.red}- ${role}${COLORS.reset}`);
    }
    for (const role of diff.addedRoles) {
      console.log(`  ${COLORS.green}+ ${role}${COLORS.reset}`);
    }
    console.log('');
  }

  // print new services
  if (diff.addedServices.length > 0) {
    console.log(`${COLORS.cyan}New services:${COLORS.reset}`);
    for (const service of diff.addedServices) {
      console.log(`  ${COLORS.green}+ ${service}${COLORS.reset}`);
      if (verbose) {
        const actions = diff.addedActions[service] ?? [];
        for (const action of actions) {
          console.log(`      ${COLORS.green}+ ${action}${COLORS.reset}`);
        }
      }
    }
    console.log('');
  }

  // print removed services
  if (diff.removedServices.length > 0) {
    console.log(`${COLORS.cyan}Removed services:${COLORS.reset}`);
    for (const service of diff.removedServices) {
      console.log(`  ${COLORS.red}- ${service}${COLORS.reset}`);
      if (verbose) {
        const actions = diff.removedActions[service] ?? [];
        for (const action of actions) {
          console.log(`      ${COLORS.red}- ${action}${COLORS.reset}`);
        }
      }
    }
    console.log('');
  }

  // print changed services (actions added/removed in existing services)
  const existingServicesWithChanges = new Set([
    ...Object.keys(diff.addedActions).filter(s => !diff.addedServices.includes(s)),
    ...Object.keys(diff.removedActions).filter(s => !diff.removedServices.includes(s)),
  ]);

  if (existingServicesWithChanges.size > 0) {
    console.log(`${COLORS.cyan}Changed services:${COLORS.reset}`);
    for (const service of [...existingServicesWithChanges].sort()) {
      console.log(`  ${COLORS.yellow}~ ${service}${COLORS.reset}`);
      const removed = diff.removedActions[service] ?? [];
      const added = diff.addedActions[service] ?? [];
      for (const action of removed) {
        console.log(`    ${COLORS.red}- ${action}${COLORS.reset}`);
      }
      for (const action of added) {
        console.log(`    ${COLORS.green}+ ${action}${COLORS.reset}`);
      }
    }
    console.log('');
  }

  // print update instructions
  console.log(`${COLORS.dim}To update the snapshot, run with ${COLORS.bold}--update-permissions-snapshot${COLORS.reset}`);
}

/**
 * Result entry for a single test's permission tracking.
 */
export interface PermissionTestResult {
  /**
   * Name of the test.
   */
  testName: string;

  /**
   * Whether the test passed (no permission changes).
   */
  passed: boolean;

  /**
   * The snapshot diff if there were changes.
   */
  diff?: SnapshotDiff;
}

/**
 * Print summary of all permission changes across tests.
 *
 * @param results - array of test results to summarize.
 *
 * @example
 * ```typescript
 * const results = [
 *   { testName: 'integ.test1', passed: true },
 *   { testName: 'integ.test2', passed: false, diff: snapshotDiff },
 * ];
 * printPermissionSummary(results);
 * ```
 */
export function printPermissionSummary(results: PermissionTestResult[]): void {
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('');
  console.log(`${COLORS.bold}Permission Snapshot Summary${COLORS.reset}`);
  console.log('═'.repeat(50));
  console.log('');

  // print summary counts
  if (passedCount > 0) {
    console.log(`  ${COLORS.green}✓ ${passedCount} test(s) passed${COLORS.reset}`);
  }
  if (failedCount > 0) {
    console.log(`  ${COLORS.red}✗ ${failedCount} test(s) failed${COLORS.reset}`);
  }
  console.log(`  ${COLORS.dim}Total: ${total} test(s)${COLORS.reset}`);
  console.log('');

  // print failed tests details
  if (failedCount > 0) {
    console.log(`${COLORS.cyan}Failed tests:${COLORS.reset}`);
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  ${COLORS.red}• ${result.testName}${COLORS.reset}`);
      if (result.diff) {
        const changeCount = countChanges(result.diff);
        console.log(`    ${COLORS.dim}(${changeCount} change(s))${COLORS.reset}`);
      }
    }
    console.log('');
    console.log(`${COLORS.yellow}To update all snapshots, run with --update-permissions-snapshot${COLORS.reset}`);
  }
}

/**
 * Count the total number of changes in a diff.
 */
function countChanges(diff: SnapshotDiff): number {
  let count = 0;
  count += diff.addedRoles.length;
  count += diff.removedRoles.length;
  count += diff.addedServices.length;
  count += diff.removedServices.length;
  for (const actions of Object.values(diff.addedActions)) {
    count += actions.length;
  }
  for (const actions of Object.values(diff.removedActions)) {
    count += actions.length;
  }
  return count;
}

/**
 * Interactive prompt to update snapshots (if supported).
 *
 * This is a simplified implementation that checks for TTY and uses readline.
 *
 * @param testName - name of the test to prompt for.
 * @returns promise that resolves to true if user confirms, false otherwise.
 *
 * @example
 * ```typescript
 * const shouldUpdate = await promptUpdateSnapshot('integ.my-test');
 * if (shouldUpdate) {
 *   writePermissionSnapshot(snapshotPath, currentSnapshot);
 * }
 * ```
 */
export async function promptUpdateSnapshot(testName: string): Promise<boolean> {
  // check if we're in an interactive terminal
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(
      `${COLORS.yellow}Update permission snapshot for ${testName}? (y/N): ${COLORS.reset}`,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      }
    );
  });
}

/**
 * Format permissions snapshot changes for CHANGELOG entry.
 *
 * Generates a markdown-formatted entry suitable for inclusion in a CHANGELOG.
 *
 * @param testName - name of the test.
 * @param diff - the snapshot diff to format.
 * @returns formatted markdown string for CHANGELOG.
 *
 * @example
 * ```typescript
 * const entry = formatChangelogEntry('integ.my-test', diff);
 * // Output:
 * // ### Permission changes in integ.my-test
 * // - Added: s3:GetObject, s3:PutObject
 * // - Removed: s3:DeleteObject
 * ```
 */
export function formatChangelogEntry(testName: string, diff: SnapshotDiff): string {
  const lines: string[] = [];

  lines.push(`### Permission changes in ${testName}`);
  lines.push('');

  // format added roles
  if (diff.addedRoles.length > 0) {
    lines.push('**Added roles:**');
    for (const role of diff.addedRoles) {
      lines.push(`- ${role}`);
    }
    lines.push('');
  }

  // format removed roles
  if (diff.removedRoles.length > 0) {
    lines.push('**Removed roles:**');
    for (const role of diff.removedRoles) {
      lines.push(`- ${role}`);
    }
    lines.push('');
  }

  // format added permissions
  const allAddedActions: string[] = [];
  for (const [service, actions] of Object.entries(diff.addedActions)) {
    for (const action of actions) {
      allAddedActions.push(`${service}:${action}`);
    }
  }
  if (allAddedActions.length > 0) {
    lines.push('**Added permissions:**');
    for (const action of allAddedActions.sort()) {
      lines.push(`- ${action}`);
    }
    lines.push('');
  }

  // format removed permissions
  const allRemovedActions: string[] = [];
  for (const [service, actions] of Object.entries(diff.removedActions)) {
    for (const action of actions) {
      allRemovedActions.push(`${service}:${action}`);
    }
  }
  if (allRemovedActions.length > 0) {
    lines.push('**Removed permissions:**');
    for (const action of allRemovedActions.sort()) {
      lines.push(`- ${action}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get a plain text representation of the diff without ANSI colors.
 *
 * Useful for CI environments or file output.
 *
 * @param testName - the name of the test.
 * @param diff - the snapshot diff.
 * @returns plain text representation of the diff.
 */
export function getPlainTextDiff(testName: string, diff: SnapshotDiff): string {
  const lines: string[] = [];

  if (!diff.hasChanges) {
    lines.push(`✓ ${testName}: No permission changes`);
    return lines.join('\n');
  }

  lines.push(`✗ ${testName}: Permission snapshot has changed`);
  lines.push('');

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

  // format new services
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

  // format removed services
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

  // format changed services
  const existingServicesWithChanges = new Set([
    ...Object.keys(diff.addedActions).filter(s => !diff.addedServices.includes(s)),
    ...Object.keys(diff.removedActions).filter(s => !diff.removedServices.includes(s)),
  ]);

  if (existingServicesWithChanges.size > 0) {
    lines.push('Changed services:');
    for (const service of [...existingServicesWithChanges].sort()) {
      lines.push(`  ~ ${service}`);
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
