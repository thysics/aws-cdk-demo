/**
 * AWS SDK client instrumentation utilities
 *
 * This module provides functions to instrument AWS SDK v3 clients
 * with the permissions recording middleware.
 */

import type { Pluggable } from '@smithy/types';
import { PermissionsRecorder } from './permissions-recorder';

/**
 * Registry of instrumented clients to allow uninstrumentation
 */
const instrumentedClients = new WeakSet<object>();

/**
 * The middleware instance used for instrumentation
 */
let globalMiddleware: Pluggable<object, object> | undefined;

/**
 * Type definition for an AWS SDK v3 client with middleware stack
 */
export interface SdkClientWithMiddleware {
  middlewareStack: {
    use: (plugin: Pluggable<object, object>) => void;
    remove: (name: string) => boolean;
    clone: () => unknown;
  };
}

/**
 * Instrument a single AWS SDK v3 client with the permissions recording middleware
 *
 * @param client - The AWS SDK v3 client to instrument
 * @param recorder - Optional PermissionsRecorder instance (defaults to global instance)
 * @returns The instrumented client (same reference)
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { instrumentSdkClient } from '@aws-cdk/permissions-recorder';
 *
 * const client = instrumentSdkClient(new S3Client({}));
 * ```
 */
export function instrumentSdkClient<T extends SdkClientWithMiddleware>(
  client: T,
  recorder: PermissionsRecorder = PermissionsRecorder.globalInstance,
): T {
  if (instrumentedClients.has(client)) {
    // Already instrumented, skip
    return client;
  }

  client.middlewareStack.use(recorder.createMiddleware());
  instrumentedClients.add(client);

  return client;
}

/**
 * Remove the permissions recording middleware from a client
 *
 * @param client - The AWS SDK v3 client to uninstrument
 * @returns true if the middleware was removed, false if it wasn't present
 */
export function uninstrumentSdkClient<T extends SdkClientWithMiddleware>(client: T): boolean {
  if (!instrumentedClients.has(client)) {
    return false;
  }

  const removed = client.middlewareStack.remove('permissionsRecorderMiddleware');
  if (removed) {
    instrumentedClients.delete(client);
  }

  return removed;
}

/**
 * Instrument all AWS SDK clients created from this point forward
 *
 * This works by storing a reference to the middleware that should be applied.
 * New clients should call `applyGlobalInstrumentation()` after creation.
 *
 * @param recorder - Optional PermissionsRecorder instance (defaults to global instance)
 *
 * @example
 * ```typescript
 * import { instrumentSdkClients, applyGlobalInstrumentation } from '@aws-cdk/permissions-recorder';
 *
 * // Enable global instrumentation
 * instrumentSdkClients();
 *
 * // When creating clients, apply the instrumentation
 * const client = new S3Client({});
 * applyGlobalInstrumentation(client);
 * ```
 */
export function instrumentSdkClients(
  recorder: PermissionsRecorder = PermissionsRecorder.globalInstance,
): void {
  globalMiddleware = recorder.createMiddleware();
}

/**
 * Disable global SDK client instrumentation
 */
export function uninstrumentSdkClients(): void {
  globalMiddleware = undefined;
}

/**
 * Check if global SDK instrumentation is enabled
 */
export function isGlobalInstrumentationEnabled(): boolean {
  return globalMiddleware !== undefined;
}

/**
 * Apply global instrumentation to a newly created client
 *
 * This should be called after creating an AWS SDK v3 client if
 * global instrumentation has been enabled via `instrumentSdkClients()`.
 *
 * @param client - The AWS SDK v3 client to instrument
 * @returns The instrumented client (same reference)
 */
export function applyGlobalInstrumentation<T extends SdkClientWithMiddleware>(client: T): T {
  if (globalMiddleware && !instrumentedClients.has(client)) {
    client.middlewareStack.use(globalMiddleware);
    instrumentedClients.add(client);
  }
  return client;
}

/**
 * Create a wrapper function that instruments clients on creation
 *
 * This is useful for wrapping client factories or constructors.
 *
 * @param factory - A function that creates an AWS SDK v3 client
 * @param recorder - Optional PermissionsRecorder instance
 * @returns A wrapped factory function that instruments clients
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createInstrumentedClientFactory } from '@aws-cdk/permissions-recorder';
 *
 * const createInstrumentedS3Client = createInstrumentedClientFactory(
 *   (config) => new S3Client(config)
 * );
 *
 * const client = createInstrumentedS3Client({ region: 'us-east-1' });
 * ```
 */
export function createInstrumentedClientFactory<
  TConfig,
  TClient extends SdkClientWithMiddleware,
>(
  factory: (config: TConfig) => TClient,
  recorder: PermissionsRecorder = PermissionsRecorder.globalInstance,
): (config: TConfig) => TClient {
  return (config: TConfig): TClient => {
    const client = factory(config);
    return instrumentSdkClient(client, recorder);
  };
}

/**
 * Helper to instrument multiple clients at once
 *
 * @param clients - Array of AWS SDK v3 clients to instrument
 * @param recorder - Optional PermissionsRecorder instance
 * @returns The same array of clients (now instrumented)
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { STSClient } from '@aws-sdk/client-sts';
 * import { instrumentMultipleClients } from '@aws-cdk/permissions-recorder';
 *
 * const [s3, sts] = instrumentMultipleClients([
 *   new S3Client({}),
 *   new STSClient({})
 * ]);
 * ```
 */
export function instrumentMultipleClients<T extends SdkClientWithMiddleware[]>(
  clients: T,
  recorder: PermissionsRecorder = PermissionsRecorder.globalInstance,
): T {
  for (const client of clients) {
    instrumentSdkClient(client, recorder);
  }
  return clients;
}
