/**
 * Snapshot file operations for permission tracking.
 *
 * Provides utilities for reading and writing permission snapshots to disk
 * in a human-readable JSON format.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import * as fs from 'fs';
import * as path from 'path';
import { PermissionSnapshot } from './types';

/**
 * File extension for permission snapshot files.
 */
export const PERMISSION_SNAPSHOT_EXTENSION = '.permissions.snapshot.json';

/**
 * Generate the permission snapshot filename for a test.
 *
 * @param testName - name of the integration test (without .ts extension).
 * @param snapshotDir - directory where snapshots are stored.
 * @returns full path to the permission snapshot file.
 *
 * @example
 * ```typescript
 * const snapshotPath = getPermissionSnapshotPath('integ.my-test', '/path/to/snapshots');
 * // returns: /path/to/snapshots/integ.my-test.permissions.snapshot.json
 * ```
 */
export function getPermissionSnapshotPath(testName: string, snapshotDir: string): string {
  const filename = `${testName}${PERMISSION_SNAPSHOT_EXTENSION}`;
  return path.join(snapshotDir, filename);
}

/**
 * JSON replacer that ensures keys are sorted for deterministic output.
 *
 * @param key - the current key being stringified.
 * @param value - the current value being stringified.
 * @returns the value, with object keys sorted if applicable.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Write a permission snapshot to disk.
 *
 * The snapshot is written as pretty-printed JSON with sorted keys
 * for human readability and deterministic output.
 *
 * @param filePath - full path to the snapshot file.
 * @param snapshot - the permission snapshot to write.
 *
 * @example
 * ```typescript
 * const snapshot: PermissionSnapshot = {
 *   version: '1.0',
 *   roles: ['arn:aws:iam::123456789012:role/MyRole'],
 *   actions: { s3: ['GetObject', 'PutObject'] }
 * };
 * writePermissionSnapshot('/path/to/snapshot.json', snapshot);
 * ```
 */
export function writePermissionSnapshot(filePath: string, snapshot: PermissionSnapshot): void {
  // ensure the directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // pretty print with 2 space indent and sorted keys for deterministic output
  const content = JSON.stringify(snapshot, sortedReplacer, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Read a permission snapshot from disk.
 *
 * @param filePath - full path to the snapshot file.
 * @returns the permission snapshot, or undefined if the file doesn't exist.
 *
 * @example
 * ```typescript
 * const snapshot = readPermissionSnapshot('/path/to/snapshot.json');
 * if (snapshot) {
 *   console.log('Roles:', snapshot.roles);
 *   console.log('Actions:', snapshot.actions);
 * } else {
 *   console.log('No snapshot found');
 * }
 * ```
 */
export function readPermissionSnapshot(filePath: string): PermissionSnapshot | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as PermissionSnapshot;
}

/**
 * Check if a permission snapshot file exists.
 *
 * @param filePath - full path to the snapshot file.
 * @returns true if the file exists, false otherwise.
 */
export function snapshotExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
