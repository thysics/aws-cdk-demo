/**
 * @aws-cdk/permissions-recorder
 *
 * AWS SDK v3 middleware for recording IAM roles assumed and actions performed
 * during integration test execution.
 */

export { PermissionsRecorder, PermissionsSnapshot } from './permissions-recorder';
export { createPermissionsMiddleware, PermissionsMiddlewareOptions } from './middleware';
