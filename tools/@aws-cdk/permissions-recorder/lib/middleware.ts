import type {
  HandlerExecutionContext,
  InitializeHandler,
  InitializeHandlerArguments,
  InitializeHandlerOptions,
  InitializeHandlerOutput,
  InitializeMiddleware,
  Pluggable,
} from '@smithy/types';

/**
 * Options for creating the permissions recording middleware
 */
export interface PermissionsMiddlewareOptions {
  /**
   * Callback to record an action
   */
  readonly onAction: (service: string, action: string) => void;

  /**
   * Callback to record an assumed role
   */
  readonly onAssumeRole: (roleArn: string) => void;
}

/**
 * Extract the service name from the middleware context or client name
 */
function extractServiceName(context: HandlerExecutionContext): string {
  // Try to get from clientName in context (e.g., "S3Client" -> "s3")
  const clientName = context.clientName;
  if (clientName) {
    // Remove "Client" suffix and convert to lowercase
    const serviceName = clientName.replace(/Client$/i, '').toLowerCase();
    return serviceName;
  }

  // Fallback: try to extract from service identifier
  const serviceId = (context as Record<string, unknown>).serviceId;
  if (typeof serviceId === 'string') {
    return serviceId.toLowerCase();
  }

  return 'unknown';
}

/**
 * Extract the action name from the command name
 * Command names typically look like "ListBucketsCommand" -> "ListBuckets"
 */
function extractActionName(commandName: string | undefined): string {
  if (!commandName) {
    return 'Unknown';
  }
  // Remove "Command" suffix if present
  return commandName.replace(/Command$/i, '');
}

/**
 * Check if the input contains a RoleArn for STS AssumeRole operations
 */
function extractRoleArn(input: Record<string, unknown> | undefined): string | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  // Handle AssumeRole, AssumeRoleWithSAML, AssumeRoleWithWebIdentity
  const roleArn = input.RoleArn;
  if (typeof roleArn === 'string') {
    return roleArn;
  }

  return undefined;
}

/**
 * Check if this is an STS assume role operation
 */
function isAssumeRoleOperation(service: string, action: string): boolean {
  return service === 'sts' && (
    action === 'AssumeRole' ||
    action === 'AssumeRoleWithSAML' ||
    action === 'AssumeRoleWithWebIdentity'
  );
}

/**
 * Creates AWS SDK v3 middleware that records permissions
 *
 * The middleware intercepts requests at the 'initialize' step and extracts:
 * - Service name from the client context
 * - Action name from the command name
 * - Role ARN from AssumeRole operations
 *
 * It does NOT modify the request or response.
 */
export function createPermissionsMiddleware(options: PermissionsMiddlewareOptions): Pluggable<object, object> {
  const middlewareHandler: InitializeMiddleware<object, object> = (
    next: InitializeHandler<object, object>,
  ): InitializeHandler<object, object> => {
    return async (
      args: InitializeHandlerArguments<object>,
    ): Promise<InitializeHandlerOutput<object>> => {
      const context = args.context as HandlerExecutionContext;

      // Extract service and action
      const service = extractServiceName(context);
      const action = extractActionName(context.commandName);

      // Record the action
      options.onAction(service, action);

      // Special handling for STS AssumeRole operations
      if (isAssumeRoleOperation(service, action)) {
        const roleArn = extractRoleArn(args.input as Record<string, unknown>);
        if (roleArn) {
          options.onAssumeRole(roleArn);
        }
      }

      // Pass through to next handler without modification
      return next(args);
    };
  };

  const middlewareOptions: InitializeHandlerOptions = {
    step: 'initialize',
    name: 'permissionsRecorderMiddleware',
    tags: ['PERMISSIONS_RECORDER'],
    priority: 'high',
  };

  return {
    applyToStack: (stack) => {
      stack.add(middlewareHandler, middlewareOptions);
    },
  };
}
