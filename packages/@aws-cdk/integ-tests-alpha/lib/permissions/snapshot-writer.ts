import * as fs from 'fs';
import * as path from 'path';
import type { PermissionsSnapshot } from './types';

/**
 * Default filename for permissions snapshots
 */
export const DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME = 'permissions.snapshot.json';

/**
 * Utility class for writing and reading permissions snapshots to/from disk.
 *
 * @example
 * ```typescript
 * import { PermissionsSnapshotWriter } from './snapshot-writer';
 *
 * // Write a snapshot
 * const snapshot: PermissionsSnapshot = {
 *   version: '1.0.0',
 *   testName: 'my-test',
 *   capturedAt: '2024-01-15T10:00:00Z',
 *   assumedRoles: [],
 *   iamActions: [{ service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00Z' }],
 * };
 * PermissionsSnapshotWriter.write(snapshot, './integ.test.js.snapshot/');
 *
 * // Read a snapshot
 * const loadedSnapshot = PermissionsSnapshotWriter.read('./integ.test.js.snapshot/');
 * ```
 */
export class PermissionsSnapshotWriter {
  /**
   * Writes a permissions snapshot to a JSON file.
   *
   * The snapshot is written with sorted arrays (roles, actions) to ensure
   * deterministic output for stable diffs.
   *
   * @param snapshot The permissions snapshot to write
   * @param snapshotDir The directory to write to (e.g., integ.test.js.snapshot/)
   * @param filename Optional filename (default: 'permissions.snapshot.json')
   */
  public static write(
    snapshot: PermissionsSnapshot,
    snapshotDir: string,
    filename: string = DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME,
  ): void {
    // Ensure directory exists
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const filePath = path.join(snapshotDir, filename);

    // Create a sorted snapshot for deterministic output
    const sortedSnapshot = PermissionsSnapshotWriter.sortSnapshot(snapshot);

    // Write with 2-space indentation for readability
    fs.writeFileSync(filePath, JSON.stringify(sortedSnapshot, null, 2) + '\n', 'utf-8');
  }

  /**
   * Reads a permissions snapshot from disk.
   *
   * @param snapshotDir The snapshot directory
   * @param filename Optional filename (default: 'permissions.snapshot.json')
   * @returns The snapshot or undefined if not found
   */
  public static read(
    snapshotDir: string,
    filename: string = DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME,
  ): PermissionsSnapshot | undefined {
    const filePath = path.join(snapshotDir, filename);

    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as PermissionsSnapshot;
    } catch (error) {
      // If file is corrupted or cannot be parsed, return undefined
      return undefined;
    }
  }

  /**
   * Creates a sorted copy of the snapshot for deterministic output.
   * Sorts assumed roles by roleArn and IAM actions by service:action.
   */
  private static sortSnapshot(snapshot: PermissionsSnapshot): PermissionsSnapshot {
    return {
      version: snapshot.version,
      testName: snapshot.testName,
      capturedAt: snapshot.capturedAt,
      assumedRoles: [...snapshot.assumedRoles].sort((a, b) => {
        // Sort by roleArn, then by sessionName for deterministic order
        const arnCompare = a.roleArn.localeCompare(b.roleArn);
        if (arnCompare !== 0) return arnCompare;
        return (a.sessionName || '').localeCompare(b.sessionName || '');
      }),
      iamActions: [...snapshot.iamActions].sort((a, b) => {
        // Sort by service:action for deterministic order
        const actionA = `${a.service}:${a.action}`;
        const actionB = `${b.service}:${b.action}`;
        return actionA.localeCompare(actionB);
      }),
    };
  }
}
