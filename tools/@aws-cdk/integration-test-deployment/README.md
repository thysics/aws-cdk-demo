# CDK Integration Test Deployment

A tool for running AWS CDK integration tests against changed snapshots using AWS Atmosphere for environment allocation.

## Overview

This tool automatically detects changed integration test snapshots in the CDK repository and runs them against real AWS environments managed by Atmosphere. It ensures that CDK changes don't break existing functionality by testing them in isolated AWS accounts.

This tool is used by the [Integration Test Deployment workflow](../../../.github/workflows/codebuild-pr-deployment-integ.yml).

## Features

- **Automatic Change Detection**: Filters through the changed files to detect the integration tests
- **AWS Environment Management**: Integrates with AWS Atmosphere for temporary AWS account allocation
- **Isolated Testing**: Each test run gets its own AWS environment with proper credentials
- **Cleanup**: Automatically releases AWS resources after test completion
- **Permissions Snapshot Testing**: Records and validates IAM actions performed during tests (see below)

## Prerequisites

Authenticating to assume atmosphere role through OIDC token.

## Environment Variables

| Variable | Description
|----------|-------------
| `CDK_ATMOSPHERE_ENDPOINT` | AWS Atmosphere service endpoint
| `CDK_ATMOSPHERE_POOL` | AWS account pool name for allocation
| `CDK_PERMISSIONS_SNAPSHOT_ENABLED` | Enable permissions snapshot recording (`true`/`false`)
| `CDK_PERMISSIONS_SNAPSHOT_VERBOSE` | Enable verbose logging for permissions (`true`/`false`)

## Development 

```bash
# Directory of the tool
cd tools/@aws-cdk/integration-test-deployment/

# Install dependencies
yarn install

# Build
yarn build

# Run tests
yarn test
```

## Usage

```bash
# Set required environment variables
export CDK_ATMOSPHERE_ENDPOINT="https://your-atmosphere-endpoint"
export CDK_ATMOSPHERE_POOL="your-pool-name"

# Run the tool
yarn --cwd tools/@aws-cdk/integration-test-deployment/ integration-test-deployment
```

## Deployment Options

This tool supports two deployment modes:

### 1. Atmosphere Mode (CI/CD)
Uses AWS Atmosphere to automatically provision temporary AWS credentials and isolated test environments. This mode requires special OIDC permissions and is primarily used in CI/CD pipelines.

**Limitations**: Cannot be run locally due to Atmosphere's authentication requirements.

### 2. Local Mode (Development)
Run the `deployIntegrationTests` function directly using your own AWS credentials. This allows local testing against your AWS account.

**Requirements**: Valid AWS credentials must be provided via function parameters

## How It Works

1. **Change Detection**: Scans Git diff for modified `integ.*.js` files
2. **Environment Allocation**: Requests temporary AWS account from Atmosphere
3. **Test Execution**: Runs `yarn integ-runner` with allocated AWS credentials
4. **Permissions Recording** (if enabled): Records all IAM actions performed during the test
5. **Snapshot Validation** (if enabled): Compares recorded permissions against existing snapshot
6. **Cleanup**: Releases AWS environment regardless of test outcome
7. **Result**: Exits with success/failure based on test results

## Permissions Snapshot Testing

The permissions snapshot feature helps detect unexpected changes to IAM permissions required by CDK CLI operations. This is useful for organizations with strict IAM policies that need to be notified when the CDK requires new permissions.

### How Permissions Snapshots Work

1. **Recording**: When enabled, the tool intercepts all AWS SDK calls and records:
   - The service and action being called (e.g., `cloudformation:CreateStack`)
   - Any IAM role assumptions (via `sts:AssumeRole`)

2. **Snapshot Files**: The recorded permissions are saved as JSON files (`.permissions.snap`) that serve as the expected baseline.

3. **Validation**: On subsequent runs, the recorded permissions are compared against the snapshot. Any differences (added or removed permissions) are reported.

### Using Permissions Snapshots

```typescript
import { deployIntegTests } from './lib/integration-test-runner';

await deployIntegTests({
  atmosphereRoleArn: 'arn:aws:iam::123456789012:role/AtmosphereRole',
  endpoint: 'https://atmosphere.example.com',
  pool: 'my-pool',
  // Enable permissions snapshot
  enablePermissionsSnapshot: true,
  permissionsSnapshotDirectory: './permissions-snapshots',
  // Set to true to update snapshots instead of failing
  updatePermissionsSnapshots: false,
});
```

### Programmatic Usage

You can also use the permissions snapshot module directly:

```typescript
import {
  PermissionsSnapshotRecorder,
  instrumentClient,
  createPermissionsInterceptorPlugin,
} from './lib/permissions-snapshot';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';

// Instrument AWS SDK clients
const s3 = instrumentClient(new S3Client({}));
const cfn = instrumentClient(new CloudFormationClient({}));

// Create recorder
const recorder = new PermissionsSnapshotRecorder({
  testName: 'my-integration-test',
  snapshotDirectory: './snapshots',
});

// Start recording
recorder.startRecording();

// ... run your test using instrumented clients ...

// Validate and save snapshot
const result = recorder.validate();

if (!result.match) {
  console.log('Permissions changed!');
  console.log('Added:', result.addedActions);
  console.log('Removed:', result.removedActions);
}
```

### Generating Permissions Documentation

Aggregate all snapshots into a single document:

```typescript
import { PermissionsSnapshotRecorder } from './lib/permissions-snapshot';

const doc = PermissionsSnapshotRecorder.generatePermissionsDocument('./snapshots');

console.log('Total tests:', doc.totalTests);
console.log('Unique permissions:', doc.uniquePermissions);
console.log('Unique roles:', doc.uniqueRoles);
```

### Snapshot File Format

Snapshot files are JSON with the following structure:

```json
{
  "testName": "my-integration-test",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "actions": [
    {
      "service": "cloudformation",
      "action": "CreateStack",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ],
  "roleAssumptions": [
    {
      "roleArn": "arn:aws:iam::123456789012:role/DeployRole",
      "sessionName": "cdk-deploy",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ],
  "permissions": [
    "cloudformation:CreateStack"
  ]
}
```

## License

Apache-2.0