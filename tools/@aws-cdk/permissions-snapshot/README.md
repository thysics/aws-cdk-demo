# @aws-cdk/permissions-snapshot

AWS SDK v3 middleware for tracking IAM permissions during CDK CLI integration tests.

## Overview

This package provides tools to intercept AWS API calls made during CDK operations and record them as "permissions snapshots". These snapshots serve as:

1. **Regression detection** - Detect when CDK operations start requiring new IAM permissions
2. **Documentation** - Document the minimum IAM permissions needed for CDK commands
3. **Security review** - Allow teams to review permission changes during code review

## Installation

```bash
# This package is part of the CDK monorepo and used internally
npm install @aws-cdk/permissions-snapshot
```

## Quick Start

```typescript
import { PermissionsTracker } from '@aws-cdk/permissions-snapshot';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Get the singleton tracker instance
const tracker = PermissionsTracker.getInstance();

// Create and register your AWS SDK clients
const s3Client = new S3Client({});
tracker.registerClient(s3Client);

// Start tracking
tracker.start();

// Make AWS API calls
await s3Client.send(new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'test-object',
  Body: 'Hello, World!',
}));

// Stop tracking and get the recorded permissions
tracker.stop();
const permissions = tracker.getRecordedPermissions();

console.log(permissions);
// {
//   actions: [{ service: 's3', action: 'PutObject' }],
//   assumedRoles: []
// }
```

## Snapshot File Format

Permissions snapshots are stored as JSON files with the extension `.permissions.snapshot.json`:

```json
{
  "metadata": {
    "version": "1.0",
    "testName": "integ.my-feature",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "description": "Permissions for my-feature integration test"
  },
  "actions": [
    { "service": "cloudformation", "action": "CreateStack" },
    { "service": "cloudformation", "action": "DescribeStacks" },
    { "service": "s3", "action": "CreateBucket" },
    { "service": "s3", "action": "PutObject" }
  ],
  "assumedRoles": [
    {
      "roleArn": "arn:aws:iam::123456789012:role/cdk-hnb659fds-deploy-role-123456789012-us-east-1",
      "assumedVia": "AssumeRole"
    }
  ]
}
```

### Format Details

- **metadata.version**: Schema version (currently "1.0")
- **metadata.testName**: Name of the test that generated this snapshot
- **metadata.timestamp**: When the snapshot was created/updated
- **actions**: Array of AWS API actions, sorted by service then action name
- **assumedRoles**: Array of IAM roles that were assumed (via STS)

## API Reference

### PermissionsTracker

Main class for tracking AWS API calls.

```typescript
class PermissionsTracker {
  // Get the singleton instance
  static getInstance(options?: PermissionsTrackerOptions): PermissionsTracker;
  
  // Register an AWS SDK v3 client for tracking
  registerClient(client: object): void;
  
  // Unregister a client
  unregisterClient(client: object): void;
  
  // Start recording API calls
  start(): void;
  
  // Stop recording API calls
  stop(): void;
  
  // Clear all recorded data
  clear(): void;
  
  // Get the recorded permissions snapshot
  getRecordedPermissions(): PermissionsSnapshot;
}
```

### Configuration Options

```typescript
interface PermissionsTrackerOptions {
  // Services to exclude from tracking (e.g., ['logs'] to skip CloudWatch Logs)
  excludeServices?: string[];
  
  // Specific actions to exclude (format: 'service:action')
  excludeActions?: string[];
}
```

### Snapshot Management Functions

```typescript
// Write a snapshot to file
writeSnapshot(
  snapshot: PermissionsSnapshot,
  filePath: string,
  options: WriteSnapshotOptions
): void;

// Read a snapshot file
readSnapshot(filePath: string): ReadSnapshotResult;

// Compare two snapshots
compareSnapshots(
  baseline: PermissionsSnapshot,
  current: PermissionsSnapshot
): SnapshotDiff;

// Format a diff for human-readable output
formatDiff(diff: SnapshotDiff): string;
```

## Integration with CDK Integration Tests

When running CDK integration tests, permissions tracking is integrated automatically. Use the following CLI flags:

### CLI Flags

| Flag | Description |
|------|-------------|
| `--skip-permissions-snapshot` | Disable permissions tracking entirely |
| `--update-permissions-snapshot` | Update snapshots instead of comparing |
| `--exclude-permission-services <list>` | Comma-separated list of services to exclude |
| `--exclude-permission-actions <list>` | Comma-separated list of actions to exclude |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SKIP_PERMISSIONS_SNAPSHOT=true` | Disable permissions tracking |
| `UPDATE_PERMISSIONS_SNAPSHOT=true` | Update snapshots instead of comparing |

### Example

```bash
# Run tests and update permissions snapshots
yarn integ-runner --directory packages --update-permissions-snapshot

# Run tests without permissions tracking
yarn integ-runner --directory packages --skip-permissions-snapshot

# Exclude noisy services
yarn integ-runner --directory packages --exclude-permission-services logs,events
```

## Handling Snapshot Changes

When a test fails due to permissions snapshot changes:

1. **Review the diff** - Check if the new permissions are expected
2. **If expected** - Run with `--update-permissions-snapshot` to update
3. **If unexpected** - Investigate why new permissions are needed

### Example Workflow for PRs

```bash
# 1. Run tests (will fail if permissions changed)
yarn integ-runner --directory packages

# 2. If permissions changed, review the diff in the test output

# 3. If changes are expected, update the snapshot
yarn integ-runner --directory packages --update-permissions-snapshot

# 4. Commit the updated snapshot files
git add '*.permissions.snapshot.json'
git commit -m "chore: update permissions snapshots"
```

## Best Practices

### Excluding Noisy Services

Some services generate a lot of API calls that may not be relevant for permissions tracking (e.g., CloudWatch Logs for Lambda debugging). You can exclude these:

```typescript
const tracker = PermissionsTracker.getInstance({
  excludeServices: ['logs', 'xray'],
  excludeActions: ['sts:GetCallerIdentity'],
});
```

### Interpreting Permissions Snapshots

The permissions recorded represent the **minimum IAM policy** needed to run the CDK operation. You can use this to:

1. **Create restrictive IAM policies** - Only grant permissions that are actually used
2. **Audit permission changes** - Review PRs that add new permissions
3. **Document requirements** - Include in user-facing documentation

### Aggregating Snapshots

To generate a combined permissions list for all tests:

```bash
# Example: aggregate all permissions for a module
cat packages/@aws-cdk-testing/framework-integ/test/aws-lambda/test/*.permissions.snapshot.json \
  | jq -s '.[].actions | unique_by(.service + ":" + .action)'
```

## Troubleshooting

### Snapshot Not Being Created

Ensure that:
1. The tracker is started before API calls: `tracker.start()`
2. SDK clients are registered: `tracker.registerClient(client)`
3. The tracker is stopped before reading: `tracker.stop()`

### Missing API Calls

If some API calls are not being recorded:
1. Check if the service is in `excludeServices`
2. Verify the SDK client was registered
3. Ensure the tracker was started before the API call

### Different Snapshots in CI vs Local

Snapshots should be deterministic due to sorting, but timing differences can occur if:
1. Different SDK versions are used
2. Different credentials lead to different role assumptions

## Contributing

When adding new integration tests:

1. Run the test once to generate the initial snapshot
2. Review the permissions in the snapshot
3. Commit both the test and the `.permissions.snapshot.json` file

When modifying existing tests:

1. Run the test to see if permissions changed
2. If changed, verify the new permissions are correct
3. Update the snapshot using `--update-permissions-snapshot`
4. Document any significant permission changes in the PR description

## Related Issues

- [#32088](https://github.com/aws/aws-cdk/issues/32088) - Original feature request
- [#29483](https://github.com/aws/aws-cdk/issues/29483) - Example of permission-related breakage
- [#32219](https://github.com/aws/aws-cdk/issues/32219) - Example of permission-related breakage
