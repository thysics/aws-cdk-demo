/**
 * AWS SDK v3 Permissions Tracker
 *
 * This package provides middleware for AWS SDK v3 clients to intercept and record
 * all API calls made during execution. It's designed to support permissions snapshot
 * testing in the AWS CDK integration test framework.
 *
 * ## Features
 *
 * - **Middleware-based interception**: Uses AWS SDK v3 middleware stack pattern to
 *   intercept requests without affecting the actual SDK request/response flow
 * - **Service and action tracking**: Captures service name and action/API call for
 *   each SDK call in `service:action` format
 * - **STS AssumeRole tracking**: Separately tracks STS AssumeRole calls with role
 *   ARN and session details
 * - **Role chain maintenance**: Maintains the chain of roles showing which principal
 *   made each call
 * - **Singleton collector**: Aggregates permissions across multiple SDK clients
 *   during a test run
 * - **Filtering support**: Include/exclude specific services or actions
 *
 * ## Basic Usage
 *
 * ```typescript
 * import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
 * import { createPermissionsMiddleware, PermissionsCollector } from '@aws-cdk/permissions-tracker';
 *
 * // Create and attach middleware to an SDK client
 * const s3Client = new S3Client({ region: 'us-east-1' });
 * s3Client.middlewareStack.use(createPermissionsMiddleware());
 *
 * // Make API calls
 * await s3Client.send(new ListBucketsCommand({}));
 *
 * // Get collected permissions
 * const collector = PermissionsCollector.getInstance();
 * const permissions = collector.getCollectedPermissions();
 * ```
 *
 * @packageDocumentation
 */

export * from './types';
export * from './permissions-collector';
export * from './permissions-middleware';
export * from './permissions-snapshot';
export * from './snapshot-comparator';
