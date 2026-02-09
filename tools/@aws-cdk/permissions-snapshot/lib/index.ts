/**
 * @aws-cdk/permissions-snapshot
 *
 * AWS SDK v3 middleware for tracking IAM permissions during CDK operations.
 *
 * This package provides tools to intercept AWS API calls and record them
 * for generating permission snapshots. These snapshots can be used to:
 * - Track what IAM permissions are needed for CDK operations
 * - Detect permission changes between versions
 * - Generate minimal IAM policies
 *
 * @example
 * ```typescript
 * import { PermissionsTracker } from '@aws-cdk/permissions-snapshot';
 * import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
 *
 * const tracker = PermissionsTracker.getInstance();
 * const client = new S3Client({});
 *
 * tracker.registerClient(client);
 * tracker.start();
 *
 * await client.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: 'test' }));
 *
 * tracker.stop();
 * console.log(tracker.getRecordedPermissions());
 * // { actions: [{ service: 's3', action: 'PutObject' }], assumedRoles: [] }
 * ```
 *
 * @packageDocumentation
 */

// Export types
export {
  RecordedAction,
  RecordedRole,
  PermissionsSnapshot,
  PermissionsTrackerOptions,
} from './types';

// Export middleware functions
export {
  createPermissionsMiddleware,
  createPermissionsMiddlewarePlugin,
  removePermissionsMiddleware,
  ActionRecorderCallback,
  RoleRecorderCallback,
  PermissionsMiddlewareOptions,
} from './sdk-middleware';

// Export the tracker class
export { PermissionsTracker } from './permissions-tracker';

// Export snapshot format utilities
export {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_FILE_EXTENSION,
  SnapshotMetadata,
  SnapshotFile,
  createSnapshotFile,
  extractSnapshot,
  normalizeActions,
  normalizeRoles,
  validateSnapshotFile,
} from './snapshot-format';

// Export snapshot writer
export {
  WriteSnapshotOptions,
  writeSnapshot,
  writeSnapshotFile,
  getSnapshotPath,
} from './snapshot-writer';

// Export snapshot reader
export {
  ReadSnapshotResult,
  readSnapshot,
  readSnapshotOrNull,
  readSnapshotRequired,
  snapshotExists,
} from './snapshot-reader';

// Export snapshot comparator
export {
  ActionsDiff,
  RolesDiff,
  SnapshotDiff,
  compareSnapshots,
  compareSnapshotFiles,
  formatDiff,
  snapshotsMatch,
} from './snapshot-comparator';
