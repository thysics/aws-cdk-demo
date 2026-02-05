/**
 * AWS SDK v3 Permissions Tracker
 *
 * This package provides middleware for AWS SDK v3 clients to intercept and record
 * all API calls made during execution. It's designed to support permissions snapshot
 * testing in the AWS CDK integration test framework.
 *
 * @packageDocumentation
 */

export * from './types';
export * from './permissions-collector';
export * from './permissions-middleware';
