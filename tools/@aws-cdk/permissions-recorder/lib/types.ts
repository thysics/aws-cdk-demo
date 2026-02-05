/**
 * Type definitions for the permissions recorder package
 */

/**
 * Snapshot version for forward compatibility
 */
export const SNAPSHOT_VERSION = '1.0';

/**
 * Interface representing a permissions snapshot
 */
export interface PermissionsSnapshot {
  /**
   * Version of the snapshot format
   */
  readonly version: string;

  /**
   * List of IAM role ARNs that were assumed
   */
  readonly roles: string[];

  /**
   * Map of service:action to call count
   */
  readonly actions: Record<string, number>;
}

/**
 * Configuration options for permissions recording
 */
export interface PermissionsRecordingConfig {
  /**
   * Whether permissions recording is enabled
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * Directory to write the permissions snapshot
   */
  readonly snapshotDir?: string;

  /**
   * Name of the snapshot file (without extension)
   * @default 'permissions'
   */
  readonly snapshotName?: string;
}

/**
 * Environment variable names for permissions recording configuration
 */
export const ENV_VARS = {
  /**
   * Set to "true" to enable permissions recording
   */
  PERMISSIONS_SNAPSHOT: 'CDK_INTEG_PERMISSIONS_SNAPSHOT',

  /**
   * Directory to write the permissions snapshot
   */
  SNAPSHOT_DIR: 'CDK_INTEG_SNAPSHOT_DIR',
} as const;

/**
 * Default file name for permissions snapshots
 */
export const DEFAULT_SNAPSHOT_FILENAME = 'permissions.snapshot.json';
