/**
 * JSON schema and format definitions for permissions snapshot files.
 *
 * This module defines the structure of `.permissions.snapshot.json` files
 * that are created alongside integration test snapshots.
 */

import { RecordedAction, RecordedRole, PermissionsSnapshot } from './types';

/**
 * The current version of the snapshot format.
 * Increment when making breaking changes to the schema.
 */
export const SNAPSHOT_FORMAT_VERSION = '1.0';

/**
 * File extension for permissions snapshot files.
 */
export const SNAPSHOT_FILE_EXTENSION = '.permissions.snapshot.json';

/**
 * Metadata included in each snapshot file.
 */
export interface SnapshotMetadata {
  /**
   * Version of the snapshot format.
   */
  readonly version: string;

  /**
   * Name of the test that generated this snapshot.
   */
  readonly testName: string;

  /**
   * ISO timestamp when the snapshot was created/updated.
   */
  readonly timestamp: string;

  /**
   * Optional description or comments about the snapshot.
   */
  readonly description?: string;
}

/**
 * Complete structure of a permissions snapshot file.
 * This is the JSON structure that gets written to disk.
 */
export interface SnapshotFile {
  /**
   * Metadata about the snapshot.
   */
  readonly metadata: SnapshotMetadata;

  /**
   * All unique AWS API actions that were invoked.
   * Sorted by service, then action for deterministic output.
   */
  readonly actions: RecordedAction[];

  /**
   * All unique IAM roles that were assumed.
   * Sorted by roleArn for deterministic output.
   */
  readonly assumedRoles: RecordedRole[];
}

/**
 * Create a snapshot file structure from a permissions snapshot and metadata.
 *
 * @param snapshot - The recorded permissions snapshot
 * @param testName - Name of the test
 * @param description - Optional description
 * @returns A complete snapshot file ready to be serialized
 */
export function createSnapshotFile(
  snapshot: PermissionsSnapshot,
  testName: string,
  description?: string,
): SnapshotFile {
  return {
    metadata: {
      version: SNAPSHOT_FORMAT_VERSION,
      testName,
      timestamp: new Date().toISOString(),
      description,
    },
    actions: normalizeActions(snapshot.actions),
    assumedRoles: normalizeRoles(snapshot.assumedRoles),
  };
}

/**
 * Extract the permissions snapshot from a snapshot file.
 *
 * @param file - The snapshot file structure
 * @returns The permissions snapshot portion
 */
export function extractSnapshot(file: SnapshotFile): PermissionsSnapshot {
  return {
    actions: file.actions,
    assumedRoles: file.assumedRoles,
  };
}

/**
 * Normalize and sort actions for deterministic output.
 *
 * @param actions - Array of recorded actions (may have duplicates)
 * @returns Sorted and deduplicated array of actions
 */
export function normalizeActions(actions: RecordedAction[]): RecordedAction[] {
  const uniqueMap = new Map<string, RecordedAction>();

  for (const action of actions) {
    const key = `${action.service}:${action.action}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, action);
    }
  }

  return Array.from(uniqueMap.values()).sort((a, b) => {
    const serviceCompare = a.service.localeCompare(b.service);
    if (serviceCompare !== 0) return serviceCompare;
    return a.action.localeCompare(b.action);
  });
}

/**
 * Normalize and sort roles for deterministic output.
 *
 * @param roles - Array of recorded roles (may have duplicates)
 * @returns Sorted and deduplicated array of roles
 */
export function normalizeRoles(roles: RecordedRole[]): RecordedRole[] {
  const uniqueMap = new Map<string, RecordedRole>();

  for (const role of roles) {
    if (!uniqueMap.has(role.roleArn)) {
      uniqueMap.set(role.roleArn, role);
    }
  }

  return Array.from(uniqueMap.values()).sort((a, b) =>
    a.roleArn.localeCompare(b.roleArn),
  );
}

/**
 * Validate a snapshot file structure.
 *
 * @param data - Parsed JSON data to validate
 * @returns True if valid, throws if invalid
 */
export function validateSnapshotFile(data: unknown): data is SnapshotFile {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Snapshot file must be an object');
  }

  const obj = data as Record<string, unknown>;

  // Validate metadata
  if (!obj.metadata || typeof obj.metadata !== 'object') {
    throw new Error('Snapshot file must have a metadata object');
  }

  const metadata = obj.metadata as Record<string, unknown>;
  if (typeof metadata.version !== 'string') {
    throw new Error('Snapshot metadata must have a version string');
  }
  if (typeof metadata.testName !== 'string') {
    throw new Error('Snapshot metadata must have a testName string');
  }
  if (typeof metadata.timestamp !== 'string') {
    throw new Error('Snapshot metadata must have a timestamp string');
  }

  // Validate actions array
  if (!Array.isArray(obj.actions)) {
    throw new Error('Snapshot file must have an actions array');
  }

  for (const action of obj.actions) {
    if (typeof action !== 'object' || action === null) {
      throw new Error('Each action must be an object');
    }
    if (typeof (action as Record<string, unknown>).service !== 'string') {
      throw new Error('Each action must have a service string');
    }
    if (typeof (action as Record<string, unknown>).action !== 'string') {
      throw new Error('Each action must have an action string');
    }
  }

  // Validate assumedRoles array
  if (!Array.isArray(obj.assumedRoles)) {
    throw new Error('Snapshot file must have an assumedRoles array');
  }

  for (const role of obj.assumedRoles) {
    if (typeof role !== 'object' || role === null) {
      throw new Error('Each role must be an object');
    }
    if (typeof (role as Record<string, unknown>).roleArn !== 'string') {
      throw new Error('Each role must have a roleArn string');
    }
    if (typeof (role as Record<string, unknown>).assumedVia !== 'string') {
      throw new Error('Each role must have an assumedVia string');
    }
  }

  return true;
}
