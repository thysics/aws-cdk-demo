/**
 * @aws-cdk/permissions-snapshot
 * 
 * This package provides tools for recording and snapshotting IAM permissions
 * used during AWS CDK CLI integration tests. It intercepts AWS SDK v3 calls
 * and creates deterministic snapshots that can be used to detect unexpected
 * changes to permission requirements.
 * 
 * @example
 * ```typescript
 * import { PermissionsRecorder } from '@aws-cdk/permissions-snapshot';
 * import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
 * 
 * // Create a recorder for your test
 * const recorder = new PermissionsRecorder({
 *   testName: 'my-integ-test',
 *   snapshotPath: './test/my-integ-test.permissions.snap',
 * });
 * 
 * // Create AWS SDK clients with the recorder plugin
 * const s3 = new S3Client({});
 * s3.middlewareStack.use(recorder.getPlugin());
 * 
 * // Start recording
 * recorder.start();
 * 
 * // Execute your test
 * await s3.send(new PutObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-key',
 *   Body: 'content',
 * }));
 * 
 * // Stop and assert
 * recorder.assertSnapshot();
 * ```
 */

// Types
export type {
  RecordedAction,
  RoleAssumption,
  PermissionsSnapshot,
  PermissionsSummary,
  SnapshotComparisonResult,
  PermissionsRecorderOptions,
  SnapshotAssertOptions,
} from './types';

// Middleware
export {
  permissionsRecorderPlugin,
  permissionsRecorderMiddleware,
  startRecording,
  stopRecording,
  isRecording,
} from './middleware';

// Snapshot Manager
export {
  SnapshotManager,
  SNAPSHOT_VERSION,
  SNAPSHOT_EXTENSION,
} from './snapshot-manager';

// Recorder
export {
  PermissionsRecorder,
  PermissionsSnapshotError,
  createRecorder,
  withPermissionsRecording,
} from './recorder';

// Jest Setup Helpers
export {
  getPermissionsRecorder,
  getPermissionsRecorderPlugin,
  isPermissionsRecordingEnabled,
  createTestPermissionsRecorder,
} from './jest-setup';
