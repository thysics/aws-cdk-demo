/**
 * Permissions Snapshot for CLI Integration Testing
 *
 * This module provides utilities for recording and validating IAM permissions
 * used during CLI integration tests. It helps detect unexpected changes to
 * the IAM actions performed by the CDK CLI.
 *
 * @example
 * ```typescript
 * import {
 *   PermissionsSnapshotRecorder,
 *   instrumentClient,
 *   createPermissionsInterceptorPlugin,
 * } from './permissions-snapshot';
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
 *
 * // Option 1: Instrument individual clients
 * const s3 = instrumentClient(new S3Client({}));
 * const cfn = instrumentClient(new CloudFormationClient({}));
 *
 * // Option 2: Use the plugin directly
 * const client = new S3Client({});
 * client.middlewareStack.use(createPermissionsInterceptorPlugin());
 *
 * // Record and validate permissions
 * const recorder = new PermissionsSnapshotRecorder({
 *   testName: 'my-integration-test',
 *   snapshotDirectory: './snapshots',
 * });
 *
 * recorder.startRecording();
 * // ... run your test ...
 * const result = recorder.validate();
 *
 * if (!result.match) {
 *   console.log('Permissions changed!');
 * }
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  IamAction,
  RoleAssumption,
  PermissionsSnapshot,
  PermissionsSnapshotRecorderOptions,
  SnapshotComparisonResult,
} from './types';

// SDK Interceptor
export {
  PermissionsCollector,
  getGlobalCollector,
  resetGlobalCollector,
  createPermissionsInterceptorPlugin,
  instrumentClient,
  createInstrumentedClientClass,
} from './sdk-interceptor';
export type { InstrumentationOptions } from './sdk-interceptor';

// Snapshot Recorder
export {
  PermissionsSnapshotRecorder,
  PermissionsSnapshotError,
  compareSnapshots,
  formatComparisonResult,
} from './snapshot-recorder';
export type { PermissionsDocument } from './snapshot-recorder';
