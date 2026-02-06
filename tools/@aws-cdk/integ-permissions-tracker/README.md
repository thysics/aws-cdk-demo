# @aws-cdk/integ-permissions-tracker

A package for tracking and snapshotting IAM permissions used during CDK integration tests.

## Overview

This package provides tools to:

- Track all AWS API calls made during integration tests
- Record IAM roles assumed during test execution
- Generate deterministic snapshots of required permissions
- Compare snapshots to detect unexpected permission changes
- Generate documentation of required permissions

## Installation

This package is internal to the AWS CDK repository and is not published to npm.

For development, ensure you have built the package:

```bash
cd tools/@aws-cdk/integ-permissions-tracker
yarn build
```

## Usage

### Basic Usage

```typescript
import {
  PermissionTracker,
  createPermissionTrackerPlugin,
  writePermissionSnapshot,
  readPermissionSnapshot,
  compareSnapshots,
  getPermissionSnapshotPath,
  printPermissionDiff,
} from '@aws-cdk/integ-permissions-tracker';

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Create an SDK client with permission tracking
const client = new S3Client({});
client.middlewareStack.use(createPermissionTrackerPlugin());

// Make API calls - they will be automatically tracked
await client.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: 'my-key' }));

// Get the permission snapshot
const tracker = PermissionTracker.getInstance();
const snapshot = tracker.getSnapshot();

// Compare with existing baseline
const snapshotPath = getPermissionSnapshotPath('integ.my-test', '/path/to/snapshots');
const baseline = readPermissionSnapshot(snapshotPath);
const diff = compareSnapshots(baseline, snapshot);

if (diff.hasChanges) {
  // Print colored diff to console
  printPermissionDiff('integ.my-test', diff);

  // Optionally update the snapshot
  writePermissionSnapshot(snapshotPath, snapshot);
}

// Clear for the next test
tracker.clear();
```

### Enabling Permission Tracking in Integration Tests

Permission tracking can be enabled during integration test execution using:

1. **Environment Variable**: Set `CDK_INTEG_PERMISSIONS_SNAPSHOT=true`
2. **CLI Flag**: Use `--permissions-snapshot` flag with integ-runner

```bash
# Using environment variable
CDK_INTEG_PERMISSIONS_SNAPSHOT=true yarn integ test/aws-lambda/test/integ.lambda.js

# Using CLI flag
yarn integ test/aws-lambda/test/integ.lambda.js --permissions-snapshot
```

### Updating Snapshots

When you intentionally change the permissions used by a test, update the snapshot:

```bash
yarn integ test/aws-lambda/test/integ.lambda.js --update-permissions-snapshot
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CDK_INTEG_PERMISSIONS_SNAPSHOT` | Enable permission tracking during tests | `false` |
| `CDK_INTEG_UPDATE_PERMISSIONS` | Update snapshots instead of failing on diff | `false` |

## Configuration Options

### PermissionTrackerOptions

```typescript
interface PermissionTrackerOptions {
  /**
   * Whether to include timestamps in permission records.
   * @default false
   */
  includeTimestamps?: boolean;

  /**
   * Whether to include region information in permission records.
   * @default true
   */
  includeRegion?: boolean;
}
```

### SnapshotOptions

```typescript
interface SnapshotOptions {
  /**
   * Schema version to use for the snapshot.
   * @default '1.0'
   */
  version?: string;
}
```

## Snapshot File Format

Permission snapshots are stored as JSON files with the extension `.permissions.snapshot.json`.

### Schema

```json
{
  "version": "1.0",
  "roles": [
    "arn:aws:iam::123456789012:role/TestRole",
    "arn:aws:iam::123456789012:role/DeployRole"
  ],
  "actions": {
    "cloudformation": [
      "CreateStack",
      "DeleteStack",
      "DescribeStacks",
      "UpdateStack"
    ],
    "lambda": [
      "CreateFunction",
      "DeleteFunction",
      "GetFunction",
      "InvokeFunction"
    ],
    "s3": [
      "CreateBucket",
      "DeleteBucket",
      "GetObject",
      "PutObject"
    ],
    "sts": [
      "AssumeRole"
    ]
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Schema version for forward compatibility (currently `"1.0"`) |
| `roles` | `string[]` | Sorted array of unique IAM role ARNs that were assumed |
| `actions` | `Record<string, string[]>` | Map of service names to sorted arrays of action names |

### File Location

Snapshot files are stored in the test's `.snapshot` directory alongside CloudFormation template snapshots:

```
test/aws-lambda/test/
├── integ.lambda.ts
└── integ.lambda.js.snapshot/
    ├── manifest.json
    ├── tree.json
    ├── LambdaStack.template.json
    └── integ.lambda.permissions.snapshot.json
```

## API Reference

### Classes

#### PermissionTracker

Singleton class that collects and manages permission records.

```typescript
class PermissionTracker {
  // Get the singleton instance
  static getInstance(options?: PermissionTrackerOptions): PermissionTracker;

  // Reset the singleton instance (for testing)
  static resetInstance(): void;

  // Record an AWS API call
  recordCall(service: string, action: string, metadata?: { roleArn?: string; region?: string }): void;

  // Record an IAM role assumption
  recordRoleAssumption(roleArn: string): void;

  // Get all recorded permission records
  getRecords(): PermissionRecord[];

  // Get all assumed role ARNs
  getAssumedRoles(): string[];

  // Generate a deterministic permission snapshot
  getSnapshot(options?: SnapshotOptions): PermissionSnapshot;

  // Clear all recorded permissions
  clear(): void;

  // Get the number of recorded calls
  readonly recordCount: number;

  // Check if any permissions have been recorded
  readonly isEmpty: boolean;
}
```

### Functions

#### Middleware

```typescript
// Create AWS SDK v3 middleware for permission tracking
function createPermissionTrackerMiddleware(tracker?: PermissionTracker): MiddlewareHandler;

// Create a plugin object for SDK clients
function createPermissionTrackerPlugin(tracker?: PermissionTracker): PermissionTrackerPlugin;

// Extract service name from client name (e.g., 'S3Client' -> 's3')
function extractServiceName(clientName: string | undefined): string;

// Extract action name from command name (e.g., 'GetObjectCommand' -> 'GetObject')
function extractActionName(commandName: string | undefined): string;

// Format IAM action string (e.g., 's3', 'GetObject' -> 's3:GetObject')
function formatIamAction(service: string, action: string): string;
```

#### Snapshot File Operations

```typescript
// Get the permission snapshot file path for a test
function getPermissionSnapshotPath(testName: string, snapshotDir: string): string;

// Write a permission snapshot to disk
function writePermissionSnapshot(filePath: string, snapshot: PermissionSnapshot): void;

// Read a permission snapshot from disk
function readPermissionSnapshot(filePath: string): PermissionSnapshot | undefined;

// Check if a permission snapshot file exists
function snapshotExists(filePath: string): boolean;
```

#### Snapshot Comparison

```typescript
// Compare two snapshots and return differences
function compareSnapshots(baseline: PermissionSnapshot | undefined, current: PermissionSnapshot): SnapshotDiff;

// Format a diff for CLI display
function formatSnapshotDiff(diff: SnapshotDiff): string;

// Check if two snapshots are equal
function snapshotsAreEqual(snapshot1: PermissionSnapshot | undefined, snapshot2: PermissionSnapshot | undefined): boolean;
```

#### CLI Helpers

```typescript
// Print permission diff with colors to console
function printPermissionDiff(testName: string, diff: SnapshotDiff, options?: PrintDiffOptions): void;

// Print summary of all permission changes across tests
function printPermissionSummary(results: PermissionTestResult[]): void;

// Interactive prompt to update snapshots
function promptUpdateSnapshot(testName: string): Promise<boolean>;

// Format diff as a CHANGELOG entry
function formatChangelogEntry(testName: string, diff: SnapshotDiff): string;

// Get plain text diff without ANSI colors
function getPlainTextDiff(testName: string, diff: SnapshotDiff): string;
```

#### Reporting

```typescript
// Generate a permissions report
function generateReport(results: TestPermissionResult[], options: ReportOptions): string;

// Write report to file
function writeReport(content: string, outputPath: string): void;

// Generate GitHub Actions annotation format
function generateGitHubActionsOutput(results: TestPermissionResult[]): string;
```

#### Aggregate Snapshots

```typescript
// Combine multiple test snapshots into one
function aggregateSnapshots(snapshots: SnapshotInput[]): AggregateSnapshot;

// Write aggregate snapshot to file
function writeAggregateSnapshot(snapshot: AggregateSnapshot, outputPath: string): void;

// Read aggregate snapshot from file
function readAggregateSnapshot(filePath: string): AggregateSnapshot | undefined;

// Format aggregate as markdown documentation
function formatAggregateAsMarkdown(aggregate: AggregateSnapshot): string;

// Get statistics from aggregate snapshot
function getAggregateStats(aggregate: AggregateSnapshot): AggregateStats;

// Get default path for aggregate snapshot
function getDefaultAggregateSnapshotPath(projectRoot: string): string;
```

### Interfaces

#### PermissionRecord

```typescript
interface PermissionRecord {
  timestamp: string;      // ISO 8601 timestamp
  service: string;        // AWS service name (lowercase)
  action: string;         // AWS action name
  roleArn?: string;       // IAM role ARN if applicable
  region?: string;        // AWS region
}
```

#### PermissionSnapshot

```typescript
interface PermissionSnapshot {
  version: string;                      // Schema version
  roles: string[];                      // Sorted list of role ARNs
  actions: Record<string, string[]>;    // Service -> sorted action names
}
```

#### SnapshotDiff

```typescript
interface SnapshotDiff {
  hasChanges: boolean;                  // True if any changes detected
  addedRoles: string[];                 // New role ARNs
  removedRoles: string[];               // Removed role ARNs
  addedServices: string[];              // New services
  removedServices: string[];            // Removed services
  addedActions: Record<string, string[]>;   // New actions per service
  removedActions: Record<string, string[]>; // Removed actions per service
}
```

## Troubleshooting

### Snapshot mismatch on every run

**Symptom**: The permission snapshot differs on every test run even when no code changes were made.

**Cause**: The tracker may be recording calls that vary between runs (e.g., different timestamps, transient API calls).

**Solution**: 
- Ensure you're using the singleton `PermissionTracker.getInstance()` consistently
- Call `tracker.clear()` before each test
- Check that tests are isolated and not sharing state

### Missing permissions in snapshot

**Symptom**: Some API calls are not being recorded in the snapshot.

**Cause**: The SDK client may not have the permission tracking middleware installed.

**Solution**: Ensure all SDK clients have the middleware installed:

```typescript
const client = new S3Client({});
client.middlewareStack.use(createPermissionTrackerPlugin());
```

### Large number of actions in snapshot

**Symptom**: The snapshot contains many actions that don't seem directly related to the test.

**Cause**: CDK operations (deploy, destroy) make many AWS API calls behind the scenes.

**Solution**: This is expected behavior. The snapshot captures all permissions needed to run the integration test, including CDK operational calls. Review the actions to ensure they are all necessary.

### Snapshot comparison failing in CI

**Symptom**: Tests pass locally but fail in CI with permission snapshot differences.

**Cause**: Environment differences (AWS account, region) may cause different API calls.

**Solution**:
- Ensure CI environment uses the same AWS configuration as local development
- Check for region-specific or account-specific behavior in the test
- Update snapshots if the changes are expected: `--update-permissions-snapshot`

### Error: "No permission snapshot found"

**Symptom**: Test fails because no baseline snapshot exists.

**Cause**: This is a new test or the snapshot file was deleted.

**Solution**: Run with `--update-permissions-snapshot` to create the initial snapshot:

```bash
yarn integ test/aws-lambda/test/integ.my-new-test.js --update-permissions-snapshot
```

### Understanding diff output

When a snapshot comparison fails, you'll see output like:

```
✗ integ.lambda: Permission snapshot has changed

Roles:
  + arn:aws:iam::123456789012:role/NewRole

New services:
  + dynamodb
      + GetItem
      + PutItem

Changed services:
  ~ lambda
    - DeleteFunction
    + InvokeFunction

To update the snapshot, run with --update-permissions-snapshot
```

Legend:
- `+` indicates additions (new roles, services, or actions)
- `-` indicates removals
- `~` indicates modifications to existing services

## Best Practices

1. **Review changes carefully**: Permission changes can indicate security implications. Always review the diff before updating snapshots.

2. **Keep tests isolated**: Each integration test should have its own snapshot. Avoid sharing state between tests.

3. **Document intentional changes**: When updating snapshots due to feature changes, include the reason in your commit message.

4. **Use aggregate snapshots for auditing**: The aggregate snapshot (`permissions-aggregate.json`) provides a complete view of all permissions required by the CDK test suite.

5. **Run with `--update-permissions-snapshot` sparingly**: Only use this flag when you have intentionally changed the permissions required by a test.

## Contributing

When modifying this package:

1. Run tests: `yarn test`
2. Build: `yarn build`
3. Update this README if adding new features

## Related Documentation

- [Integration Tests Guide](../../../../INTEGRATION_TESTS.md)
- [Permissions Documentation](../../../../docs/PERMISSIONS.md)
- [CDK Contributing Guide](../../../../CONTRIBUTING.md)
