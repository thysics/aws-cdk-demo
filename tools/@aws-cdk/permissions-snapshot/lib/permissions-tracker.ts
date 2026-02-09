/**
 * PermissionsTracker - A singleton class for tracking AWS SDK permissions.
 *
 * This module provides a centralized way to track all AWS API calls made
 * across multiple SDK client instances. It uses a singleton pattern to
 * ensure consistent tracking across an entire application.
 */

import type { MetadataBearer, Pluggable } from '@smithy/types';
import type {
  PermissionsSnapshot,
  PermissionsTrackerOptions,
  RecordedAction,
  RecordedRole,
} from './types';
import {
  createPermissionsMiddlewarePlugin,
  removePermissionsMiddleware,
} from './sdk-middleware';

/**
 * Interface for objects that have a middleware stack (like AWS SDK clients).
 */
interface MiddlewareStackClient {
  middlewareStack: {
    use: (plugin: Pluggable<object, MetadataBearer>) => void;
    remove: (name: string) => boolean;
  };
}

/**
 * PermissionsTracker provides a centralized mechanism to track AWS SDK v3 API calls.
 *
 * This class implements a singleton pattern to work across multiple SDK client
 * instances, accumulating all API actions and role assumptions in a thread-safe manner.
 *
 * @example
 * ```typescript
 * import { PermissionsTracker } from '@aws-cdk/permissions-snapshot';
 * import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
 *
 * const tracker = PermissionsTracker.getInstance();
 * const s3Client = new S3Client({});
 *
 * // Register the client for tracking
 * tracker.registerClient(s3Client);
 *
 * // Start tracking
 * tracker.start();
 *
 * // Make API calls
 * await s3Client.send(new PutObjectCommand({ ... }));
 *
 * // Stop tracking and get results
 * tracker.stop();
 * const snapshot = tracker.getRecordedPermissions();
 *
 * console.log(snapshot.actions); // [{ service: 's3', action: 'PutObject' }]
 * ```
 */
export class PermissionsTracker {
  private static instance: PermissionsTracker | undefined;

  private readonly registeredClients: Set<MiddlewareStackClient> = new Set();
  private readonly recordedActions: Map<string, RecordedAction> = new Map();
  private readonly recordedRoles: Map<string, RecordedRole> = new Map();
  private readonly excludeServices: Set<string>;
  private readonly excludeActions: Set<string>;

  private isTracking = false;

  /**
   * Creates a new PermissionsTracker instance.
   * Note: Use `getInstance()` for singleton access.
   *
   * @param options - Configuration options for the tracker
   */
  private constructor(options: PermissionsTrackerOptions = {}) {
    this.excludeServices = new Set(options.excludeServices ?? []);
    this.excludeActions = new Set(options.excludeActions ?? []);
  }

  /**
   * Gets the singleton instance of PermissionsTracker.
   *
   * @param options - Configuration options (only used on first call)
   * @returns The singleton PermissionsTracker instance
   */
  public static getInstance(options?: PermissionsTrackerOptions): PermissionsTracker {
    if (!PermissionsTracker.instance) {
      PermissionsTracker.instance = new PermissionsTracker(options);
    }
    return PermissionsTracker.instance;
  }

  /**
   * Resets the singleton instance.
   * Primarily useful for testing purposes.
   */
  public static resetInstance(): void {
    if (PermissionsTracker.instance) {
      PermissionsTracker.instance.stop();
      PermissionsTracker.instance.clear();
    }
    PermissionsTracker.instance = undefined;
  }

  /**
   * Creates a new instance without affecting the singleton.
   * Useful for isolated testing scenarios.
   *
   * @param options - Configuration options for the tracker
   * @returns A new PermissionsTracker instance
   */
  public static createIsolated(options?: PermissionsTrackerOptions): PermissionsTracker {
    // Access private constructor through a workaround for testing
    const tracker = Object.create(PermissionsTracker.prototype);
    tracker.registeredClients = new Set();
    tracker.recordedActions = new Map();
    tracker.recordedRoles = new Map();
    tracker.excludeServices = new Set(options?.excludeServices ?? []);
    tracker.excludeActions = new Set(options?.excludeActions ?? []);
    tracker.isTracking = false;
    return tracker;
  }

  /**
   * Registers an AWS SDK v3 client for permissions tracking.
   *
   * The middleware is added immediately to the client's middleware stack,
   * but recording only occurs when the tracker is in the "started" state.
   *
   * @param client - An AWS SDK v3 client (e.g., S3Client, STSClient)
   */
  public registerClient(client: MiddlewareStackClient): void {
    if (this.registeredClients.has(client)) {
      return; // Already registered
    }

    const plugin = createPermissionsMiddlewarePlugin({
      onAction: (action) => this.recordAction(action),
      onRole: (role) => this.recordRole(role),
    });

    client.middlewareStack.use(plugin);
    this.registeredClients.add(client);
  }

  /**
   * Unregisters a client from permissions tracking.
   *
   * @param client - The client to unregister
   * @returns True if the client was registered and is now removed
   */
  public unregisterClient(client: MiddlewareStackClient): boolean {
    if (!this.registeredClients.has(client)) {
      return false;
    }

    removePermissionsMiddleware(client.middlewareStack);
    this.registeredClients.delete(client);
    return true;
  }

  /**
   * Starts recording permissions.
   *
   * API calls made after this point will be recorded until `stop()` is called.
   */
  public start(): void {
    this.isTracking = true;
  }

  /**
   * Stops recording permissions.
   *
   * API calls made after this point will not be recorded.
   */
  public stop(): void {
    this.isTracking = false;
  }

  /**
   * Checks if the tracker is currently recording.
   *
   * @returns True if the tracker is actively recording
   */
  public isRecording(): boolean {
    return this.isTracking;
  }

  /**
   * Gets the recorded permissions snapshot.
   *
   * Returns a deduplicated and sorted list of all actions and assumed roles
   * that were recorded since the last `clear()` call.
   *
   * @returns A snapshot containing all recorded actions and assumed roles
   */
  public getRecordedPermissions(): PermissionsSnapshot {
    // Sort actions by service, then by action name
    const actions = Array.from(this.recordedActions.values()).sort((a, b) => {
      const serviceCompare = a.service.localeCompare(b.service);
      if (serviceCompare !== 0) return serviceCompare;
      return a.action.localeCompare(b.action);
    });

    // Sort roles by ARN
    const assumedRoles = Array.from(this.recordedRoles.values()).sort((a, b) =>
      a.roleArn.localeCompare(b.roleArn),
    );

    return { actions, assumedRoles };
  }

  /**
   * Clears all recorded permissions data.
   *
   * This does not affect the tracking state or registered clients.
   */
  public clear(): void {
    this.recordedActions.clear();
    this.recordedRoles.clear();
  }

  /**
   * Gets the number of registered clients.
   *
   * @returns The count of registered clients
   */
  public getRegisteredClientCount(): number {
    return this.registeredClients.size;
  }

  /**
   * Records an API action if tracking is enabled and not excluded.
   *
   * @param action - The action to record
   */
  private recordAction(action: RecordedAction): void {
    if (!this.isTracking) {
      return;
    }

    // Check exclusions
    if (this.excludeServices.has(action.service)) {
      return;
    }

    const actionKey = `${action.service}:${action.action}`;
    if (this.excludeActions.has(actionKey)) {
      return;
    }

    // Deduplicate by using service:action as the key
    this.recordedActions.set(actionKey, action);
  }

  /**
   * Records an assumed role if tracking is enabled.
   *
   * @param role - The role to record
   */
  private recordRole(role: RecordedRole): void {
    if (!this.isTracking) {
      return;
    }

    // Deduplicate by role ARN
    this.recordedRoles.set(role.roleArn, role);
  }
}
