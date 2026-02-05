/**
 * AWS CDK Integration Permission Tracker
 *
 * This package provides middleware for tracking AWS SDK v3 API calls
 * during CDK integration tests, enabling permission snapshot testing.
 *
 * @module @aws-cdk/integ-permissions-tracker
 *
 * @example
 * ```typescript
 * import {
 *   PermissionTracker,
 *   createPermissionTrackerPlugin,
 * } from '@aws-cdk/integ-permissions-tracker';
 *
 * import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
 *
 * // create client with permission tracking
 * const client = new S3Client({});
 * client.middlewareStack.use(createPermissionTrackerPlugin());
 *
 * // make api calls
 * await client.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: 'my-key' }));
 *
 * // get permission snapshot
 * const tracker = PermissionTracker.getInstance();
 * const snapshot = tracker.getSnapshot();
 * console.log(JSON.stringify(snapshot, null, 2));
 *
 * // clear for next test
 * tracker.clear();
 * ```
 */

// types
export {
  PermissionRecord,
  PermissionSnapshot,
  PermissionTrackerOptions,
  SnapshotOptions,
} from './types';

// permission tracker
export { PermissionTracker } from './permission-tracker';

// middleware
export {
  createPermissionTrackerMiddleware,
  createPermissionTrackerPlugin,
  extractServiceName,
  extractActionName,
  extractRoleArn,
  formatIamAction,
  PermissionTrackerPlugin,
} from './middleware';
