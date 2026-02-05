/**
 * AWS SDK v3 Middleware for tracking permissions
 *
 * This middleware intercepts all AWS SDK calls and records them
 * for permissions snapshot tracking.
 */

/* eslint-disable import/no-extraneous-dependencies */

import type {
  FinalizeHandler,
  FinalizeHandlerArguments,
  FinalizeHandlerOutput,
  FinalizeRequestMiddleware,
  HandlerExecutionContext,
  MetadataBearer,
  Pluggable,
} from '@smithy/types';
import { PermissionsTracker } from './tracker';

/**
 * Name of the middleware for identification in the middleware stack
 */
export const PERMISSIONS_TRACKING_MIDDLEWARE_NAME = 'permissionsTrackingMiddleware';

/**
 * Creates a middleware that tracks AWS SDK calls for permissions snapshots
 *
 * @returns A middleware function
 */
export const permissionsTrackingMiddleware = <Input extends object, Output extends MetadataBearer>(): FinalizeRequestMiddleware<Input, Output> => {
  return (
    next: FinalizeHandler<Input, Output>,
    context: HandlerExecutionContext,
  ): FinalizeHandler<Input, Output> => {
    return async (
      args: FinalizeHandlerArguments<Input>,
    ): Promise<FinalizeHandlerOutput<Output>> => {
      const tracker = PermissionsTracker.getInstance();

      if (tracker) {
        // Extract service and action from the context
        const serviceName = extractServiceName(context);
        const actionName = extractActionName(context);

        if (serviceName && actionName) {
          tracker.recordAction(serviceName, actionName);

          // Check for role assumptions
          if (serviceName.toLowerCase() === 'sts' && actionName.toLowerCase() === 'assumerole') {
            const input = args.input as Record<string, unknown>;
            if (input.RoleArn && typeof input.RoleArn === 'string') {
              tracker.recordRoleAssumption(
                input.RoleArn,
                typeof input.RoleSessionName === 'string' ? input.RoleSessionName : undefined,
                typeof input.ExternalId === 'string' ? input.ExternalId : undefined,
              );
            }
          }
        }
      }

      // Continue with the actual API call
      return next(args);
    };
  };
};

/**
 * Plugin configuration for the permissions tracking middleware
 */
export const permissionsTrackingPlugin: Pluggable<any, any> = {
  applyToStack: (clientStack) => {
    clientStack.add(permissionsTrackingMiddleware(), {
      step: 'finalizeRequest',
      name: PERMISSIONS_TRACKING_MIDDLEWARE_NAME,
      priority: 'low', // Run after other middleware
    });
  },
};

/**
 * Extract service name from the middleware context
 */
function extractServiceName(context: HandlerExecutionContext): string | undefined {
  // The context may have clientName or commandName from which we can derive the service
  const clientName = context.clientName;
  if (clientName) {
    // Remove 'Client' suffix if present (e.g., 'S3Client' -> 'S3')
    return clientName.replace(/Client$/, '');
  }

  // Try to get from the context's service property
  if ('service' in context && typeof context.service === 'string') {
    return context.service;
  }

  return undefined;
}

/**
 * Extract action name from the middleware context
 */
function extractActionName(context: HandlerExecutionContext): string | undefined {
  const commandName = context.commandName;
  if (commandName) {
    // Remove 'Command' suffix if present (e.g., 'GetObjectCommand' -> 'GetObject')
    return commandName.replace(/Command$/, '');
  }
  return undefined;
}

/**
 * Apply the permissions tracking middleware to an AWS SDK client
 *
 * @param client An AWS SDK v3 client instance
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { applyPermissionsTracking } from '@aws-cdk/integ-tests-alpha';
 *
 * const client = new S3Client({});
 * applyPermissionsTracking(client);
 * ```
 */
export function applyPermissionsTracking(client: { middlewareStack: { add: Function } }): void {
  client.middlewareStack.add(permissionsTrackingMiddleware(), {
    step: 'finalizeRequest',
    name: PERMISSIONS_TRACKING_MIDDLEWARE_NAME,
    priority: 'low',
  });
}

/**
 * Remove the permissions tracking middleware from an AWS SDK client
 *
 * @param client An AWS SDK v3 client instance
 */
export function removePermissionsTracking(client: { middlewareStack: { remove: Function } }): void {
  try {
    client.middlewareStack.remove(PERMISSIONS_TRACKING_MIDDLEWARE_NAME);
  } catch {
    // Ignore if middleware was not present
  }
}
