/**
 * Permissions Snapshot Testing for CDK Integration Tests
 * 
 * This module provides utilities for recording and verifying IAM permissions
 * used during CDK integration test execution. It captures:
 * - IAM roles that are assumed
 * - IAM actions that are performed
 * 
 * The recorded permissions are stored as snapshots that can be compared
 * across test runs to detect changes in IAM requirements.
 */

// Types
export type {
  RecordedIamAction,
  RecordedRoleAssumption,
  PermissionsSnapshot,
  PermissionsRecorderOptions,
  SnapshotComparisonResult,
  SnapshotComparisonOptions,
} from './types';

// Permissions Recorder
export {
  PermissionsRecorder,
  getGlobalRecorder,
  resetGlobalRecorder,
  SNAPSHOT_VERSION,
} from './permissions-recorder';

// SDK Interceptor
export {
  instrumentSdkClient,
  uninstrumentSdkClient,
  wrapSdkClient,
  createSdkInterceptorMiddleware,
} from './sdk-interceptor';
export type { SdkInterceptorOptions } from './sdk-interceptor';

// Snapshot Utilities
export {
  readSnapshot,
  writeSnapshot,
  getSnapshotPath,
  compareSnapshots,
  formatComparisonResult,
  assertSnapshotMatch,
  updateSnapshot,
  DEFAULT_SNAPSHOT_FILENAME,
} from './snapshot-utils';

// Test Harness
export {
  PermissionsSnapshotTest,
  withPermissionsSnapshot,
} from './permissions-snapshot-test';
export type {
  PermissionsSnapshotTestOptions,
  PermissionsSnapshotTestResult,
} from './permissions-snapshot-test';
