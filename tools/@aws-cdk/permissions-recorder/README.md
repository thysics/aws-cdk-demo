# @aws-cdk/permissions-recorder

AWS SDK v3 middleware for recording IAM roles assumed and actions performed during integration test execution.

## Overview

This package provides middleware that intercepts AWS SDK v3 API calls to:
- Track all service:action combinations with call counts
- Capture IAM role ARNs from STS AssumeRole calls
- Generate permission snapshots for testing
- Write and read permission snapshots to/from files
- Compare snapshots and report differences
- Fail tests when permissions change unexpectedly

## Usage

### Basic Recording

```typescript
import { PermissionsRecorder } from '@aws-cdk/permissions-recorder';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

// Use the global instance
const recorder = PermissionsRecorder.globalInstance;

// Create an S3 client with the middleware
const s3Client = new S3Client({});
s3Client.middlewareStack.use(recorder.createMiddleware());

// Make API calls
await s3Client.send(new ListBucketsCommand({}));

// Get the recorded permissions snapshot
const snapshot = recorder.getSnapshot();
console.log(snapshot);
// Output:
// {
//   "version": "1.0",
//   "roles": [],
//   "actions": {
//     "s3:ListBuckets": 1
//   }
// }

// Reset for the next test
recorder.reset();
```

### SDK Client Instrumentation Helpers

```typescript
import {
  instrumentSdkClient,
  instrumentMultipleClients,
  createInstrumentedClientFactory,
} from '@aws-cdk/permissions-recorder';
import { S3Client } from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';

// Instrument a single client
const s3 = instrumentSdkClient(new S3Client({}));

// Instrument multiple clients at once
const [s3Client, stsClient] = instrumentMultipleClients([
  new S3Client({}),
  new STSClient({}),
]);

// Create a factory for instrumented clients
const createS3Client = createInstrumentedClientFactory(
  (config) => new S3Client(config)
);
const client = createS3Client({ region: 'us-east-1' });
```

### Writing and Reading Snapshots

```typescript
import {
  writePermissionsSnapshot,
  readPermissionsSnapshot,
  safeWritePermissionsSnapshot,
} from '@aws-cdk/permissions-recorder';

// Write a snapshot to disk
writePermissionsSnapshot('/path/to/snapshot/dir', snapshot);

// Read an existing snapshot
const existingSnapshot = readPermissionsSnapshot('/path/to/snapshot/dir');

// Safe write (doesn't throw, logs errors instead)
const success = safeWritePermissionsSnapshot('/path/to/snapshot/dir', snapshot);
```

### Snapshot Comparison

```typescript
import {
  compareSnapshots,
  hasDifferences,
  formatDiff,
  formatDiffForGitHub,
} from '@aws-cdk/permissions-recorder';

// Compare two snapshots
const diff = compareSnapshots(expectedSnapshot, actualSnapshot);

// Check if there are differences
if (hasDifferences(diff)) {
  // Get human-readable diff
  console.log(formatDiff(diff, 'integ.lambda.ts'));
  
  // Get GitHub Actions formatted output
  console.log(formatDiffForGitHub(diff, 'test/integ.lambda.ts'));
}
```

Example diff output:
```
Permissions snapshot mismatch for test: integ.lambda.ts

ADDED ROLES:
  + arn:aws:iam::123456789012:role/NewRole

REMOVED ROLES:
  - arn:aws:iam::123456789012:role/OldRole

ADDED ACTIONS:
  + s3:DeleteBucket

REMOVED ACTIONS:
  - s3:PutObject

CHANGED ACTION COUNTS:
  ~ cloudformation:DescribeStacks: 5 -> 8

To update the snapshot, run with CDK_INTEG_UPDATE_PERMISSIONS=true
```

GitHub Actions output:
```
::warning file=test/integ.lambda.ts::Permissions changed: Added actions: s3:DeleteBucket
```

### Assertion Functions

```typescript
import {
  assertPermissionsSnapshot,
  updatePermissionsSnapshot,
  assertOrUpdatePermissionsSnapshot,
  checkPermissionsSnapshot,
} from '@aws-cdk/permissions-recorder';

// Assert permissions match snapshot (throws if different)
assertPermissionsSnapshot('/path/to/snapshot/dir', {
  testName: 'integ.lambda.ts',
  testFile: 'test/integ.lambda.ts',
});

// Update snapshot with current permissions
updatePermissionsSnapshot('/path/to/snapshot/dir');

// Assert or update based on environment variable
// (updates if CDK_INTEG_UPDATE_PERMISSIONS=true)
assertOrUpdatePermissionsSnapshot('/path/to/snapshot/dir');

// Check without throwing
const result = checkPermissionsSnapshot('/path/to/snapshot/dir');
if (!result.passed) {
  console.error(result.message);
}
```

## Snapshot Format

```json
{
  "version": "1.0",
  "roles": ["arn:aws:iam::123456789012:role/MyRole"],
  "actions": {
    "sts:AssumeRole": 1,
    "cloudformation:DescribeStacks": 5,
    "s3:PutObject": 2
  }
}
```

## Environment Variables

- `CDK_INTEG_PERMISSIONS_SNAPSHOT`: Set to "true" to enable permissions recording in integration tests
- `CDK_INTEG_SNAPSHOT_DIR`: Directory to write the permissions snapshot
- `CDK_INTEG_UPDATE_PERMISSIONS`: Set to "true" to update snapshots instead of asserting

## Updating Permissions Snapshots

When permissions change intentionally (e.g., a new AWS service is used), you can update the snapshots:

```bash
# Update all permissions snapshots
CDK_INTEG_UPDATE_PERMISSIONS=true yarn integ-runner ...

# Or use the --update-permissions-snapshot flag (if supported by your runner)
yarn integ-runner --update-permissions-snapshot ...
```

## API Reference

### `PermissionsRecorder`

#### Static Properties

- `globalInstance`: Returns the singleton instance of the recorder
- `resetGlobalInstance()`: Resets the singleton (useful for testing)

#### Instance Methods

- `createMiddleware()`: Returns AWS SDK v3 middleware to record API calls
- `applyToClient(client)`: Helper to apply middleware to an existing client
- `getSnapshot()`: Returns the current recorded permissions as a JSON-serializable object
- `getRecordedPermissions()`: Alias for `getSnapshot()`
- `reset()`: Clears all recorded data
- `start()`: Start recording (enabled by default)
- `stop()`: Stop recording

#### Instance Properties

- `recordedRoles`: Set of assumed role ARNs
- `recordedActions`: Map of service:action to call count
- `isRecording`: Whether recording is currently active

### Snapshot Comparison Functions

- `compareSnapshots(expected, actual)`: Compare two snapshots, returns `SnapshotDiff`
- `hasDifferences(diff)`: Check if the diff has any differences
- `formatDiff(diff, testName?)`: Format diff as human-readable string
- `formatDiffForGitHub(diff, testFile?)`: Format diff with GitHub Actions syntax
- `summarizeDiff(diff)`: Get a brief summary of the differences

### Assertion Functions

- `assertPermissionsSnapshot(dir, options?)`: Assert snapshot matches, throw if different
- `checkPermissionsSnapshot(dir, options?)`: Check snapshot without throwing
- `updatePermissionsSnapshot(dir, options?)`: Update snapshot with current permissions
- `assertOrUpdatePermissionsSnapshot(dir, options?)`: Assert or update based on env var
- `getPermissionsDiff(dir, options?)`: Get the diff between expected and actual
- `isUpdateMode()`: Check if update mode is enabled via environment

### SDK Integration Functions

- `instrumentSdkClient(client, recorder?)`: Add middleware to a single client
- `uninstrumentSdkClient(client)`: Remove middleware from a client
- `instrumentSdkClients(recorder?)`: Enable global instrumentation
- `uninstrumentSdkClients()`: Disable global instrumentation
- `isGlobalInstrumentationEnabled()`: Check if global instrumentation is enabled
- `applyGlobalInstrumentation(client)`: Apply global middleware to a client
- `createInstrumentedClientFactory(factory, recorder?)`: Create a factory that instruments clients
- `instrumentMultipleClients(clients, recorder?)`: Instrument multiple clients at once

### Snapshot I/O Functions

- `writePermissionsSnapshot(dir, snapshot, filename?)`: Write snapshot to file
- `readPermissionsSnapshot(dir, filename?)`: Read snapshot from file (returns null if not found)
- `safeWritePermissionsSnapshot(dir, snapshot, filename?)`: Write without throwing
- `safeReadPermissionsSnapshot(dir, filename?)`: Read without throwing

### Types

- `PermissionsSnapshot`: Interface for the snapshot data structure
- `SnapshotDiff`: Interface for snapshot comparison results
- `AssertionResult`: Interface for assertion function results
- `PermissionsRecordingConfig`: Configuration options
- `ENV_VARS`: Object containing environment variable names
- `DEFAULT_SNAPSHOT_FILENAME`: Default filename for snapshots
- `UPDATE_PERMISSIONS_ENV`: Environment variable for update mode

## License

Apache-2.0
