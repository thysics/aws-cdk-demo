/**
 * Report generation for permission tracking test results.
 *
 * Provides utilities for generating reports in various formats
 * (console, markdown, JSON) for CI/CD integration.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import * as fs from 'fs';
import * as path from 'path';
import { SnapshotDiff } from './snapshot-comparison';
import { getPlainTextDiff, formatChangelogEntry } from './cli-helpers';

/**
 * Options for permission tracking report generation.
 */
export interface ReportOptions {
  /**
   * Output format for the report.
   */
  format: 'console' | 'markdown' | 'json';

  /**
   * Include verbose details in the report.
   * @default false
   */
  verbose?: boolean;
}

/**
 * Result of a single test's permission tracking.
 */
export interface TestPermissionResult {
  /**
   * Name of the test.
   */
  testName: string;

  /**
   * Path to the permission snapshot file.
   */
  snapshotPath: string;

  /**
   * Whether the test passed (no permission changes or updated).
   */
  passed: boolean;

  /**
   * The snapshot diff if there were changes.
   */
  diff?: SnapshotDiff;

  /**
   * Error message if an error occurred during tracking.
   */
  error?: string;
}

/**
 * Summary statistics for a permission report.
 */
interface ReportSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  errorTests: number;
  totalAddedRoles: number;
  totalRemovedRoles: number;
  totalAddedActions: number;
  totalRemovedActions: number;
}

/**
 * Generate a permissions report for a set of test results.
 *
 * @param results - array of test permission results.
 * @param options - report generation options.
 * @returns formatted report string in the specified format.
 *
 * @example
 * ```typescript
 * const results: TestPermissionResult[] = [
 *   { testName: 'integ.test1', snapshotPath: '/path/to/snapshot', passed: true },
 *   { testName: 'integ.test2', snapshotPath: '/path/to/snapshot', passed: false, diff: snapshotDiff },
 * ];
 * const report = generateReport(results, { format: 'markdown' });
 * console.log(report);
 * ```
 */
export function generateReport(results: TestPermissionResult[], options: ReportOptions): string {
  switch (options.format) {
    case 'console':
      return generateConsoleReport(results, options.verbose ?? false);
    case 'markdown':
      return generateMarkdownReport(results, options.verbose ?? false);
    case 'json':
      return generateJsonReport(results);
    default:
      throw new Error(`unknown report format: ${options.format}`);
  }
}

/**
 * Generate a console-formatted report.
 */
function generateConsoleReport(results: TestPermissionResult[], verbose: boolean): string {
  const lines: string[] = [];
  const summary = calculateSummary(results);

  lines.push('═'.repeat(60));
  lines.push('  PERMISSION SNAPSHOT TEST REPORT');
  lines.push('═'.repeat(60));
  lines.push('');

  // print summary
  lines.push('Summary:');
  lines.push(`  Total tests:  ${summary.totalTests}`);
  lines.push(`  Passed:       ${summary.passedTests}`);
  lines.push(`  Failed:       ${summary.failedTests}`);
  if (summary.errorTests > 0) {
    lines.push(`  Errors:       ${summary.errorTests}`);
  }
  lines.push('');

  if (summary.failedTests > 0) {
    lines.push('Permission changes:');
    lines.push(`  Added roles:    ${summary.totalAddedRoles}`);
    lines.push(`  Removed roles:  ${summary.totalRemovedRoles}`);
    lines.push(`  Added actions:  ${summary.totalAddedActions}`);
    lines.push(`  Removed actions: ${summary.totalRemovedActions}`);
    lines.push('');
  }

  // print test details
  lines.push('─'.repeat(60));
  lines.push('Test Results:');
  lines.push('─'.repeat(60));

  for (const result of results) {
    if (result.error) {
      lines.push(`[ERROR] ${result.testName}`);
      lines.push(`        ${result.error}`);
    } else if (result.passed) {
      lines.push(`[PASS]  ${result.testName}`);
    } else {
      lines.push(`[FAIL]  ${result.testName}`);
      if (verbose && result.diff) {
        const diffText = getPlainTextDiff(result.testName, result.diff);
        const indentedDiff = diffText.split('\n').map(line => `        ${line}`).join('\n');
        lines.push(indentedDiff);
      }
    }
  }

  lines.push('');
  lines.push('─'.repeat(60));

  if (summary.failedTests > 0) {
    lines.push('');
    lines.push('To update snapshots, run with --update-permissions-snapshot');
  }

  return lines.join('\n');
}

/**
 * Generate a markdown-formatted report.
 */
function generateMarkdownReport(results: TestPermissionResult[], verbose: boolean): string {
  const lines: string[] = [];
  const summary = calculateSummary(results);

  lines.push('# Permission Snapshot Test Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total tests | ${summary.totalTests} |`);
  lines.push(`| Passed | ${summary.passedTests} |`);
  lines.push(`| Failed | ${summary.failedTests} |`);
  if (summary.errorTests > 0) {
    lines.push(`| Errors | ${summary.errorTests} |`);
  }
  lines.push('');

  if (summary.failedTests > 0) {
    lines.push('### Permission Changes');
    lines.push('');
    lines.push('| Change Type | Count |');
    lines.push('|-------------|-------|');
    lines.push(`| Added roles | ${summary.totalAddedRoles} |`);
    lines.push(`| Removed roles | ${summary.totalRemovedRoles} |`);
    lines.push(`| Added actions | ${summary.totalAddedActions} |`);
    lines.push(`| Removed actions | ${summary.totalRemovedActions} |`);
    lines.push('');
  }

  lines.push('## Test Results');
  lines.push('');

  // passed tests
  const passedTests = results.filter(r => r.passed && !r.error);
  if (passedTests.length > 0) {
    lines.push('### Passed Tests');
    lines.push('');
    for (const result of passedTests) {
      lines.push(`- ✅ ${result.testName}`);
    }
    lines.push('');
  }

  // failed tests
  const failedTests = results.filter(r => !r.passed && !r.error);
  if (failedTests.length > 0) {
    lines.push('### Failed Tests');
    lines.push('');
    for (const result of failedTests) {
      lines.push(`- ❌ ${result.testName}`);
      if (verbose && result.diff) {
        lines.push('');
        lines.push(formatChangelogEntry(result.testName, result.diff));
      }
    }
    lines.push('');
  }

  // error tests
  const errorTests = results.filter(r => r.error);
  if (errorTests.length > 0) {
    lines.push('### Tests with Errors');
    lines.push('');
    for (const result of errorTests) {
      lines.push(`- ⚠️ ${result.testName}`);
      lines.push(`  - Error: ${result.error}`);
    }
    lines.push('');
  }

  if (summary.failedTests > 0) {
    lines.push('---');
    lines.push('');
    lines.push('> To update snapshots, run with `--update-permissions-snapshot`');
  }

  return lines.join('\n');
}

/**
 * JSON report structure.
 */
interface JsonReport {
  timestamp: string;
  summary: ReportSummary;
  results: Array<{
    testName: string;
    snapshotPath: string;
    status: 'passed' | 'failed' | 'error';
    diff?: SnapshotDiff;
    error?: string;
  }>;
}

/**
 * Generate a JSON-formatted report.
 */
function generateJsonReport(results: TestPermissionResult[]): string {
  const summary = calculateSummary(results);

  const report: JsonReport = {
    timestamp: new Date().toISOString(),
    summary,
    results: results.map(r => ({
      testName: r.testName,
      snapshotPath: r.snapshotPath,
      status: r.error ? 'error' : (r.passed ? 'passed' : 'failed'),
      diff: r.diff,
      error: r.error,
    })),
  };

  return JSON.stringify(report, null, 2);
}

/**
 * Calculate summary statistics from test results.
 */
function calculateSummary(results: TestPermissionResult[]): ReportSummary {
  let totalAddedRoles = 0;
  let totalRemovedRoles = 0;
  let totalAddedActions = 0;
  let totalRemovedActions = 0;

  for (const result of results) {
    if (result.diff) {
      totalAddedRoles += result.diff.addedRoles.length;
      totalRemovedRoles += result.diff.removedRoles.length;

      for (const actions of Object.values(result.diff.addedActions)) {
        totalAddedActions += actions.length;
      }
      for (const actions of Object.values(result.diff.removedActions)) {
        totalRemovedActions += actions.length;
      }
    }
  }

  return {
    totalTests: results.length,
    passedTests: results.filter(r => r.passed && !r.error).length,
    failedTests: results.filter(r => !r.passed && !r.error).length,
    errorTests: results.filter(r => r.error !== undefined).length,
    totalAddedRoles,
    totalRemovedRoles,
    totalAddedActions,
    totalRemovedActions,
  };
}

/**
 * Write permissions report to file.
 *
 * @param content - the report content to write.
 * @param outputPath - the file path to write to.
 *
 * @example
 * ```typescript
 * const report = generateReport(results, { format: 'markdown' });
 * writeReport(report, '/path/to/report.md');
 * ```
 */
export function writeReport(content: string, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, content, 'utf-8');
}

/**
 * Generate GitHub Actions annotation format for CI output.
 *
 * @param results - array of test permission results.
 * @returns formatted string for GitHub Actions.
 */
export function generateGitHubActionsOutput(results: TestPermissionResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (result.error) {
      lines.push(`::error file=${result.snapshotPath}::${result.testName}: ${result.error}`);
    } else if (!result.passed && result.diff) {
      const changes = [];
      if (result.diff.addedRoles.length > 0) {
        changes.push(`+${result.diff.addedRoles.length} roles`);
      }
      if (result.diff.removedRoles.length > 0) {
        changes.push(`-${result.diff.removedRoles.length} roles`);
      }

      const addedActionCount = Object.values(result.diff.addedActions).reduce((sum, arr) => sum + arr.length, 0);
      const removedActionCount = Object.values(result.diff.removedActions).reduce((sum, arr) => sum + arr.length, 0);

      if (addedActionCount > 0) {
        changes.push(`+${addedActionCount} actions`);
      }
      if (removedActionCount > 0) {
        changes.push(`-${removedActionCount} actions`);
      }

      const changesStr = changes.join(', ');
      lines.push(`::error file=${result.snapshotPath}::${result.testName}: Permission snapshot changed (${changesStr})`);
    }
  }

  const failedCount = results.filter(r => !r.passed || r.error).length;
  if (failedCount > 0) {
    lines.push('');
    lines.push(`::warning::${failedCount} permission snapshot(s) need to be updated. Run with --update-permissions-snapshot`);
  }

  return lines.join('\n');
}
