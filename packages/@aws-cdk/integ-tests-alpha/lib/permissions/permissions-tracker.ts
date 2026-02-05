import type {
  InitializeHandler,
  InitializeHandlerArguments,
  InitializeHandlerOptions,
  InitializeHandlerOutput,
  InitializeMiddleware,
  MetadataBearer,
  Pluggable,
} from '@smithy/types';
import type { AssumedRole, IamAction, PermissionsSnapshot } from './types';

/**
 * The current version of the permissions snapshot format
 */
export const PERMISSIONS_SNAPSHOT_VERSION = '1.0.0';

/**
 * STS operations that represent role assumptions
 */
const ROLE_ASSUMPTION_OPERATIONS = [
  'AssumeRole',
  'AssumeRoleWithSAML',
  'AssumeRoleWithWebIdentity',
];

/**
 * Service name mapping for common AWS SDK client names
 */
const SERVICE_NAME_MAPPING: Record<string, string> = {
  S3: 's3',
  Lambda: 'lambda',
  EC2: 'ec2',
  STS: 'sts',
  IAM: 'iam',
  DynamoDB: 'dynamodb',
  CloudFormation: 'cloudformation',
  CloudWatch: 'cloudwatch',
  SNS: 'sns',
  SQS: 'sqs',
  KMS: 'kms',
  SecretsManager: 'secretsmanager',
  SSM: 'ssm',
  ECS: 'ecs',
  EKS: 'eks',
  RDS: 'rds',
  ElasticLoadBalancingV2: 'elasticloadbalancing',
  APIGateway: 'apigateway',
  Route53: 'route53',
  ACM: 'acm',
  CodeBuild: 'codebuild',
  CodePipeline: 'codepipeline',
  StepFunctions: 'states',
};

/**
 * PermissionsTracker is a singleton class that tracks AWS SDK calls made during
 * integration test execution. It captures IAM roles assumed and IAM actions performed.
 *
 * @example
 * ```typescript
 * import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
 * import { PermissionsTracker } from './permissions-tracker';
 *
 * const tracker = PermissionsTracker.getInstance();
 * tracker.startTracking('my-test');
 *
 * const s3Client = new S3Client({});
 * s3Client.middlewareStack.use(tracker.createMiddlewarePlugin());
 *
 * // Make SDK calls...
 * await s3Client.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: 'my-key' }));
 *
 * tracker.stopTracking();
 * const snapshot = tracker.getSnapshot();
 * // snapshot.iamActions will contain { service: 's3', action: 'GetObject', timestamp: '...' }
 * ```
 */
export class PermissionsTracker {
  private static instance: PermissionsTracker;

  private isTracking: boolean = false;
  private testName: string = '';
  private assumedRoles: AssumedRole[] = [];
  private iamActions: IamAction[] = [];
  private trackingStartTime: string = '';

  private constructor() {}

  /**
   * Get the singleton instance of PermissionsTracker
   */
  public static getInstance(): PermissionsTracker {
    if (!PermissionsTracker.instance) {
      PermissionsTracker.instance = new PermissionsTracker();
    }
    return PermissionsTracker.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   * @internal
   */
  public static resetInstance(): void {
    PermissionsTracker.instance = new PermissionsTracker();
  }

  /**
   * Start tracking permissions for a test
   *
   * @param testName - The name of the test being run
   */
  public startTracking(testName: string): void {
    this.testName = testName;
    this.isTracking = true;
    this.assumedRoles = [];
    this.iamActions = [];
    this.trackingStartTime = new Date().toISOString();
  }

  /**
   * Stop tracking permissions
   */
  public stopTracking(): void {
    this.isTracking = false;
  }

  /**
   * Check if tracking is currently active
   */
  public isCurrentlyTracking(): boolean {
    return this.isTracking;
  }

  /**
   * Reset the tracker state
   */
  public reset(): void {
    this.isTracking = false;
    this.testName = '';
    this.assumedRoles = [];
    this.iamActions = [];
    this.trackingStartTime = '';
  }

  /**
   * Get a snapshot of all captured permissions
   *
   * @returns A PermissionsSnapshot containing all captured roles and actions
   */
  public getSnapshot(): PermissionsSnapshot {
    return {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      testName: this.testName,
      capturedAt: this.trackingStartTime || new Date().toISOString(),
      assumedRoles: [...this.assumedRoles],
      iamActions: [...this.iamActions],
    };
  }

  /**
   * Create middleware that can be attached to AWS SDK clients
   *
   * @returns AWS SDK middleware function
   */
  public createMiddleware<Input extends object, Output extends MetadataBearer>(): InitializeMiddleware<Input, Output> {
    return (next: InitializeHandler<Input, Output>): InitializeHandler<Input, Output> => {
      return async (args: InitializeHandlerArguments<Input>): Promise<InitializeHandlerOutput<Output>> => {
        if (this.isTracking) {
          this.captureAction(args);
        }
        return next(args);
      };
    };
  }

  /**
   * Create a middleware plugin that can be used with SDK client middleware stack
   *
   * @returns A pluggable middleware configuration
   */
  public createMiddlewarePlugin<Input extends object, Output extends MetadataBearer>(): Pluggable<Input, Output> {
    const tracker = this;
    return {
      applyToStack: (stack) => {
        stack.add(
          tracker.createMiddleware<Input, Output>(),
          {
            step: 'initialize',
            name: 'permissionsTrackerMiddleware',
            tags: ['PERMISSIONS_TRACKER'],
          } as InitializeHandlerOptions,
        );
      },
    };
  }

  /**
   * Capture an IAM action from SDK call arguments
   */
  private captureAction<Input extends object>(args: InitializeHandlerArguments<Input>): void {
    const timestamp = new Date().toISOString();

    // Extract command name and service information
    const commandName = this.extractCommandName(args);
    const serviceName = this.extractServiceName(args);

    if (!commandName || !serviceName) {
      return;
    }

    // Check if this is a role assumption operation
    if (serviceName === 'sts' && ROLE_ASSUMPTION_OPERATIONS.includes(commandName)) {
      this.captureRoleAssumption(args, commandName, timestamp);
    }

    // Record the IAM action
    this.iamActions.push({
      service: serviceName,
      action: commandName,
      timestamp,
    });
  }

  /**
   * Capture a role assumption operation
   */
  private captureRoleAssumption<Input extends object>(
    args: InitializeHandlerArguments<Input>,
    _commandName: string,
    timestamp: string,
  ): void {
    const input = args.input as Record<string, unknown>;
    const roleArn = input.RoleArn as string | undefined;
    const sessionName = input.RoleSessionName as string | undefined;

    if (roleArn) {
      this.assumedRoles.push({
        roleArn,
        sessionName,
        timestamp,
      });
    }
  }

  /**
   * Extract the command/action name from SDK call arguments
   */
  private extractCommandName<Input extends object>(args: InitializeHandlerArguments<Input>): string | undefined {
    // The command name is typically available in the constructor name
    // e.g., GetObjectCommand -> GetObject
    const input = args.input as { constructor?: { name?: string } };
    if (input.constructor?.name) {
      return input.constructor.name.replace(/Command$/, '');
    }

    // Fallback: try to get from request context
    const request = args.request as { commandName?: string } | undefined;
    return request?.commandName;
  }

  /**
   * Extract the service name from SDK call arguments
   */
  private extractServiceName<Input extends object>(args: InitializeHandlerArguments<Input>): string | undefined {
    // Try to get from request (SDK v3 typically includes this)
    const request = args.request as { serviceName?: string; hostname?: string } | undefined;

    if (request?.serviceName) {
      return this.normalizeServiceName(request.serviceName);
    }

    // Try to extract from hostname
    if (request?.hostname) {
      const match = request.hostname.match(/^([^.]+)\..*\.amazonaws\.com$/);
      if (match) {
        return match[1];
      }
    }

    // Fallback: try to get from input's internal properties
    const input = args.input as { $metadata?: { service?: string } };
    if (input.$metadata?.service) {
      return this.normalizeServiceName(input.$metadata.service);
    }

    return undefined;
  }

  /**
   * Normalize a service name to lowercase format used in IAM
   */
  private normalizeServiceName(serviceName: string): string {
    // Check our mapping first
    if (SERVICE_NAME_MAPPING[serviceName]) {
      return SERVICE_NAME_MAPPING[serviceName];
    }

    // Default to lowercase
    return serviceName.toLowerCase();
  }

  /**
   * Get the list of assumed roles (for testing purposes)
   * @internal
   */
  public getAssumedRoles(): AssumedRole[] {
    return [...this.assumedRoles];
  }

  /**
   * Get the list of IAM actions (for testing purposes)
   * @internal
   */
  public getIamActions(): IamAction[] {
    return [...this.iamActions];
  }

  /**
   * Get the current test name (for testing purposes)
   * @internal
   */
  public getTestName(): string {
    return this.testName;
  }
}
