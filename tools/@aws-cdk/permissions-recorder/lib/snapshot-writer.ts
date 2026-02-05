/**
 * Snapshot file I/O utilities for permissions recording
 */

import * as fs from 'fs';
import * as path from 'path';
import { PermissionsSnapshot, DEFAULT_SNAPSHOT_FILENAME } from './types';

/**
 * Write a permissions snapshot to a file
 *
 * @param snapshotDir - Directory to write the snapshot
 * @param snapshot - The permissions snapshot to write
 * @param filename - Optional filename (defaults to 'permissions.snapshot.json')
 * @throws Error if write fails
 */
export function writePermissionsSnapshot(
  snapshotDir: string,
  snapshot: PermissionsSnapshot,
  filename: string = DEFAULT_SNAPSHOT_FILENAME,
): void {
  try {
    // Ensure the directory exists
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const snapshotPath = path.join(snapshotDir, filename);

    // Write with pretty formatting for diff-friendliness
    const content = JSON.stringify(snapshot, null, 2) + '\n';
    fs.writeFileSync(snapshotPath, content, 'utf-8');

    console.log(`Permissions snapshot written to: ${snapshotPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write permissions snapshot to ${snapshotDir}: ${message}`);
  }
}

/**
 * Read a permissions snapshot from a file
 *
 * @param snapshotDir - Directory containing the snapshot
 * @param filename - Optional filename (defaults to 'permissions.snapshot.json')
 * @returns The permissions snapshot, or null if the file doesn't exist
 * @throws Error if read fails (except for file not found)
 */
export function readPermissionsSnapshot(
  snapshotDir: string,
  filename: string = DEFAULT_SNAPSHOT_FILENAME,
): PermissionsSnapshot | null {
  try {
    const snapshotPath = path.join(snapshotDir, filename);

    if (!fs.existsSync(snapshotPath)) {
      return null;
    }

    const content = fs.readFileSync(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content) as PermissionsSnapshot;

    // Validate snapshot structure
    if (!isValidSnapshot(snapshot)) {
      throw new Error('Invalid permissions snapshot format');
    }

    return snapshot;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read permissions snapshot from ${snapshotDir}: ${message}`);
  }
}

/**
 * Check if the given object has a valid PermissionsSnapshot structure
 */
function isValidSnapshot(obj: unknown): obj is PermissionsSnapshot {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const snapshot = obj as Record<string, unknown>;

  // Check version
  if (typeof snapshot.version !== 'string') {
    return false;
  }

  // Check roles array
  if (!Array.isArray(snapshot.roles)) {
    return false;
  }
  if (!snapshot.roles.every((role) => typeof role === 'string')) {
    return false;
  }

  // Check actions object
  if (typeof snapshot.actions !== 'object' || snapshot.actions === null) {
    return false;
  }
  const actions = snapshot.actions as Record<string, unknown>;
  for (const [key, value] of Object.entries(actions)) {
    if (typeof key !== 'string' || typeof value !== 'number') {
      return false;
    }
  }

  return true;
}

/**
 * Safely write a permissions snapshot, handling errors gracefully
 *
 * This function will not throw - it logs errors instead.
 * Useful for integration with test runners where recording failure
 * should not fail the test.
 *
 * @param snapshotDir - Directory to write the snapshot
 * @param snapshot - The permissions snapshot to write
 * @param filename - Optional filename
 * @returns true if write was successful, false otherwise
 */
export function safeWritePermissionsSnapshot(
  snapshotDir: string,
  snapshot: PermissionsSnapshot,
  filename?: string,
): boolean {
  try {
    writePermissionsSnapshot(snapshotDir, snapshot, filename);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::warning::Failed to write permissions snapshot: ${message}`);
    return false;
  }
}

/**
 * Safely read a permissions snapshot, handling errors gracefully
 *
 * This function will not throw on read errors - it returns null and logs errors.
 *
 * @param snapshotDir - Directory containing the snapshot
 * @param filename - Optional filename
 * @returns The permissions snapshot, or null if the file doesn't exist or read failed
 */
export function safeReadPermissionsSnapshot(
  snapshotDir: string,
  filename?: string,
): PermissionsSnapshot | null {
  try {
    return readPermissionsSnapshot(snapshotDir, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::warning::Failed to read permissions snapshot: ${message}`);
    return null;
  }
}
