/**
 * SDK Call Interceptor
 *
 * This module provides AWS SDK v3 middleware that intercepts all SDK calls
 * and records the IAM actions being performed. It hooks into the SDK's
 * middleware stack to capture service and action information before calls
 * are made.
 */

import type {
  FinalizeHandler,
  FinalizeHandlerArguments,
  FinalizeHandlerOutput,
  FinalizeRequestMiddleware,
  HandlerExecutionContext,
  MetadataBearer,
  Pluggable,
} from '@smithy/types';
import type { RecordedIamAction, RecordedRoleAssumption } from './types';

/**
 * Callback function invoked when an SDK call is intercepted
 */
export type SdkCallInterceptorCallback = (action: RecordedIamAction) => void;

/**
 * Callback function invoked when a role assumption is detected
 */
export type RoleAssumptionCallback = (assumption: RecordedRoleAssumption) => void;

/**
 * Options for the SDK call interceptor
 */
export interface SdkCallInterceptorOptions {
  /**
   * Callback invoked for each SDK call
   */
  readonly onSdkCall?: SdkCallInterceptorCallback;

  /**
   * Callback invoked for role assumptions (STS:AssumeRole, etc.)
   */
  readonly onRoleAssumption?: RoleAssumptionCallback;

  /**
   * Whether to include the current timestamp
   *
   * @default true
   */
  readonly includeTimestamp?: boolean;
}

/**
 * Creates an AWS SDK v3 middleware plugin that intercepts and records
 * all SDK calls made during test execution.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createSdkCallInterceptorPlugin } from './sdk-call-interceptor';
 *
 * const recorder = new PermissionsRecorder();
 * const plugin = createSdkCallInterceptorPlugin({
 *   onSdkCall: (action) => recorder.recordAction(action),
 *   onRoleAssumption: (assumption) => recorder.recordRoleAssumption(assumption),
 * });
 *
 * const client = new S3Client({});
 * client.middlewareStack.use(plugin);
 * ```
 */
export function createSdkCallInterceptorPlugin(
  options: SdkCallInterceptorOptions = {},
): Pluggable<any, any> {
  return {
    applyToStack: (stack) => {
      stack.add(createSdkCallInterceptorMiddleware(options), {
        step: 'finalizeRequest',
        name: 'permissionsSnapshotInterceptor',
        tags: ['PERMISSIONS_SNAPSHOT'],
        priority: 'low', // Run after other middleware has set up the request
      });
    },
  };
}

/**
 * Creates the middleware function that intercepts SDK calls
 */
function createSdkCallInterceptorMiddleware(
  options: SdkCallInterceptorOptions,
): FinalizeRequestMiddleware<any, any> {
  return (
    next: FinalizeHandler<any, any>,
    context: HandlerExecutionContext,
  ): FinalizeHandler<any, any> => {
    return async (
      args: FinalizeHandlerArguments<any>,
    ): Promise<FinalizeHandlerOutput<any>> => {
      // Extract service and action information from the context
      const service = extractServiceName(context);
      const action = extractActionName(context);

      if (service && action) {
        const recordedAction: RecordedIamAction = {
          service,
          action,
          timestamp: options.includeTimestamp !== false
            ? new Date().toISOString()
            : undefined,
        };

        // Invoke the callback
        options.onSdkCall?.(recordedAction);

        // Special handling for STS role assumption calls
        if (isRoleAssumptionCall(service, action)) {
          const assumption = extractRoleAssumption(args, options);
          if (assumption) {
            options.onRoleAssumption?.(assumption);
          }
        }
      }

      // Continue with the request
      return next(args);
    };
  };
}

/**
 * Extract the service name from the execution context
 */
function extractServiceName(context: HandlerExecutionContext): string | undefined {
  // The service name is typically available in the clientName or serviceId
  const clientName = context.clientName;
  if (clientName) {
    // Convert "S3Client" -> "s3", "CloudFormationClient" -> "cloudformation"
    return clientName
      .replace(/Client$/, '')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
  }

  // Fallback to serviceId if available
  const serviceId = (context as any).serviceId;
  if (serviceId) {
    return serviceId.toLowerCase().replace(/\s+/g, '-');
  }

  return undefined;
}

/**
 * Extract the action name from the execution context
 */
function extractActionName(context: HandlerExecutionContext): string | undefined {
  // The command name is typically available in the context
  const commandName = context.commandName;
  if (commandName) {
    // Remove "Command" suffix if present
    return commandName.replace(/Command$/, '');
  }

  return undefined;
}

/**
 * Check if this is a role assumption call
 */
function isRoleAssumptionCall(service: string, action: string): boolean {
  if (service !== 'sts') {
    return false;
  }

  const assumptionActions = [
    'assumerole',
    'assumerolewithsaml',
    'assumerolewithwebidentity',
  ];

  return assumptionActions.includes(action.toLowerCase());
}

/**
 * Extract role assumption details from the request
 */
function extractRoleAssumption(
  args: FinalizeHandlerArguments<any>,
  options: SdkCallInterceptorOptions,
): RecordedRoleAssumption | undefined {
  const input = args.input;
  if (!input) {
    return undefined;
  }

  const roleArn = input.RoleArn;
  if (!roleArn) {
    return undefined;
  }

  return {
    roleArn,
    sessionName: input.RoleSessionName,
    timestamp: options.includeTimestamp !== false
      ? new Date().toISOString()
      : undefined,
  };
}

/**
 * Helper class to apply the interceptor to multiple SDK clients
 */
export class SdkCallInterceptorManager {
  private readonly options: SdkCallInterceptorOptions;
  private readonly plugin: Pluggable<any, any>;

  constructor(options: SdkCallInterceptorOptions = {}) {
    this.options = options;
    this.plugin = createSdkCallInterceptorPlugin(options);
  }

  /**
   * Apply the interceptor to an SDK client
   *
   * @param client Any AWS SDK v3 client instance
   */
  public applyTo(client: { middlewareStack: { use: (plugin: Pluggable<any, any>) => void } }): void {
    client.middlewareStack.use(this.plugin);
  }

  /**
   * Get the plugin instance for manual application
   */
  public getPlugin(): Pluggable<any, any> {
    return this.plugin;
  }
}

/**
 * Global interceptor manager for convenient access
 */
let globalInterceptorManager: SdkCallInterceptorManager | undefined;

/**
 * Set up a global SDK call interceptor
 *
 * @param options Options for the interceptor
 * @returns The interceptor manager
 */
export function setupGlobalInterceptor(
  options: SdkCallInterceptorOptions,
): SdkCallInterceptorManager {
  globalInterceptorManager = new SdkCallInterceptorManager(options);
  return globalInterceptorManager;
}

/**
 * Get the current global interceptor manager
 */
export function getGlobalInterceptor(): SdkCallInterceptorManager | undefined {
  return globalInterceptorManager;
}

/**
 * Clear the global interceptor
 */
export function clearGlobalInterceptor(): void {
  globalInterceptorManager = undefined;
}
