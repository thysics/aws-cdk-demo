/**
 * Aggregate snapshot utilities for permission tracking.
 *
 * Provides functions to combine multiple test permission snapshots
 * into a single comprehensive permissions document for documentation
 * and auditing purposes.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import * as fs from 'fs';
import * as path from 'path';
import { PermissionSnapshot } from './types';

/**
 * Represents an aggregated view of permissions across all tests.
 */
export interface AggregateSnapshot {
  /**
   * Schema version for the aggregate snapshot.
   */
  version: string;

  /**
   * ISO 8601 timestamp when the aggregate was generated.
   */
  generatedAt: string;

  /**
   * Number of tests included in the aggregate.
   */
  testCount: number;

  /**
   * List of all unique role ARNs assumed across all tests.
   */
  roles: string[];

  /**
   * Map of service names to actions with the tests that use them.
   * Keys are service names (e.g., 's3', 'lambda').
   * Values are arrays of objects with action name and list of test names.
   */
  permissions: Record<string, Array<{ action: string; tests: string[] }>>;
}

/**
 * Input for aggregate snapshot generation.
 */
export interface SnapshotInput {
  /**
   * Name of the test.
   */
  testName: string;

  /**
   * Permission snapshot for the test.
   */
  snapshot: PermissionSnapshot;
}

/**
 * Aggregate multiple test snapshots into a single comprehensive permissions document.
 *
 * This creates a unified view of all permissions required across all integration tests,
 * with tracking of which tests use each permission.
 *
 * @param snapshots - array of test snapshots to aggregate.
 * @returns aggregated snapshot with all permissions and their sources.
 *
 * @example
 * ```typescript
 * const snapshots: SnapshotInput[] = [
 *   { testName: 'integ.test1', snapshot: snapshot1 },
 *   { testName: 'integ.test2', snapshot: snapshot2 },
 * ];
 * const aggregate = aggregateSnapshots(snapshots);
 * console.log(`Total tests: ${aggregate.testCount}`);
 * console.log(`Unique roles: ${aggregate.roles.length}`);
 * ```
 */
export function aggregateSnapshots(snapshots: SnapshotInput[]): AggregateSnapshot {
  // collect all unique roles across tests
  const rolesMap = new Map<string, Set<string>>();

  // collect all service/action combinations with their source tests
  const permissionsMap = new Map<string, Map<string, Set<string>>>();

  for (const { testName, snapshot } of snapshots) {
    // aggregate roles
    for (const role of snapshot.roles) {
      if (!rolesMap.has(role)) {
        rolesMap.set(role, new Set());
      }
      rolesMap.get(role)!.add(testName);
    }

    // aggregate actions by service
    for (const [service, actions] of Object.entries(snapshot.actions)) {
      if (!permissionsMap.has(service)) {
        permissionsMap.set(service, new Map());
      }
      const serviceActions = permissionsMap.get(service)!;

      for (const action of actions) {
        if (!serviceActions.has(action)) {
          serviceActions.set(action, new Set());
        }
        serviceActions.get(action)!.add(testName);
      }
    }
  }

  // build the aggregate permissions structure
  const permissions: Record<string, Array<{ action: string; tests: string[] }>> = {};

  for (const [service, actionsMap] of [...permissionsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    permissions[service] = [];
    for (const [action, tests] of [...actionsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      permissions[service].push({
        action,
        tests: [...tests].sort(),
      });
    }
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    testCount: snapshots.length,
    roles: [...rolesMap.keys()].sort(),
    permissions,
  };
}

/**
 * Write aggregate permissions document to file.
 *
 * The aggregate is written as pretty-printed JSON for human readability.
 *
 * @param snapshot - the aggregate snapshot to write.
 * @param outputPath - the file path to write to.
 *
 * @example
 * ```typescript
 * const aggregate = aggregateSnapshots(snapshots);
 * writeAggregateSnapshot(aggregate, '/path/to/permissions-aggregate.json');
 * ```
 */
export function writeAggregateSnapshot(snapshot: AggregateSnapshot, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(snapshot, null, 2) + '\n';
  fs.writeFileSync(outputPath, content, 'utf-8');
}

/**
 * Read an aggregate snapshot from file.
 *
 * @param filePath - path to the aggregate snapshot file.
 * @returns the aggregate snapshot, or undefined if file doesn't exist.
 */
export function readAggregateSnapshot(filePath: string): AggregateSnapshot | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as AggregateSnapshot;
}

/**
 * Generate a markdown document from an aggregate snapshot.
 *
 * Useful for creating human-readable permission documentation.
 *
 * @param aggregate - the aggregate snapshot to format.
 * @returns markdown-formatted string documenting all permissions.
 *
 * @example
 * ```typescript
 * const aggregate = aggregateSnapshots(snapshots);
 * const markdown = formatAggregateAsMarkdown(aggregate);
 * fs.writeFileSync('PERMISSIONS.md', markdown);
 * ```
 */
export function formatAggregateAsMarkdown(aggregate: AggregateSnapshot): string {
  const lines: string[] = [];

  lines.push('# Required Permissions');
  lines.push('');
  lines.push(`> Generated: ${aggregate.generatedAt}`);
  lines.push(`> Based on ${aggregate.testCount} integration test(s)`);
  lines.push('');

  // roles section
  if (aggregate.roles.length > 0) {
    lines.push('## IAM Roles');
    lines.push('');
    lines.push('The following IAM roles are assumed during integration tests:');
    lines.push('');
    for (const role of aggregate.roles) {
      lines.push(`- \`${role}\``);
    }
    lines.push('');
  }

  // permissions by service
  lines.push('## Permissions by Service');
  lines.push('');

  for (const [service, actions] of Object.entries(aggregate.permissions)) {
    lines.push(`### ${service}`);
    lines.push('');
    lines.push('| Action | Used by Tests |');
    lines.push('|--------|---------------|');

    for (const { action, tests } of actions) {
      const testsStr = tests.length > 3
        ? `${tests.slice(0, 3).join(', ')} (+${tests.length - 3} more)`
        : tests.join(', ');
      lines.push(`| \`${action}\` | ${testsStr} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get summary statistics from an aggregate snapshot.
 *
 * @param aggregate - the aggregate snapshot to analyze.
 * @returns summary statistics object.
 */
export function getAggregateStats(aggregate: AggregateSnapshot): {
  totalRoles: number;
  totalServices: number;
  totalActions: number;
  actionsByService: Record<string, number>;
} {
  const actionsByService: Record<string, number> = {};
  let totalActions = 0;

  for (const [service, actions] of Object.entries(aggregate.permissions)) {
    actionsByService[service] = actions.length;
    totalActions += actions.length;
  }

  return {
    totalRoles: aggregate.roles.length,
    totalServices: Object.keys(aggregate.permissions).length,
    totalActions,
    actionsByService,
  };
}

/**
 * Default filename for aggregate snapshot.
 */
export const AGGREGATE_SNAPSHOT_FILENAME = 'permissions-aggregate.json';

/**
 * Get the default path for aggregate snapshot in a project.
 *
 * @param projectRoot - root directory of the project.
 * @returns default path for aggregate snapshot.
 */
export function getDefaultAggregateSnapshotPath(projectRoot: string): string {
  return path.join(projectRoot, '.permissions', AGGREGATE_SNAPSHOT_FILENAME);
}
