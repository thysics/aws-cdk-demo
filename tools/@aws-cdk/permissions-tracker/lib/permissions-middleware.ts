import type {
  InitializeHandler,
  InitializeHandlerArguments,
  InitializeHandlerOptions,
  InitializeHandlerOutput,
  MetadataBearer,
  Pluggable,
  HandlerExecutionContext,
} from '@smithy/types';
import { PermissionsCollector } from './permissions-collector';
import { PermissionsMiddlewareOptions, CapturedApiCall, AssumedRole } from './types';

/**
 * AWS SDK v3 middleware plugin that intercepts and records API calls.
 *
 * This middleware integrates with the AWS SDK v3 middleware stack to capture
 * information about every API call made through clients that have this
 * middleware attached.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createPermissionsMiddleware } from '@aws-cdk/permissions-tracker';
 *
 * const s3Client = new S3Client({});
 * s3Client.middlewareStack.use(createPermissionsMiddleware());
 * ```
 */
export class PermissionsMiddleware {
  private readonly collector: PermissionsCollector;

  constructor() {
    this.collector = PermissionsCollector.getInstance();
  }

  /**
   * Creates the middleware handler that intercepts SDK calls.
   */
  public handle<Input extends object, Output extends MetadataBearer>(
    next: InitializeHandler<Input, Output>,
    context: HandlerExecutionContext,
  ): InitializeHandler<Input, Output> {
    return async (args: InitializeHandlerArguments<Input>): Promise<InitializeHandlerOutput<Output>> => {
      // Extract service and action from the context
      const service = this.extractServiceName(context);
      const action = this.extractActionName(context);
      const region = this.extractRegion(args);

      // Record the API call before executing
      const timestamp = new Date();

      // Execute the actual SDK call
      const result = await next(args);

      // Create the captured call record
      const capturedCall: CapturedApiCall = {
        service,
        action,
        region,
        timestamp,
      };

      // Record the call
      this.collector.recordApiCall(capturedCall);

      // Check if this is an STS AssumeRole call and track it separately
      if (this.isAssumeRoleCall(service, action)) {
        this.handleAssumeRoleCall(args.input, result, timestamp);
      }

      return result;
    };
  }

  /**
   * Extracts the service name from the execution context.
   */
  private extractServiceName(context: HandlerExecutionContext): string {
    // The clientName is typically in format like 'S3Client', 'STSClient', etc.
    const clientName = context.clientName || 'unknown';

    // Remove 'Client' suffix and convert to lowercase
    const serviceName = clientName.replace(/Client$/i, '').toLowerCase();

    return serviceName;
  }

  /**
   * Extracts the action/operation name from the execution context.
   */
  private extractActionName(context: HandlerExecutionContext): string {
    // The commandName is typically in format like 'GetObjectCommand', 'AssumeRoleCommand', etc.
    const commandName = context.commandName || 'unknown';

    // Remove 'Command' suffix
    return commandName.replace(/Command$/i, '');
  }

  /**
   * Extracts the region from the request arguments.
   */
  private extractRegion(args: InitializeHandlerArguments<object>): string | undefined {
    // Try to get region from the request's signing region or default to undefined
    const request = args.request as { region?: string } | undefined;
    return request?.region;
  }

  /**
   * Checks if the call is an STS AssumeRole operation.
   */
  private isAssumeRoleCall(service: string, action: string): boolean {
    return service === 'sts' && action === 'AssumeRole';
  }

  /**
   * Handles STS AssumeRole calls by extracting role information and tracking the role chain.
   */
  private handleAssumeRoleCall(
    input: object,
    result: InitializeHandlerOutput<MetadataBearer>,
    timestamp: Date,
  ): void {
    const assumeRoleInput = input as {
      RoleArn?: string;
      RoleSessionName?: string;
      DurationSeconds?: number;
    };

    if (assumeRoleInput.RoleArn) {
      const assumedRole: AssumedRole = {
        roleArn: assumeRoleInput.RoleArn,
        sessionName: assumeRoleInput.RoleSessionName,
        durationSeconds: assumeRoleInput.DurationSeconds,
        timestamp,
      };

      this.collector.recordAssumedRole(assumedRole);
    }
  }
}

/**
 * Options for the middleware initialization.
 */
export interface CreatePermissionsMiddlewareOptions extends PermissionsMiddlewareOptions {
  /**
   * Optional name for this middleware instance.
   * Useful for debugging when multiple middlewares are attached.
   */
  name?: string;
}

/**
 * Creates a permissions middleware plugin that can be attached to any AWS SDK v3 client.
 *
 * @param options - Configuration options for the middleware
 * @returns A Pluggable middleware that can be added to the client's middleware stack
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createPermissionsMiddleware, PermissionsCollector } from '@aws-cdk/permissions-tracker';
 *
 * // Configure the collector (optional)
 * const collector = PermissionsCollector.getInstance();
 * collector.configure({
 *   excludeServices: ['sts'], // Don't track STS calls
 * });
 *
 * // Create and attach middleware
 * const s3Client = new S3Client({});
 * s3Client.middlewareStack.use(createPermissionsMiddleware());
 *
 * // Make API calls...
 * // await s3Client.send(new ListBucketsCommand({}));
 *
 * // Get collected permissions
 * const permissions = collector.getCollectedPermissions();
 * ```
 */
export function createPermissionsMiddleware(
  options: CreatePermissionsMiddlewareOptions = {},
): Pluggable<object, MetadataBearer> {
  const middleware = new PermissionsMiddleware();

  // Configure the collector with provided options
  const collector = PermissionsCollector.getInstance();
  collector.configure(options);

  const middlewareOptions: InitializeHandlerOptions = {
    step: 'initialize',
    name: options.name || 'permissionsTrackerMiddleware',
    tags: ['PERMISSIONS_TRACKER'],
  };

  return {
    applyToStack: (stack) => {
      stack.add(
        (next, context) => middleware.handle(next, context),
        middlewareOptions,
      );
    },
  };
}
