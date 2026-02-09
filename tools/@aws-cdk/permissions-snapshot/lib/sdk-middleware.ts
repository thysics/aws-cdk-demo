/**
 * AWS SDK v3 middleware for intercepting and recording API calls.
 *
 * This module provides middleware that can be added to AWS SDK v3 clients
 * to track all API calls being made, including special handling for STS
 * AssumeRole operations.
 */

import type {
  InitializeHandler,
  InitializeHandlerArguments,
  InitializeHandlerOptions,
  InitializeHandlerOutput,
  InitializeMiddleware,
  MetadataBearer,
  Pluggable,
  HandlerExecutionContext,
} from '@smithy/types';
import type { RecordedAction, RecordedRole } from './types';

/**
 * Callback function type for recording API actions.
 */
export type ActionRecorderCallback = (action: RecordedAction) => void;

/**
 * Callback function type for recording assumed roles.
 */
export type RoleRecorderCallback = (role: RecordedRole) => void;

/**
 * STS actions that assume roles and should be tracked for role ARNs.
 */
const STS_ASSUME_ROLE_ACTIONS = new Set([
  'AssumeRole',
  'AssumeRoleWithSAML',
  'AssumeRoleWithWebIdentity',
]);

/**
 * Extracts the service name from a command's constructor name or context.
 *
 * @param context - The handler execution context from Smithy
 * @returns The normalized service name in lowercase
 */
function extractServiceName(context: HandlerExecutionContext): string {
  // The context.clientName is typically in format like 'S3Client', 'STSClient'
  const clientName = context.clientName ?? '';
  // Remove 'Client' suffix and convert to lowercase
  return clientName.replace(/Client$/i, '').toLowerCase();
}

/**
 * Extracts the action name from a command.
 *
 * @param context - The handler execution context from Smithy
 * @returns The action name (e.g., 'PutObject', 'AssumeRole')
 */
function extractActionName(context: HandlerExecutionContext): string {
  // The context.commandName is typically in format like 'PutObjectCommand', 'AssumeRoleCommand'
  const commandName = context.commandName ?? '';
  // Remove 'Command' suffix
  return commandName.replace(/Command$/i, '');
}

/**
 * Extracts the RoleArn from STS AssumeRole request parameters.
 *
 * @param input - The request input object
 * @returns The role ARN if present, undefined otherwise
 */
function extractRoleArn(input: unknown): string | undefined {
  if (input && typeof input === 'object' && 'RoleArn' in input) {
    const roleArn = (input as { RoleArn?: unknown }).RoleArn;
    if (typeof roleArn === 'string') {
      return roleArn;
    }
  }
  return undefined;
}

/**
 * Creates the permissions tracking middleware function.
 *
 * This middleware intercepts all API calls and records the service name and action name.
 * For STS AssumeRole operations, it also extracts and records the role ARN being assumed.
 *
 * @param onAction - Callback invoked when an API action is recorded
 * @param onRole - Callback invoked when a role assumption is recorded
 * @returns The middleware function
 */
export function createPermissionsMiddleware(
  onAction: ActionRecorderCallback,
  onRole: RoleRecorderCallback,
): InitializeMiddleware<object, MetadataBearer> {
  return <Input extends object, Output extends MetadataBearer>(
    next: InitializeHandler<Input, Output>,
    context: HandlerExecutionContext,
  ): InitializeHandler<Input, Output> => {
    return async (
      args: InitializeHandlerArguments<Input>,
    ): Promise<InitializeHandlerOutput<Output>> => {
      // Extract service and action information
      const service = extractServiceName(context);
      const action = extractActionName(context);

      // Record the action if we have valid service and action names
      if (service && action) {
        onAction({ service, action });

        // Special handling for STS AssumeRole operations
        if (service === 'sts' && STS_ASSUME_ROLE_ACTIONS.has(action)) {
          const roleArn = extractRoleArn(args.input);
          if (roleArn) {
            onRole({
              roleArn,
              assumedVia: action as 'AssumeRole' | 'AssumeRoleWithSAML' | 'AssumeRoleWithWebIdentity',
            });
          }
        }
      }

      // Continue with the request - don't modify the behavior
      return next(args);
    };
  };
}

/**
 * Options for the permissions middleware plugin.
 */
export interface PermissionsMiddlewareOptions {
  /**
   * Callback invoked when an API action is recorded.
   */
  onAction: ActionRecorderCallback;

  /**
   * Callback invoked when a role assumption is recorded.
   */
  onRole: RoleRecorderCallback;
}

/**
 * Middleware options for registering the permissions middleware.
 */
const MIDDLEWARE_OPTIONS: InitializeHandlerOptions = {
  name: 'permissionsTrackingMiddleware',
  step: 'initialize',
  priority: 'high',
  tags: ['PERMISSIONS_TRACKING'],
};

/**
 * Creates a pluggable middleware that can be added to any AWS SDK v3 client.
 *
 * The plugin intercepts all API calls and invokes the provided callbacks
 * to record actions and role assumptions.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createPermissionsMiddlewarePlugin } from '@aws-cdk/permissions-snapshot';
 *
 * const actions: RecordedAction[] = [];
 * const roles: RecordedRole[] = [];
 *
 * const plugin = createPermissionsMiddlewarePlugin({
 *   onAction: (action) => actions.push(action),
 *   onRole: (role) => roles.push(role),
 * });
 *
 * const client = new S3Client({});
 * client.middlewareStack.use(plugin);
 * ```
 *
 * @param options - Options including callbacks for recording actions and roles
 * @returns A pluggable middleware that can be used with any AWS SDK v3 client
 */
export function createPermissionsMiddlewarePlugin(
  options: PermissionsMiddlewareOptions,
): Pluggable<object, MetadataBearer> {
  return {
    applyToStack: (stack) => {
      stack.add(
        createPermissionsMiddleware(options.onAction, options.onRole),
        MIDDLEWARE_OPTIONS,
      );
    },
  };
}

/**
 * Removes the permissions tracking middleware from a client's middleware stack.
 *
 * @param stack - The middleware stack to remove the middleware from
 */
export function removePermissionsMiddleware(
  stack: { remove: (name: string) => boolean },
): boolean {
  return stack.remove(MIDDLEWARE_OPTIONS.name!);
}
