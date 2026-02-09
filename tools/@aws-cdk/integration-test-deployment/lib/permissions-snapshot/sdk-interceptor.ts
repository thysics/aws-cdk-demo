/* eslint-disable no-console */
import type {
  MetadataBearer,
  MiddlewareStack,
  Pluggable,
  HandlerExecutionContext,
} from '@smithy/types';
import type { IamAction, RoleAssumption } from './types';

/**
 * Extracts the service name from a command input or context.
 * AWS SDK v3 doesn't provide service name directly, so we infer it from the client metadata.
 */
function extractServiceName(context: HandlerExecutionContext): string {
  // The service id is typically available in the context or can be inferred
  // from the client identifier
  const clientName = (context as any).clientName || '';

  // Extract service name from client name (e.g., 'S3Client' -> 's3', 'CloudFormationClient' -> 'cloudformation')
  const match = clientName.match(/^(.+)Client$/);
  if (match) {
    return match[1].toLowerCase();
  }

  // Fallback: try to get from service id
  const serviceId = (context as any).serviceId || (context as any).service;
  if (serviceId) {
    return serviceId.toLowerCase().replace(/\s+/g, '');
  }

  return 'unknown';
}

/**
 * Extracts the operation name from the command.
 */
function extractOperationName(context: HandlerExecutionContext): string {
  // The command name follows the pattern: OperationCommand
  const commandName = (context as any).commandName || '';
  const match = commandName.match(/^(.+)Command$/);
  if (match) {
    return match[1];
  }
  return commandName || 'unknown';
}

/**
 * Collector that accumulates IAM actions and role assumptions during SDK calls.
 */
export class PermissionsCollector {
  private readonly actions: Map<string, IamAction> = new Map();
  private readonly roleAssumptions: RoleAssumption[] = [];

  /**
   * Records an IAM action.
   */
  public recordAction(service: string, action: string): void {
    const key = `${service}:${action}`;
    if (!this.actions.has(key)) {
      this.actions.set(key, {
        service,
        action,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Records a role assumption.
   */
  public recordRoleAssumption(roleArn: string, sessionName: string): void {
    this.roleAssumptions.push({
      roleArn,
      sessionName,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Gets all recorded actions.
   */
  public getActions(): IamAction[] {
    return Array.from(this.actions.values());
  }

  /**
   * Gets all recorded role assumptions.
   */
  public getRoleAssumptions(): RoleAssumption[] {
    return [...this.roleAssumptions];
  }

  /**
   * Gets unique permissions as strings (service:action format).
   */
  public getPermissions(): string[] {
    return Array.from(this.actions.keys()).sort();
  }

  /**
   * Clears all recorded data.
   */
  public clear(): void {
    this.actions.clear();
    this.roleAssumptions.length = 0;
  }
}

/**
 * Global singleton collector for accumulating permissions across all SDK clients.
 */
let globalCollector: PermissionsCollector | undefined;

/**
 * Gets or creates the global permissions collector.
 */
export function getGlobalCollector(): PermissionsCollector {
  if (!globalCollector) {
    globalCollector = new PermissionsCollector();
  }
  return globalCollector;
}

/**
 * Resets the global collector (useful for test isolation).
 */
export function resetGlobalCollector(): void {
  if (globalCollector) {
    globalCollector.clear();
  }
  globalCollector = undefined;
}

/**
 * Creates an AWS SDK v3 middleware plugin that intercepts all API calls
 * and records them for permissions snapshot testing.
 *
 * @param collector - Optional collector to use. If not provided, uses the global collector.
 * @returns A pluggable middleware that can be added to any AWS SDK v3 client.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createPermissionsInterceptorPlugin } from './sdk-interceptor';
 *
 * const client = new S3Client({});
 * client.middlewareStack.use(createPermissionsInterceptorPlugin());
 * ```
 */
export function createPermissionsInterceptorPlugin(
  collector?: PermissionsCollector,
): Pluggable<any, any> {
  const effectiveCollector = collector ?? getGlobalCollector();

  return {
    applyToStack: (stack: MiddlewareStack<any, any>) => {
      // Add middleware at the 'initialize' step to capture calls early
      stack.add(
        (next, context) => async (args) => {
          const service = extractServiceName(context);
          const operation = extractOperationName(context);

          // Record the action
          effectiveCollector.recordAction(service, operation);

          // Special handling for STS:AssumeRole to capture role assumptions
          if (service === 'sts' && operation === 'AssumeRole') {
            const input = args.input as any;
            if (input?.RoleArn) {
              effectiveCollector.recordRoleAssumption(
                input.RoleArn,
                input.RoleSessionName || 'unknown',
              );
            }
          }

          // Log the action if verbose logging is enabled
          if (process.env.CDK_PERMISSIONS_SNAPSHOT_VERBOSE === 'true') {
            console.log(`[Permissions Snapshot] ${service}:${operation}`);
          }

          // Continue with the actual API call
          const result = await next(args);
          return result as any;
        },
        {
          step: 'initialize',
          name: 'permissionsSnapshotInterceptor',
          tags: ['PERMISSIONS_SNAPSHOT'],
          priority: 'high',
        },
      );
    },
  };
}

/**
 * Applies the permissions interceptor to an existing AWS SDK v3 client.
 *
 * @param client - The AWS SDK v3 client to instrument.
 * @param collector - Optional collector to use. If not provided, uses the global collector.
 * @returns The same client instance (for chaining).
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { instrumentClient } from './sdk-interceptor';
 *
 * const client = instrumentClient(new S3Client({}));
 * ```
 */
export function instrumentClient<T extends { middlewareStack: MiddlewareStack<any, any> }>(
  client: T,
  collector?: PermissionsCollector,
): T {
  client.middlewareStack.use(createPermissionsInterceptorPlugin(collector));
  return client;
}

/**
 * Options for the AWS SDK instrumentation wrapper.
 */
export interface InstrumentationOptions {
  /**
   * The collector to use for recording permissions.
   * @default - uses the global collector
   */
  readonly collector?: PermissionsCollector;

  /**
   * Whether to enable verbose logging.
   * @default false
   */
  readonly verbose?: boolean;
}

/**
 * Creates an instrumented version of an AWS SDK v3 client class.
 * This is useful for creating pre-instrumented clients without modifying existing code.
 *
 * @param ClientClass - The AWS SDK v3 client class (e.g., S3Client, CloudFormationClient).
 * @param options - Instrumentation options.
 * @returns A new class that extends the original but with automatic instrumentation.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createInstrumentedClientClass } from './sdk-interceptor';
 *
 * const InstrumentedS3Client = createInstrumentedClientClass(S3Client);
 * const client = new InstrumentedS3Client({});
 * ```
 */
export function createInstrumentedClientClass<
  TConfig,
  TClient extends { middlewareStack: MiddlewareStack<any, any> },
>(
  ClientClass: new (config: TConfig) => TClient,
  options?: InstrumentationOptions,
): new (config: TConfig) => TClient {
  return class InstrumentedClient extends (ClientClass as any) {
    constructor(config: TConfig) {
      super(config);
      instrumentClient(this, options?.collector);

      if (options?.verbose) {
        process.env.CDK_PERMISSIONS_SNAPSHOT_VERBOSE = 'true';
      }
    }
  } as any;
}
