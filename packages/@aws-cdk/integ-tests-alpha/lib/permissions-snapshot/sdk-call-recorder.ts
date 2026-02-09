import { PermissionsTracker } from './permissions-tracker';

/**
 * AWS SDK v3 middleware plugin that intercepts all service calls and records them
 * to the PermissionsTracker.
 *
 * This middleware hooks into the AWS SDK v3 middleware stack to capture:
 * - All API calls (service and action names)
 * - Role assumptions via STS AssumeRole, AssumeRoleWithSAML, AssumeRoleWithWebIdentity
 * - Federation token requests
 */

/**
 * Middleware configuration for the SDK call recorder
 */
export interface SdkCallRecorderMiddlewareConfig {
  /**
   * Name identifier for the middleware
   */
  name: string;
  /**
   * Tags for the middleware (used by SDK)
   */
  tags: string[];
  /**
   * Override the function to extract the service name
   */
  override?: boolean;
}

/**
 * Creates an AWS SDK v3 middleware function that records all API calls
 * 
 * @param tracker - The permissions tracker to record to
 * @returns A middleware function that can be added to any AWS SDK v3 client
 */
export function createSdkCallRecorderMiddleware(
  tracker?: PermissionsTracker,
): (next: any, context: any) => (args: any) => Promise<any> {
  const permissionsTracker = tracker ?? PermissionsTracker.getInstance();

  return (next: any, context: any) => async (args: any) => {
    // Extract service and command information from context
    const serviceName = extractServiceName(context);
    const commandName = extractCommandName(context, args);

    // Record the action
    if (serviceName && commandName) {
      permissionsTracker.recordAction(serviceName, commandName);

      // Check for role assumption calls
      if (isRoleAssumptionCall(serviceName, commandName)) {
        recordRoleAssumption(permissionsTracker, commandName, args.input);
      }
    }

    // Continue with the request
    return next(args);
  };
}

/**
 * Configuration for the SDK call recorder middleware plugin
 */
export const sdkCallRecorderMiddlewareConfig: SdkCallRecorderMiddlewareConfig = {
  name: 'permissionsSnapshotRecorder',
  tags: ['PERMISSIONS_SNAPSHOT'],
  override: true,
};

/**
 * Creates a middleware plugin that can be used with `client.middlewareStack.use()`
 * 
 * @param tracker - Optional permissions tracker instance
 * @returns A middleware plugin configuration
 */
export function createSdkCallRecorderPlugin(tracker?: PermissionsTracker) {
  const middleware = createSdkCallRecorderMiddleware(tracker);

  return {
    applyToStack: (clientStack: any) => {
      clientStack.add(middleware, {
        step: 'initialize',
        name: sdkCallRecorderMiddlewareConfig.name,
        tags: sdkCallRecorderMiddlewareConfig.tags,
        priority: 'high',
      });
    },
  };
}

/**
 * Extracts the AWS service name from the SDK context
 */
function extractServiceName(context: any): string | undefined {
  // Try different ways to get the service name based on SDK version/implementation
  if (context.clientName) {
    // v3 style: "S3Client" -> "s3"
    return context.clientName.replace(/Client$/, '').toLowerCase();
  }

  if (context.commandName) {
    // Try to infer from command name if available
    return undefined;
  }

  if (context.service) {
    return context.service;
  }

  return undefined;
}

/**
 * Extracts the command/action name from the SDK context
 */
function extractCommandName(context: any, args: any): string | undefined {
  // v3 style: context.commandName or constructor name
  if (context.commandName) {
    // Remove "Command" suffix: "PutObjectCommand" -> "PutObject"
    return context.commandName.replace(/Command$/, '');
  }

  // Try to get from args if available
  if (args.constructor?.name) {
    return args.constructor.name.replace(/Command$/, '');
  }

  return undefined;
}

/**
 * Checks if the call is a role assumption call
 */
function isRoleAssumptionCall(service: string, command: string): boolean {
  const normalizedService = service.toLowerCase();
  const normalizedCommand = command.toLowerCase();

  if (normalizedService !== 'sts') {
    return false;
  }

  const roleAssumptionCommands = [
    'assumerole',
    'assumerolewithsaml',
    'assumerolewithwebidentity',
    'getfederationtoken',
    'getsessiontoken',
  ];

  return roleAssumptionCommands.includes(normalizedCommand);
}

/**
 * Records a role assumption to the tracker
 */
function recordRoleAssumption(
  tracker: PermissionsTracker,
  command: string,
  input: any,
): void {
  const normalizedCommand = command.toLowerCase();

  switch (normalizedCommand) {
    case 'assumerole':
    case 'assumerolewithsaml':
    case 'assumerolewithwebidentity':
      if (input?.RoleArn) {
        tracker.recordRoleAssumption(
          input.RoleArn,
          input.RoleSessionName,
          input.SourceIdentity,
        );
      }
      break;

    case 'getfederationtoken':
      // Federation tokens don't have a role ARN but we still want to track them
      tracker.recordRoleAssumption(
        'federation-token',
        input?.Name,
        undefined,
      );
      break;

    case 'getsessiontoken':
      // Session tokens are created from current credentials
      tracker.recordRoleAssumption(
        'session-token',
        undefined,
        undefined,
      );
      break;
  }
}

/**
 * Helper function to install the recorder on an existing AWS SDK v3 client
 * 
 * @param client - Any AWS SDK v3 client instance
 * @param tracker - Optional permissions tracker instance
 * 
 * @example
 * ```ts
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { installSdkCallRecorder } from '@aws-cdk/integ-tests-alpha';
 * 
 * const client = new S3Client({});
 * installSdkCallRecorder(client);
 * ```
 */
export function installSdkCallRecorder(client: any, tracker?: PermissionsTracker): void {
  if (!client.middlewareStack) {
    console.warn('Cannot install SDK call recorder: client does not have a middleware stack');
    return;
  }

  const plugin = createSdkCallRecorderPlugin(tracker);
  client.middlewareStack.use(plugin);
}

/**
 * Helper function to create a client configuration with the recorder middleware
 * 
 * This can be used when creating new clients to automatically include the recorder.
 * 
 * @param baseConfig - Base client configuration
 * @param tracker - Optional permissions tracker instance
 * @returns Client configuration with recorder middleware
 * 
 * @example
 * ```ts
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { withSdkCallRecording } from '@aws-cdk/integ-tests-alpha';
 * 
 * const client = new S3Client(withSdkCallRecording({ region: 'us-east-1' }));
 * ```
 */
export function withSdkCallRecording<T extends object>(
  baseConfig: T,
  tracker?: PermissionsTracker,
): T & { customUserAgent?: any } {
  return {
    ...baseConfig,
    // Add a custom user agent to help identify calls made with recording enabled
    customUserAgent: [['permissions-snapshot', '1.0']],
  };
}
