/**
 * Snapshot reader for permissions snapshot files.
 *
 * This module provides functionality to read and parse permissions
 * snapshot files from disk.
 */

import * as fs from 'fs';
import { SnapshotFile, validateSnapshotFile } from './snapshot-format';

/**
 * Result of reading a snapshot file.
 */
export interface ReadSnapshotResult {
  /**
   * Whether the snapshot file exists.
   */
  exists: boolean;

  /**
   * The parsed snapshot file, or null if it doesn't exist.
   */
  snapshot: SnapshotFile | null;
}

/**
 * Read a permissions snapshot file.
 *
 * If the file doesn't exist, returns { exists: false, snapshot: null }.
 * If the file exists but is invalid, throws an error.
 *
 * @param filePath - Path to the snapshot file
 * @returns The read result with exists flag and parsed snapshot
 */
export function readSnapshot(filePath: string): ReadSnapshotResult {
  if (!fs.existsSync(filePath)) {
    return { exists: false, snapshot: null };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Validate the structure
  validateSnapshotFile(data);

  return { exists: true, snapshot: data as SnapshotFile };
}

/**
 * Check if a snapshot file exists.
 *
 * @param filePath - Path to the snapshot file
 * @returns True if the file exists
 */
export function snapshotExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Read a snapshot file, returning null if it doesn't exist.
 *
 * This is a convenience function for cases where you just want
 * the snapshot or null, without the exists flag.
 *
 * @param filePath - Path to the snapshot file
 * @returns The parsed snapshot file, or null if it doesn't exist
 */
export function readSnapshotOrNull(filePath: string): SnapshotFile | null {
  const result = readSnapshot(filePath);
  return result.snapshot;
}

/**
 * Read and parse a snapshot file, throwing if it doesn't exist.
 *
 * @param filePath - Path to the snapshot file
 * @returns The parsed snapshot file
 * @throws Error if the file doesn't exist
 */
export function readSnapshotRequired(filePath: string): SnapshotFile {
  const result = readSnapshot(filePath);
  if (!result.exists || !result.snapshot) {
    throw new Error(`Snapshot file does not exist: ${filePath}`);
  }
  return result.snapshot;
}
