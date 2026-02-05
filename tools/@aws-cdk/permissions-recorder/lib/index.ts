/**
 * @aws-cdk/permissions-recorder
 *
 * AWS SDK v3 middleware for recording IAM roles assumed and actions performed
 * during integration test execution.
 */

// Core recorder
export { PermissionsRecorder, PermissionsSnapshot } from './permissions-recorder';
export { createPermissionsMiddleware, PermissionsMiddlewareOptions } from './middleware';

// Types and constants
export {
  SNAPSHOT_VERSION,
  PermissionsRecordingConfig,
  ENV_VARS,
  DEFAULT_SNAPSHOT_FILENAME,
} from './types';

// Snapshot I/O
export {
  writePermissionsSnapshot,
  readPermissionsSnapshot,
  safeWritePermissionsSnapshot,
  safeReadPermissionsSnapshot,
} from './snapshot-writer';

// SDK client instrumentation
export {
  SdkClientWithMiddleware,
  instrumentSdkClient,
  uninstrumentSdkClient,
  instrumentSdkClients,
  uninstrumentSdkClients,
  isGlobalInstrumentationEnabled,
  applyGlobalInstrumentation,
  createInstrumentedClientFactory,
  instrumentMultipleClients,
} from './sdk-integration';

