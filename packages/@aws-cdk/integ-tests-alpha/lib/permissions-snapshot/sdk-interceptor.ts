/**
 * AWS SDK v3 Middleware Interceptor for capturing IAM permissions
 *
 * This module provides middleware that can be added to AWS SDK v3 clients
 * to intercept and record all AWS API calls made during test execution.
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
import type { IamAction, AssumedRole } from './types';

/**
 * Callback function type for reporting captured actions
 */
export type ActionCallback = (action: IamAction) => void;

/**
 * Callback function type for reporting assumed roles
 */
export type AssumedRoleCallback = (role: AssumedRole) => void;

/**
 * Options for the SDK interceptor middleware
 */
export interface SdkInterceptorOptions {
  /**
   * Callback invoked for each IAM action captured
   */
  readonly onAction?: ActionCallback;

  /**
   * Callback invoked for each role assumption captured
   */
  readonly onAssumedRole?: AssumedRoleCallback;

  /**
   * Services to exclude from interception
   */
  readonly excludeServices?: string[];

  /**
   * Actions to exclude from interception
   * Format: 'service:action'
   */
  readonly excludeActions?: string[];

  /**
   * Whether to capture resource information from requests
   * @default false
   */
  readonly captureResources?: boolean;
}

/**
 * Creates an AWS SDK v3 middleware plugin that intercepts all API calls
 * and reports them to the provided callbacks.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { createSdkInterceptorPlugin } from './sdk-interceptor';
 *
 * const actions: IamAction[] = [];
 * const plugin = createSdkInterceptorPlugin({
 *   onAction: (action) => actions.push(action),
 * });
 *
 * const client = new S3Client({});
 * client.middlewareStack.use(plugin);
 * ```
 */
export function createSdkInterceptorPlugin(options: SdkInterceptorOptions = {}): Pluggable<any, any> {
  const excludeServices = new Set(options.excludeServices?.map(s => s.toLowerCase()) ?? []);
  const excludeActions = new Set(options.excludeActions?.map(a => a.toLowerCase()) ?? []);

  const middleware: FinalizeRequestMiddleware<any, any> = <Output extends MetadataBearer>(
    next: FinalizeHandler<any, Output>,
    context: HandlerExecutionContext,
  ): FinalizeHandler<any, Output> => {
    return async (args: FinalizeHandlerArguments<any>): Promise<FinalizeHandlerOutput<Output>> => {
      // Extract service and action from the context
      const serviceName = extractServiceName(context);
      const actionName = extractActionName(context);

      if (serviceName && actionName) {
        const serviceKey = serviceName.toLowerCase();
        const actionKey = `${serviceKey}:${actionName.toLowerCase()}`;

        // Check if this action should be excluded
        if (!excludeServices.has(serviceKey) && !excludeActions.has(actionKey)) {
          const action: IamAction = {
            service: serviceName,
            action: actionName,
            ...(options.captureResources ? { resources: extractResources(args.input) } : {}),
          };

          // Report the action
          options.onAction?.(action);

          // Special handling for STS AssumeRole calls
          if (serviceKey === 'sts' && actionName.toLowerCase() === 'assumerole') {
            const roleArn = args.input?.RoleArn;
            const sessionName = args.input?.RoleSessionName;
            if (roleArn) {
              const assumedRole: AssumedRole = {
                roleArn,
                sessionName,
                timestamp: new Date().toISOString(),
              };
              options.onAssumedRole?.(assumedRole);
            }
          }
        }
      }

      // Continue with the request
      return next(args);
    };
  };

  return {
    applyToStack: (stack) => {
      stack.add(middleware, {
        step: 'finalizeRequest',
        name: 'permissionsSnapshotInterceptor',
        tags: ['PERMISSIONS_SNAPSHOT'],
        priority: 'high',
      });
    },
  };
}

/**
 * Extract the service name from the handler execution context
 */
function extractServiceName(context: HandlerExecutionContext): string | undefined {
  // Try to get the service from the context
  // AWS SDK v3 stores this in different places depending on the client
  const clientName = context.clientName;
  if (clientName) {
    // Client names are typically like 'S3Client', 'CloudFormationClient', etc.
    return clientName.replace(/Client$/, '');
  }
  return undefined;
}

/**
 * Extract the action name from the handler execution context
 */
function extractActionName(context: HandlerExecutionContext): string | undefined {
  // The command name is typically available in the context
  const commandName = context.commandName;
  if (commandName) {
    // Command names are typically like 'PutObjectCommand', 'CreateStackCommand', etc.
    return commandName.replace(/Command$/, '');
  }
  return undefined;
}

/**
 * Extract resource identifiers from the request input
 * This is a best-effort extraction for common patterns
 */
function extractResources(input: any): string[] | undefined {
  if (!input) return undefined;

  const resources: string[] = [];

  // Common resource identifier patterns
  const resourceKeys = [
    'Bucket', 'Key', 'StackName', 'FunctionName', 'TableName',
    'QueueUrl', 'TopicArn', 'RoleArn', 'PolicyArn', 'UserName',
    'GroupName', 'InstanceId', 'VpcId', 'SubnetId', 'SecurityGroupId',
    'ClusterArn', 'ServiceArn', 'TaskDefinitionArn', 'StreamName',
    'LogGroupName', 'RuleName', 'StateMachineArn', 'ExecutionArn',
  ];

  for (const key of resourceKeys) {
    if (input[key]) {
      resources.push(`${key}:${input[key]}`);
    }
  }

  // Handle arrays of resources
  const arrayResourceKeys = ['Instances', 'StackNames', 'FunctionNames'];
  for (const key of arrayResourceKeys) {
    if (Array.isArray(input[key])) {
      for (const item of input[key]) {
        if (typeof item === 'string') {
          resources.push(`${key}:${item}`);
        }
      }
    }
  }

  return resources.length > 0 ? resources : undefined;
}

/**
 * A class that manages SDK interceptors across multiple clients
 */
export class SdkInterceptorManager {
  private readonly actions: IamAction[] = [];
  private readonly assumedRoles: AssumedRole[] = [];
  private readonly plugin: Pluggable<any, any>;
  private readonly options: SdkInterceptorOptions;

  constructor(options: Omit<SdkInterceptorOptions, 'onAction' | 'onAssumedRole'> = {}) {
    this.options = options;
    this.plugin = createSdkInterceptorPlugin({
      ...options,
      onAction: (action) => this.actions.push(action),
      onAssumedRole: (role) => this.assumedRoles.push(role),
    });
  }

  /**
   * Get the plugin to apply to SDK clients
   */
  public getPlugin(): Pluggable<any, any> {
    return this.plugin;
  }

  /**
   * Get all captured actions
   */
  public getActions(): IamAction[] {
    return [...this.actions];
  }

  /**
   * Get all captured assumed roles
   */
  public getAssumedRoles(): AssumedRole[] {
    return [...this.assumedRoles];
  }

  /**
   * Get unique actions (deduplicated by service:action)
   */
  public getUniqueActions(): IamAction[] {
    const seen = new Set<string>();
    const unique: IamAction[] = [];

    for (const action of this.actions) {
      const key = `${action.service}:${action.action}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({
          service: action.service,
          action: action.action,
          // Don't include resources in unique actions as they may vary
        });
      }
    }

    // Sort for consistent output
    return unique.sort((a, b) => {
      const aKey = `${a.service}:${a.action}`;
      const bKey = `${b.service}:${b.action}`;
      return aKey.localeCompare(bKey);
    });
  }

  /**
   * Get unique assumed roles (deduplicated by roleArn)
   */
  public getUniqueAssumedRoles(): AssumedRole[] {
    const seen = new Set<string>();
    const unique: AssumedRole[] = [];

    for (const role of this.assumedRoles) {
      if (!seen.has(role.roleArn)) {
        seen.add(role.roleArn);
        unique.push({
          roleArn: role.roleArn,
          sessionName: role.sessionName,
          // Don't include timestamp in unique roles
        });
      }
    }

    // Sort for consistent output
    return unique.sort((a, b) => a.roleArn.localeCompare(b.roleArn));
  }

  /**
   * Clear all captured data
   */
  public clear(): void {
    this.actions.length = 0;
    this.assumedRoles.length = 0;
  }
}
