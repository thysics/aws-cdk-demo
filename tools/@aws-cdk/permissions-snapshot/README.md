# @aws-cdk/permissions-snapshot

AWS SDK permissions snapshot recording for CDK CLI integration tests.

## Overview

This package provides tools for recording and snapshotting IAM permissions used during AWS CDK CLI integration tests. It intercepts AWS SDK v3 calls and creates deterministic snapshots that can be used to detect unexpected changes to permission requirements.

This helps catch changes that could break deployments for users with strict IAM policies by:
- Recording all IAM actions performed during a test
- Tracking role assumptions
- Comparing against baseline snapshots
- Failing tests when permissions change unexpectedly

## Installation

```bash
npm install @aws-cdk/permissions-snapshot
```

## Usage

### Basic Usage

```typescript
import { PermissionsRecorder } from '@aws-cdk/permissions-snapshot';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Create a recorder for your test
const recorder = new PermissionsRecorder({
  testName: 'my-integ-test',
  snapshotPath: './test/my-integ-test.permissions.snap',
});

// Create AWS SDK clients with the recorder plugin
const s3 = new S3Client({});
s3.middlewareStack.use(recorder.getPlugin());

// Start recording
recorder.start();

// Execute your test
await s3.send(new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'my-key',
  Body: 'content',
}));

// Stop recording and assert against snapshot
recorder.assertSnapshot();
```

### Using the Helper Function

```typescript
import { withPermissionsRecording } from '@aws-cdk/permissions-snapshot';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

await withPermissionsRecording({
  testName: 'my-test',
  snapshotPath: './snapshots/my-test.permissions.snap',
}, async (recorder) => {
  const s3 = new S3Client({});
  s3.middlewareStack.use(recorder.getPlugin());
  
  await s3.send(new PutObjectCommand({
    Bucket: 'my-bucket',
    Key: 'my-key',
    Body: 'content',
  }));
});
```

### Options

```typescript
interface PermissionsRecorderOptions {
  // Name of the test being recorded
  testName: string;
  
  // Path to store the snapshot file
  snapshotPath?: string;
  
  // Whether to update the snapshot if it differs (default: false)
  updateSnapshot?: boolean;
  
  // Whether to include resource ARNs in the snapshot (default: false)
  // Note: May cause snapshots to change frequently with dynamic resources
  includeResources?: boolean;
  
  // Services to exclude from recording
  excludeServices?: string[];
  
  // Actions to exclude from recording
  excludeActions?: string[];
}
```

### Updating Snapshots

When you intentionally change the permissions required by a test, you can update the snapshot:

1. **Via option:**
   ```typescript
   recorder.assertSnapshot({ updateSnapshot: true });
   ```

2. **Via constructor:**
   ```typescript
   const recorder = new PermissionsRecorder({
     testName: 'test',
     updateSnapshot: true,
   });
   ```

3. **Via CLI environment variable:**
   ```bash
   UPDATE_SNAPSHOTS=1 npm test
   ```

## Snapshot Format

Snapshots are stored as JSON files:

```json
{
  "version": "1.0.0",
  "testName": "my-integ-test",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "actions": [
    {
      "service": "s3",
      "action": "PutObject",
      "iamAction": "s3:putObject"
    },
    {
      "service": "sts",
      "action": "AssumeRole",
      "iamAction": "sts:assumeRole"
    }
  ],
  "roleAssumptions": [
    {
      "roleArn": "arn:aws:iam::123456789012:role/DeployRole",
      "sessionName": "cdk-deploy",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ],
  "summary": {
    "totalActions": 2,
    "totalRoleAssumptions": 1,
    "services": ["s3", "sts"]
  }
}
```

## CLI Tool

A CLI tool is provided for managing snapshots:

```bash
# View a snapshot
permissions-snapshot view ./test.permissions.snap

# Compare two snapshots
permissions-snapshot compare ./old.snap ./new.snap

# Merge multiple snapshots
permissions-snapshot merge ./snaps/*.snap -o ./combined.snap

# List snapshots in a directory
permissions-snapshot list ./test/snapshots
```

## Integration with Jest

```typescript
import { PermissionsRecorder } from '@aws-cdk/permissions-snapshot';

describe('MyIntegrationTest', () => {
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    recorder = new PermissionsRecorder({
      testName: expect.getState().currentTestName!,
      snapshotPath: `./snapshots/${expect.getState().currentTestName}.permissions.snap`,
    });
    recorder.start();
  });

  afterEach(() => {
    recorder.assertSnapshot();
  });

  it('should deploy resources', async () => {
    // Your test code
  });
});
```

## Error Handling

When a snapshot assertion fails, a `PermissionsSnapshotError` is thrown:

```typescript
try {
  recorder.assertSnapshot();
} catch (error) {
  if (error instanceof PermissionsSnapshotError) {
    console.log('Test name:', error.testName);
    console.log('Added actions:', error.comparisonResult.addedActions);
    console.log('Removed actions:', error.comparisonResult.removedActions);
    console.log('Snapshot path:', error.snapshotPath);
  }
}
```

## Best Practices

1. **Commit snapshot files** to version control to track permission changes over time.

2. **Review snapshot changes** in pull requests to catch unintended permission changes.

3. **Use meaningful test names** for easier identification of which test's permissions changed.

4. **Exclude dynamic services** that might vary between runs if needed:
   ```typescript
   const recorder = new PermissionsRecorder({
     testName: 'test',
     excludeServices: ['cloudwatch'], // If you don't want to track logging calls
   });
   ```

5. **Document permission changes** in commit messages when updating snapshots intentionally.

## License

Apache-2.0
