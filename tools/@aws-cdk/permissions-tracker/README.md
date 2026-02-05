# @aws-cdk/permissions-tracker

AWS SDK v3 middleware plugin to intercept and record API calls for permissions tracking.

## Overview

This package provides middleware for AWS SDK v3 clients that intercepts and records all API calls made during execution. It's designed to support permissions snapshot testing in the AWS CDK integration test framework.

## Features

- **Middleware-based interception**: Uses AWS SDK v3 middleware stack pattern to intercept requests without affecting the actual SDK request/response flow
- **Service and action tracking**: Captures service name and action/API call for each SDK call in `service:action` format
- **STS AssumeRole tracking**: Separately tracks STS AssumeRole calls with role ARN and session details
- **Role chain maintenance**: Maintains the chain of roles showing which principal made each call
- **Singleton collector**: Aggregates permissions across multiple SDK clients during a test run
- **Filtering support**: Include/exclude specific services or actions

## Installation

```bash
yarn add @aws-cdk/permissions-tracker
```

## Usage

### Basic Usage

```typescript
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { createPermissionsMiddleware, PermissionsCollector } from '@aws-cdk/permissions-tracker';

// Create and attach middleware to an SDK client
const s3Client = new S3Client({ region: 'us-east-1' });
s3Client.middlewareStack.use(createPermissionsMiddleware());

// Make API calls
await s3Client.send(new ListBucketsCommand({}));

// Get collected permissions
const collector = PermissionsCollector.getInstance();
const permissions = collector.getCollectedPermissions();
console.log(permissions.apiCalls);
// [{ service: 's3', action: 'ListBuckets', timestamp: Date, ... }]
```

### With Configuration Options

```typescript
import { PermissionsCollector, createPermissionsMiddleware } from '@aws-cdk/permissions-tracker';

// Configure the collector
const collector = PermissionsCollector.getInstance();
collector.configure({
  initialPrincipal: 'arn:aws:iam::123456789012:user/test',
  excludeServices: ['sts'],  // Don't track STS calls
  trackRoleChain: true,      // Track role assumptions
});

// Create clients with middleware
const s3Client = new S3Client({});
s3Client.middlewareStack.use(createPermissionsMiddleware());
```

### Tracking Role Chain

```typescript
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { PermissionsCollector, createPermissionsMiddleware } from '@aws-cdk/permissions-tracker';

const collector = PermissionsCollector.getInstance();
collector.configure({ initialPrincipal: 'arn:aws:iam::111111111111:user/original' });

const stsClient = new STSClient({});
stsClient.middlewareStack.use(createPermissionsMiddleware());

// Assume roles
await stsClient.send(new AssumeRoleCommand({
  RoleArn: 'arn:aws:iam::222222222222:role/role-a',
  RoleSessionName: 'session-a',
}));

await stsClient.send(new AssumeRoleCommand({
  RoleArn: 'arn:aws:iam::333333333333:role/role-b',
  RoleSessionName: 'session-b',
}));

// Get role chain
const roleChain = collector.getRoleChain();
console.log(roleChain);
// {
//   initialPrincipal: 'arn:aws:iam::111111111111:user/original',
//   roles: [
//     { roleArn: 'arn:aws:iam::222222222222:role/role-a', assumedBy: 'arn:aws:iam::111111111111:user/original', ... },
//     { roleArn: 'arn:aws:iam::333333333333:role/role-b', assumedBy: 'arn:aws:iam::222222222222:role/role-a', ... }
//   ]
// }
```

### Get Unique Permissions

```typescript
const collector = PermissionsCollector.getInstance();
const uniquePermissions = collector.getUniquePermissions();
console.log(uniquePermissions);
// ['cloudformation:CreateStack', 's3:GetObject', 's3:PutObject', 'sts:AssumeRole']
```

## API Reference

### `createPermissionsMiddleware(options?)`

Creates a middleware plugin that can be attached to any AWS SDK v3 client.

**Options:**
- `includeServices?: string[]` - List of service names to include (whitelist)
- `excludeServices?: string[]` - List of service names to exclude (blacklist)
- `includeActions?: string[]` - List of actions to include in format 'service:action'
- `excludeActions?: string[]` - List of actions to exclude in format 'service:action'
- `trackRoleChain?: boolean` - Whether to track STS AssumeRole calls (default: true)
- `initialPrincipal?: string` - The initial principal making the calls

### `PermissionsCollector`

Singleton class to aggregate permissions across multiple SDK clients.

**Methods:**
- `getInstance()` - Gets the singleton instance
- `resetInstance()` - Resets the singleton instance
- `configure(options)` - Configures the collector
- `reset()` - Clears all collected data
- `recordApiCall(call)` - Records an API call
- `recordAssumedRole(role)` - Records an assumed role
- `getApiCalls()` - Gets all collected API calls
- `getAssumedRoles()` - Gets all assumed roles
- `getRoleChain()` - Gets the complete role chain
- `getCollectedPermissions()` - Gets all collected permissions data
- `getUniquePermissions()` - Gets deduplicated sorted permissions in service:action format

## License

Apache-2.0
