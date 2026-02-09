/**
 * Snapshot writer for permissions snapshot files.
 *
 * This module provides functionality to write permissions snapshots
 * to JSON files in a deterministic format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PermissionsSnapshot } from './types';
import {
  createSnapshotFile,
  SnapshotFile,
  SNAPSHOT_FILE_EXTENSION,
} from './snapshot-format';

/**
 * Options for writing a snapshot file.
 */
export interface WriteSnapshotOptions {
  /**
   * The test name to include in metadata.
   */
  testName: string;

  /**
   * Optional description to include in metadata.
   */
  description?: string;

  /**
   * Indentation for JSON output.
   * @default 2
   */
  indent?: number;
}

/**
 * Write a permissions snapshot to a file.
 *
 * The snapshot is written as formatted JSON with deterministic ordering
 * to produce consistent git diffs.
 *
 * @param snapshot - The permissions snapshot to write
 * @param filePath - The path to write the file to
 * @param options - Write options
 */
export function writeSnapshot(
  snapshot: PermissionsSnapshot,
  filePath: string,
  options: WriteSnapshotOptions,
): void {
  const snapshotFile = createSnapshotFile(
    snapshot,
    options.testName,
    options.description,
  );

  const json = JSON.stringify(snapshotFile, null, options.indent ?? 2);

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, json + '\n', 'utf-8');
}

/**
 * Generate the snapshot file path for a given test file.
 *
 * @param testFilePath - Path to the test file (e.g., integ.my-test.ts)
 * @returns The corresponding snapshot file path
 *
 * @example
 * ```typescript
 * getSnapshotPath('/path/to/integ.my-test.ts')
 * // Returns: '/path/to/integ.my-test.ts.permissions.snapshot.json'
 * ```
 */
export function getSnapshotPath(testFilePath: string): string {
  // Remove common extensions
  const basePath = testFilePath
    .replace(/\.(js|ts)$/, '')
    .replace(/\.snapshot$/, '');

  return basePath + SNAPSHOT_FILE_EXTENSION;
}

/**
 * Write a snapshot file object directly to disk.
 *
 * This is useful when you need to preserve the original metadata
 * (e.g., when updating only the permissions but keeping the timestamp).
 *
 * @param snapshotFile - The complete snapshot file structure
 * @param filePath - The path to write the file to
 * @param indent - JSON indentation (default: 2)
 */
export function writeSnapshotFile(
  snapshotFile: SnapshotFile,
  filePath: string,
  indent: number = 2,
): void {
  const json = JSON.stringify(snapshotFile, null, indent);

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, json + '\n', 'utf-8');
}
