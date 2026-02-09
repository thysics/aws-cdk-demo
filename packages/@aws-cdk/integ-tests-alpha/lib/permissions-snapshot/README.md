# Permissions Snapshot Testing

This module provides functionality to record and snapshot all IAM permissions (actions and role assumptions) used during CDK CLI integration test execution.

## Overview

Organizations with strict IAM policy requirements often configure their CDK roles to only allow the specific actions and principals currently required. Any changes to which roles are assumed or which actions are performed can break their deployments.

The Permissions Snapshot feature helps catch these changes by:

1. **Recording** all AWS SDK calls and role assumptions during test execution
2. **Storing** these as snapshot files alongside test snapshots
3. **Comparing** against existing snapshots and failing tests when changes are detected
4. **Documenting** the exact permissions required for each CLI command

## Usage

### Basic Usage

Enable permissions snapshot recording in your integration test:

```typescript
import * as integ from '@aws-cdk/integ-tests-alpha';
import { PermissionsSnapshotManager, installSdkCallRecorder } from '@aws-cdk/integ-tests-alpha';
import { S3Client } from '@aws-sdk/client-s3';

// Install the SDK call recorder on your clients
const s3Client = new S3Client({});
installSdkCallRecorder(s3Client);

// Or create a snapshot manager for manual control
const snapshotManager = new PermissionsSnapshotManager('my-test', {
  failOnChange: true,
});

snapshotManager.startRecording();

// ... run your test operations ...

// Validate against existing snapshot
snapshotManager.validateAgainstSnapshot('./test.snapshot/');
```

### Integration with IntegTest

The permissions snapshot can be automatically integrated with IntegTest:

```typescript
import * as integ from '@aws-cdk/integ-tests-alpha';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'TestStack');

new integ.IntegTest(app, 'MyTest', {
  testCases: [stack],
  // Permissions snapshot is automatically enabled
});
```

### Configuration Options

```typescript
const manager = new PermissionsSnapshotManager('test-name', {
  // Enable/disable recording
  recordActions: true,
  recordRoleAssumptions: true,
  
  // Path to store snapshots
  snapshotPath: './snapshots/',
  
  // Whether to update snapshots instead of comparing
  updateSnapshot: false,
  
  // Whether to fail tests on snapshot changes
  failOnChange: true,
  
  // Actions to ignore (e.g., common calls that don't need tracking)
  ignoreActions: ['sts:GetCallerIdentity'],
  
  // Roles to ignore
  ignoreRoles: ['cdk-bootstrap-role'],
});
```

## Snapshot Format

Snapshots are stored as JSON files with the following structure:

```json
{
  "version": "1.0",
  "testName": "my-integ-test",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "actions": [
    {
      "service": "s3",
      "action": "PutObject",
      "resource": "arn:aws:s3:::my-bucket/*",
      "timestamp": "2024-01-15T10:30:01.000Z"
    }
  ],
  "roleAssumptions": [
    {
      "roleArn": "arn:aws:iam::123456789012:role/DeployRole",
      "roleSessionName": "cdk-deploy",
      "timestamp": "2024-01-15T10:30:00.500Z"
    }
  ],
  "actionSummary": [
    {
      "service": "s3",
      "action": "PutObject",
      "count": 5
    }
  ]
}
```

## Handling Snapshot Changes

When a test fails due to snapshot changes:

1. **Review the changes**: The error message will show what actions/roles were added or removed
2. **Determine if expected**: If the change is a bug, fix it. If it's expected, proceed.
3. **Update the snapshot**: Run with `--update-permissions-snapshot` flag
4. **Communicate changes**: The snapshot diff can be shared with customers to notify them of permission changes

## API Reference

### PermissionsTracker

Global singleton that records all AWS SDK calls:

```typescript
const tracker = PermissionsTracker.getInstance();
tracker.startRecording();
// ... SDK calls are recorded ...
tracker.stopRecording();
const actions = tracker.getRecordedActions();
const roles = tracker.getRecordedRoleAssumptions();
```

### PermissionsSnapshotManager

Manages snapshot creation, storage, and comparison:

```typescript
const manager = new PermissionsSnapshotManager('test-name', options);

// Create a snapshot from current recordings
const snapshot = manager.stopRecordingAndCreateSnapshot();

// Save/load snapshots
manager.saveSnapshot(snapshot, './snapshot-dir/');
const loaded = manager.loadSnapshot('./snapshot-dir/');

// Compare snapshots
const result = manager.compareSnapshots(baseline, current);

// Validate current recording against stored snapshot
manager.validateAgainstSnapshot('./snapshot-dir/');
```

### SDK Call Recorder

Middleware plugin for AWS SDK v3 clients:

```typescript
import { installSdkCallRecorder, createSdkCallRecorderPlugin } from '@aws-cdk/integ-tests-alpha';

// Install on existing client
const client = new S3Client({});
installSdkCallRecorder(client);

// Or create plugin for custom use
const plugin = createSdkCallRecorderPlugin();
client.middlewareStack.use(plugin);
```

## Best Practices

1. **Don't ignore too many actions**: Only ignore actions that are truly irrelevant
2. **Review changes carefully**: Permission changes can have security implications
3. **Use meaningful test names**: Makes it easier to track which test requires which permissions
4. **Commit snapshot files**: They should be version controlled alongside test code
5. **Document permission requirements**: Use snapshots as documentation for required permissions

## Related Issues

- [#32088](https://github.com/aws/aws-cdk/issues/32088): Original feature request
- [#29483](https://github.com/aws/aws-cdk/issues/29483): Example of permission change impact
- [#32219](https://github.com/aws/aws-cdk/issues/32219): Another example of breaking change
