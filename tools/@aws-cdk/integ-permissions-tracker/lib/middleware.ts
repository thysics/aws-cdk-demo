/**
 * AWS SDK v3 middleware for permission tracking.
 *
 * @module @aws-cdk/integ-permissions-tracker
 */

import { PermissionTracker } from './permission-tracker';

/**
 * Context interface for SDK middleware.
 */
interface MiddlewareContext {
  clientName?: string;
  commandName?: string;
}

/**
 * Handler interface for SDK middleware.
 */
interface Handler<Input extends object, Output extends object> {
  (args: { input: Input }): Promise<{ output: Output }>;
}

/**
 * Middleware handler function interface.
 */
type MiddlewareHandler<Input extends object, Output extends object> = (
  next: Handler<Input, Output>,
  context: MiddlewareContext
) => Handler<Input, Output>;

/**
 * Plugin interface for AWS SDK v3 clients.
 */
export interface PermissionTrackerPlugin {
  /**
   * Applies the middleware to an SDK client.
   *
   * @param clientStack - the client's middleware stack.
   */
  applyToStack(clientStack: { add(middleware: MiddlewareHandler<object, object>, options: { step: string; name: string }): void }): void;
}

/**
 * Extracts the service name from the client name.
 *
 * @param clientName - the full client name (e.g., 'S3Client', 'LambdaClient').
 * @returns the lowercase service name (e.g., 's3', 'lambda').
 */
export function extractServiceName(clientName: string | undefined): string {
  if (!clientName) {
    return 'unknown';
  }
  // remove 'Client' suffix and convert to lowercase
  return clientName.replace(/Client$/i, '').toLowerCase();
}

/**
 * Extracts the action name from the command name.
 *
 * @param commandName - the full command name (e.g., 'GetObjectCommand', 'InvokeFunctionCommand').
 * @returns the action name without the 'Command' suffix (e.g., 'GetObject', 'InvokeFunction').
 */
export function extractActionName(commandName: string | undefined): string {
  if (!commandName) {
    return 'Unknown';
  }
  // remove 'Command' suffix
  return commandName.replace(/Command$/i, '');
}

/**
 * Extracts the role ARN from an STS AssumeRole request.
 *
 * @param input - the command input object.
 * @returns the role ARN if present, undefined otherwise.
 */
export function extractRoleArn(input: Record<string, unknown>): string | undefined {
  // handle AssumeRole, AssumeRoleWithSAML, AssumeRoleWithWebIdentity
  if (typeof input.RoleArn === 'string') {
    return input.RoleArn;
  }
  return undefined;
}

/**
 * Creates an AWS SDK v3 middleware that tracks permissions.
 *
 * This middleware intercepts all AWS API calls and records them in the
 * PermissionTracker singleton. It specially handles STS AssumeRole calls
 * to track assumed role ARNs.
 *
 * @param tracker - optional custom tracker instance (defaults to singleton).
 * @returns a middleware handler function.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createPermissionTrackerMiddleware } from '@aws-cdk/integ-permissions-tracker';
 *
 * const client = new S3Client({});
 * const middleware = createPermissionTrackerMiddleware();
 *
 * client.middlewareStack.use({
 *   applyToStack: (stack) => {
 *     stack.add(middleware, { step: 'initialize', name: 'permissionTracker' });
 *   }
 * });
 * ```
 */
export function createPermissionTrackerMiddleware(
  tracker?: PermissionTracker
): MiddlewareHandler<object, object> {
  const permissionTracker = tracker ?? PermissionTracker.getInstance();

  return (next, context) => async (args) => {
    const serviceName = extractServiceName(context.clientName);
    const actionName = extractActionName(context.commandName);
    const input = args.input as Record<string, unknown>;

    // check if this is an AssumeRole call
    if (serviceName === 'sts' && actionName.startsWith('AssumeRole')) {
      const roleArn = extractRoleArn(input);
      if (roleArn) {
        permissionTracker.recordRoleAssumption(roleArn);
      } else {
        permissionTracker.recordCall(serviceName, actionName);
      }
    } else {
      // record the API call
      const region = input.region as string | undefined;
      permissionTracker.recordCall(serviceName, actionName, { region });
    }

    // call the next handler
    return next(args);
  };
}

/**
 * Creates a plugin object that can be used with AWS SDK v3 clients.
 *
 * @param tracker - optional custom tracker instance (defaults to singleton).
 * @returns a plugin object for SDK clients.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createPermissionTrackerPlugin } from '@aws-cdk/integ-permissions-tracker';
 *
 * const client = new S3Client({});
 * client.middlewareStack.use(createPermissionTrackerPlugin());
 * ```
 */
export function createPermissionTrackerPlugin(tracker?: PermissionTracker): PermissionTrackerPlugin {
  const middleware = createPermissionTrackerMiddleware(tracker);

  return {
    applyToStack(clientStack) {
      clientStack.add(middleware, {
        step: 'initialize',
        name: 'permissionTracker',
      });
    },
  };
}

/**
 * Formats an IAM action string from service and action names.
 *
 * @param service - the service name (e.g., 's3').
 * @param action - the action name (e.g., 'GetObject').
 * @returns the formatted IAM action (e.g., 's3:GetObject').
 */
export function formatIamAction(service: string, action: string): string {
  return `${service}:${action}`;
}
