import type { Client, Command, MetadataBearer, MiddlewareStack } from '@smithy/types';
import { getGlobalRecorder, PermissionsRecorder } from './permissions-recorder';

/**
 * Options for the SDK interceptor middleware
 */
export interface SdkInterceptorOptions {
  /**
   * Custom permissions recorder to use
   * If not provided, the global recorder will be used
   */
  readonly recorder?: PermissionsRecorder;
}

/**
 * Extract service name from SDK client
 * The service name is typically available in the client's config or can be inferred
 */
function extractServiceName(client: Client<any, any, any>): string {
  // Try to get service name from client configuration
  const config = (client as any).config;
  if (config?.serviceId) {
    return config.serviceId.toLowerCase();
  }

  // Try to get from client constructor name
  const constructorName = client.constructor.name;
  if (constructorName.endsWith('Client')) {
    return constructorName.slice(0, -6).toLowerCase();
  }

  return 'unknown';
}

/**
 * Extract action name from SDK command
 * The action name is typically the command class name without the 'Command' suffix
 */
function extractActionName(command: Command<any, any, any, any, any>): string {
  const commandName = command.constructor.name;
  if (commandName.endsWith('Command')) {
    return commandName.slice(0, -7);
  }
  return commandName;
}

/**
 * Extract resource ARNs from command input if available
 * This is a best-effort extraction and may not work for all services
 */
function extractResourceArns(input: any): string[] | undefined {
  if (!input) return undefined;

  const arns: string[] = [];

  // Common patterns for resource ARNs in AWS SDK calls
  const arnPatterns = [
    'Arn',
    'ResourceArn',
    'ResourceArns',
    'FunctionArn',
    'RoleArn',
    'BucketArn',
    'TableArn',
    'TopicArn',
    'QueueUrl', // SQS uses URLs that can be converted to ARNs
    'StreamArn',
  ];

  for (const pattern of arnPatterns) {
    const value = input[pattern];
    if (typeof value === 'string' && (value.startsWith('arn:') || value.includes('amazonaws.com'))) {
      arns.push(value);
    } else if (Array.isArray(value)) {
      arns.push(...value.filter((v: any) => typeof v === 'string' && v.startsWith('arn:')));
    }
  }

  return arns.length > 0 ? arns : undefined;
}

/**
 * Check if this is an STS AssumeRole call
 */
function isAssumeRoleCall(service: string, action: string): boolean {
  return service.toLowerCase() === 'sts' && 
    ['assumerole', 'assumerolewithsaml', 'assumerolewithwebidentity'].includes(action.toLowerCase());
}

/**
 * Extract role assumption details from AssumeRole input
 */
function extractRoleAssumptionDetails(input: any): { roleArn: string; sessionName?: string; externalId?: string } | undefined {
  if (!input || !input.RoleArn) {
    return undefined;
  }

  return {
    roleArn: input.RoleArn,
    sessionName: input.RoleSessionName,
    externalId: input.ExternalId,
  };
}

/**
 * Creates middleware that intercepts AWS SDK calls and records them
 * 
 * @param options Options for the interceptor
 * @returns Middleware function to add to SDK client's middleware stack
 */
export function createSdkInterceptorMiddleware(options: SdkInterceptorOptions = {}) {
  const recorder = options.recorder ?? getGlobalRecorder();

  return (next: any, context: any) => async (args: any) => {
    // Extract service and action information
    const service = context?.clientName?.replace('Client', '')?.toLowerCase() || 'unknown';
    const commandName = context?.commandName || 'Unknown';
    const action = commandName.replace('Command', '');

    // Record the action
    const resources = extractResourceArns(args.input);
    recorder.recordAction(service, action, resources);

    // Check for role assumptions
    if (isAssumeRoleCall(service, action)) {
      const roleDetails = extractRoleAssumptionDetails(args.input);
      if (roleDetails) {
        recorder.recordRoleAssumption(
          roleDetails.roleArn,
          roleDetails.sessionName,
          roleDetails.externalId,
        );
      }
    }

    // Continue with the actual SDK call
    return next(args);
  };
}

/**
 * The name used to identify our middleware in the stack
 */
const MIDDLEWARE_NAME = 'permissionsSnapshotInterceptor';

/**
 * Add the permissions snapshot interceptor middleware to an AWS SDK client
 * 
 * @param client The AWS SDK v3 client to instrument
 * @param options Options for the interceptor
 * 
 * @example
 * ```ts
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { instrumentSdkClient } from '@aws-cdk/integ-tests-alpha';
 * 
 * const s3Client = new S3Client({});
 * instrumentSdkClient(s3Client);
 * ```
 */
export function instrumentSdkClient<TClient extends Client<any, any, any>>(
  client: TClient,
  options: SdkInterceptorOptions = {},
): TClient {
  const middlewareStack = (client as any).middlewareStack as MiddlewareStack<any, any>;
  
  if (middlewareStack) {
    // Add middleware to the 'initialize' step to capture all calls
    middlewareStack.add(createSdkInterceptorMiddleware(options), {
      step: 'initialize',
      name: MIDDLEWARE_NAME,
      priority: 'high',
    });
  }

  return client;
}

/**
 * Remove the permissions snapshot interceptor middleware from an AWS SDK client
 * 
 * @param client The AWS SDK v3 client to remove instrumentation from
 */
export function uninstrumentSdkClient<TClient extends Client<any, any, any>>(
  client: TClient,
): TClient {
  const middlewareStack = (client as any).middlewareStack as MiddlewareStack<any, any>;
  
  if (middlewareStack) {
    try {
      middlewareStack.remove(MIDDLEWARE_NAME);
    } catch {
      // Middleware may not exist, ignore
    }
  }

  return client;
}

/**
 * Decorator function to wrap SDK client methods and record permissions
 * This is an alternative approach that doesn't modify the middleware stack
 * 
 * @param client The AWS SDK v3 client to wrap
 * @param options Options for the interceptor
 */
export function wrapSdkClient<TClient extends Client<any, any, any>>(
  client: TClient,
  options: SdkInterceptorOptions = {},
): TClient {
  const recorder = options.recorder ?? getGlobalRecorder();
  const serviceName = extractServiceName(client);

  // Create a proxy that intercepts the 'send' method
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      if (prop === 'send' && typeof value === 'function') {
        return async function(command: Command<any, any, any, any, any>, ...args: any[]) {
          const action = extractActionName(command);
          const resources = extractResourceArns((command as any).input);
          
          // Record the action
          recorder.recordAction(serviceName, action, resources);

          // Check for role assumptions
          if (isAssumeRoleCall(serviceName, action)) {
            const roleDetails = extractRoleAssumptionDetails((command as any).input);
            if (roleDetails) {
              recorder.recordRoleAssumption(
                roleDetails.roleArn,
                roleDetails.sessionName,
                roleDetails.externalId,
              );
            }
          }

          // Call the original method
          return value.call(target, command, ...args);
        };
      }

      return value;
    },
  });
}
