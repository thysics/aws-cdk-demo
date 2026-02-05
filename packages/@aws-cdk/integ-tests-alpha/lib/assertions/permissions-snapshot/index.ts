/**
 * Permissions Snapshot Integration Testing
 *
 * This module provides functionality to record and snapshot IAM permissions
 * used during CLI integration test execution. This helps detect unexpected
 * changes to IAM roles assumed and actions performed.
 *
 * @see https://github.com/aws/aws-cdk/issues/32088
 */

export * from './permissions-recorder';
export * from './permissions-snapshot';
export * from './sdk-call-interceptor';
export * from './types';
export * from './integ-test-helper';
