/**
 * Permissions Snapshot Module
 *
 * This module provides functionality to record and snapshot all IAM actions
 * and role assumptions that occur during integration test execution.
 *
 * @see https://github.com/aws/aws-cdk/issues/32088
 */

export * from './tracker';
export * from './snapshot';
export * from './middleware';
export * from './types';
export * from './integ-test-integration';
