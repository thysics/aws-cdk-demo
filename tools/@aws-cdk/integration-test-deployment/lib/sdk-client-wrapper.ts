/**
 * SDK Client Wrapper for Permissions Tracking
 *
 * This module provides utilities for wrapping AWS SDK v3 clients with
 * the permissions tracking middleware.
 */

import { STSClient, STSClientConfig } from '@aws-sdk/client-sts';
import {
  createPermissionsMiddleware,
  PermissionsCollector,
  CreatePermissionsMiddlewareOptions,
} from '@aws-cdk/permissions-tracker';

/**
 * Configuration for creating tracked SDK clients.
 */
export interface TrackedClientConfig {
  /**
   * Whether permissions tracking is enabled.
   * @default true
   */
  trackingEnabled?: boolean;
  /**
   * Options to pass to the permissions middleware.
   */
  middlewareOptions?: CreatePermissionsMiddlewareOptions;
}

/**
 * Creates an STS client with permissions tracking middleware attached.
 *
 * @param config - STS client configuration
 * @param trackedConfig - Tracking configuration options
 * @returns An STS client with permissions tracking middleware
 */
export function createTrackedSTSClient(
  config: STSClientConfig = {},
  trackedConfig: TrackedClientConfig = {},
): STSClient {
  const client = new STSClient(config);

  const trackingEnabled = trackedConfig.trackingEnabled ?? true;
  if (trackingEnabled) {
    client.middlewareStack.use(
      createPermissionsMiddleware(trackedConfig.middlewareOptions),
    );
  }

  return client;
}

/**
 * Attaches permissions tracking middleware to an existing SDK client.
 *
 * This function can be used with any AWS SDK v3 client that has a
 * middlewareStack property.
 *
 * @param client - The SDK client to attach middleware to
 * @param options - Options for the middleware
 * @returns The same client with middleware attached
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { attachPermissionsMiddleware } from './sdk-client-wrapper';
 *
 * const s3Client = new S3Client({});
 * attachPermissionsMiddleware(s3Client);
 * ```
 */
export function attachPermissionsMiddleware<T extends { middlewareStack: { use: Function } }>(
  client: T,
  options: CreatePermissionsMiddlewareOptions = {},
): T {
  client.middlewareStack.use(createPermissionsMiddleware(options));
  return client;
}

/**
 * Gets the PermissionsCollector singleton instance.
 *
 * This is a convenience export for accessing the collector without
 * importing from permissions-tracker directly.
 *
 * @returns The PermissionsCollector singleton instance
 */
export function getPermissionsCollector(): PermissionsCollector {
  return PermissionsCollector.getInstance();
}

/**
 * Resets the PermissionsCollector singleton instance.
 *
 * This should be called before each test run to ensure a clean state.
 */
export function resetPermissionsCollector(): void {
  PermissionsCollector.resetInstance();
}

/**
 * Initializes permissions tracking for a test run.
 *
 * This function resets any existing tracking data and prepares
 * the collector for a new test run.
 *
 * @param options - Options for configuring the middleware
 */
export function initializePermissionsTracking(
  options: CreatePermissionsMiddlewareOptions = {},
): void {
  resetPermissionsCollector();
  const collector = getPermissionsCollector();
  collector.configure(options);
  collector.reset();
}
