# @aws-cdk/permissions-recorder

AWS SDK v3 middleware for recording IAM roles assumed and actions performed during integration test execution.

## Overview

This package provides middleware that intercepts AWS SDK v3 API calls to:
- Track all service:action combinations with call counts
- Capture IAM role ARNs from STS AssumeRole calls
- Generate permission snapshots for testing

## Usage

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

## API

### `PermissionsRecorder`

#### Static Properties

- `globalInstance`: Returns the singleton instance of the recorder

#### Instance Methods

- `createMiddleware()`: Returns AWS SDK v3 middleware to record API calls
- `getSnapshot()`: Returns the current recorded permissions as a JSON-serializable object
- `reset()`: Clears all recorded data

#### Instance Properties

- `recordedRoles`: Set of assumed role ARNs
- `recordedActions`: Map of service:action to call count

## License

Apache-2.0
