import type {
  InitializeHandler,
  InitializeHandlerArguments,
  InitializeMiddleware,
  InitializeHandlerOptions,
  HandlerExecutionContext,
  Pluggable,
  MetadataBearer,
} from '@smithy/types';
import type { RecordedAction, RoleAssumption } from './types';

/**
 * Extracts the service name from a client or command
 */
function extractServiceName(context: HandlerExecutionContext): string {
  // Try to get service name from client config
  const clientName = context.clientName || '';
  
  // Extract service name from client name (e.g., 'S3Client' -> 's3', 'STSClient' -> 'sts')
  const match = clientName.match(/^(\w+?)Client$/i);
  if (match) {
    return match[1].toLowerCase();
  }
  
  return clientName.toLowerCase() || 'unknown';
}

/**
 * Extracts the action name from a command
 */
function extractActionName(context: HandlerExecutionContext): string {
  const commandName = context.commandName || '';
  // Remove 'Command' suffix (e.g., 'PutObjectCommand' -> 'PutObject')
  return commandName.replace(/Command$/, '');
}

/**
 * Converts service and action to IAM action format
 */
function toIamAction(service: string, action: string): string {
  // Convert action to lowercase first letter for IAM format
  const iamAction = action.charAt(0).toLowerCase() + action.slice(1);
  return `${service}:${iamAction}`;
}

/**
 * Extracts resource ARNs from request input if available
 */
function extractResources(input: any): string[] | undefined {
  const resources: string[] = [];
  
  // Common patterns for resource identifiers in AWS SDK calls
  const arnPatterns = ['Arn', 'ARN', 'arn'];
  const resourcePatterns = ['Bucket', 'FunctionName', 'TableName', 'QueueUrl', 'TopicArn', 'RoleArn', 'StackName'];
  
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }

  // Look for ARN fields
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (typeof value === 'string') {
      // Check if it's an ARN
      if (value.startsWith('arn:')) {
        resources.push(value);
      }
      // Check for known resource identifier patterns
      else if (arnPatterns.some(p => key.includes(p)) || resourcePatterns.includes(key)) {
        resources.push(value);
      }
    }
  }

  return resources.length > 0 ? resources : undefined;
}

/**
 * Storage for recorded actions and role assumptions
 */
class RecordingState {
  private static instance: RecordingState;
  
  private actions: Map<string, RecordedAction> = new Map();
  private roleAssumptions: RoleAssumption[] = [];
  private isRecording: boolean = false;
  private excludeServices: Set<string> = new Set();
  private excludeActions: Set<string> = new Set();
  private includeResources: boolean = false;

  private constructor() {}

  static getInstance(): RecordingState {
    if (!RecordingState.instance) {
      RecordingState.instance = new RecordingState();
    }
    return RecordingState.instance;
  }

  startRecording(options?: {
    excludeServices?: string[];
    excludeActions?: string[];
    includeResources?: boolean;
  }): void {
    this.isRecording = true;
    this.actions.clear();
    this.roleAssumptions = [];
    this.excludeServices = new Set(options?.excludeServices?.map(s => s.toLowerCase()) || []);
    this.excludeActions = new Set(options?.excludeActions?.map(a => a.toLowerCase()) || []);
    this.includeResources = options?.includeResources || false;
  }

  stopRecording(): { actions: RecordedAction[]; roleAssumptions: RoleAssumption[] } {
    this.isRecording = false;
    const result = {
      actions: Array.from(this.actions.values()),
      roleAssumptions: [...this.roleAssumptions],
    };
    return result;
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  recordAction(action: RecordedAction): void {
    if (!this.isRecording) return;

    // Check exclusions
    if (this.excludeServices.has(action.service.toLowerCase())) return;
    if (this.excludeActions.has(action.iamAction.toLowerCase())) return;

    // Create a unique key for deduplication
    const key = this.includeResources && action.resources
      ? `${action.iamAction}:${action.resources.sort().join(',')}`
      : action.iamAction;

    // Only store if not already recorded (for unique actions)
    if (!this.actions.has(key)) {
      this.actions.set(key, {
        ...action,
        resources: this.includeResources ? action.resources : undefined,
      });
    }
  }

  recordRoleAssumption(roleAssumption: RoleAssumption): void {
    if (!this.isRecording) return;
    this.roleAssumptions.push(roleAssumption);
  }
}

/**
 * AWS SDK v3 middleware plugin for recording permissions
 */
export const permissionsRecorderMiddleware: InitializeMiddleware<any, MetadataBearer> = (
  next: InitializeHandler<any, MetadataBearer>,
  context: HandlerExecutionContext,
): InitializeHandler<any, MetadataBearer> => {
  return async (args: InitializeHandlerArguments<any>) => {
    const state = RecordingState.getInstance();
    
    if (state.isCurrentlyRecording()) {
      const service = extractServiceName(context);
      const action = extractActionName(context);
      const iamAction = toIamAction(service, action);
      const resources = extractResources(args.input);

      // Record the action
      state.recordAction({
        service,
        action,
        iamAction,
        resources,
      });

      // Special handling for STS AssumeRole calls
      if (service === 'sts' && action === 'AssumeRole') {
        const input = args.input as { RoleArn?: string; RoleSessionName?: string };
        if (input.RoleArn) {
          state.recordRoleAssumption({
            roleArn: input.RoleArn,
            sessionName: input.RoleSessionName,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return next(args);
  };
};

/**
 * Plugin configuration for the middleware
 */
const permissionsRecorderMiddlewareOptions: InitializeHandlerOptions = {
  name: 'permissionsRecorderMiddleware',
  step: 'initialize',
  tags: ['PERMISSIONS_RECORDER'],
  priority: 'high',
};

/**
 * Plugin that can be added to any AWS SDK v3 client
 */
export const permissionsRecorderPlugin: Pluggable<any, any> = {
  applyToStack: (clientStack) => {
    clientStack.add(permissionsRecorderMiddleware, permissionsRecorderMiddlewareOptions);
  },
};

/**
 * Start recording AWS SDK calls
 */
export function startRecording(options?: {
  excludeServices?: string[];
  excludeActions?: string[];
  includeResources?: boolean;
}): void {
  RecordingState.getInstance().startRecording(options);
}

/**
 * Stop recording and return the recorded data
 */
export function stopRecording(): { actions: RecordedAction[]; roleAssumptions: RoleAssumption[] } {
  return RecordingState.getInstance().stopRecording();
}

/**
 * Check if recording is currently active
 */
export function isRecording(): boolean {
  return RecordingState.getInstance().isCurrentlyRecording();
}

/**
 * Get the singleton recording state (for advanced use cases)
 */
export function getRecordingState(): RecordingState {
  return RecordingState.getInstance();
}
