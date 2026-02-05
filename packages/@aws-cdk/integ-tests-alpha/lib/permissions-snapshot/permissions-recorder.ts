import type {
  PermissionsSnapshot,
  RecordedIamAction,
  RecordedRoleAssumption,
  PermissionsRecorderOptions,
} from './types';

/**
 * The current version of the permissions snapshot format
 */
export const SNAPSHOT_VERSION = '1.0.0';

/**
 * Default services to exclude from recording
 * These services are typically very noisy and not relevant for IAM policy changes
 */
const DEFAULT_EXCLUDED_SERVICES = [
  'cloudwatch', // Metrics are often published automatically
];

/**
 * Default actions to exclude from recording
 */
const DEFAULT_EXCLUDED_ACTIONS = [
  'logs:CreateLogGroup',
  'logs:CreateLogStream',
  'logs:PutLogEvents',
  'logs:DescribeLogGroups',
  'logs:DescribeLogStreams',
];

/**
 * Recorder that accumulates IAM actions and role assumptions during test execution
 */
export class PermissionsRecorder {
  private readonly iamActions: Map<string, RecordedIamAction> = new Map();
  private readonly assumedRoles: Map<string, RecordedRoleAssumption> = new Map();
  private readonly options: Required<PermissionsRecorderOptions>;
  private isRecording = false;
  private testName?: string;

  constructor(options: PermissionsRecorderOptions = {}) {
    this.options = {
      includeResourceArns: options.includeResourceArns ?? false,
      includeTimestamps: options.includeTimestamps ?? false,
      excludeServices: [
        ...DEFAULT_EXCLUDED_SERVICES,
        ...(options.excludeServices ?? []),
      ],
      excludeActions: [
        ...DEFAULT_EXCLUDED_ACTIONS,
        ...(options.excludeActions ?? []),
      ],
    };
  }

  /**
   * Start recording permissions
   * @param testName Optional name of the test being recorded
   */
  public startRecording(testName?: string): void {
    if (this.isRecording) {
      throw new Error('Recording is already in progress. Call stopRecording() first.');
    }
    this.testName = testName;
    this.iamActions.clear();
    this.assumedRoles.clear();
    this.isRecording = true;
  }

  /**
   * Stop recording and return the snapshot
   */
  public stopRecording(): PermissionsSnapshot {
    if (!this.isRecording) {
      throw new Error('Recording is not in progress. Call startRecording() first.');
    }
    this.isRecording = false;

    return this.getSnapshot();
  }

  /**
   * Get the current snapshot without stopping recording
   */
  public getSnapshot(): PermissionsSnapshot {
    // Sort IAM actions by service and action for deterministic output
    const sortedActions = Array.from(this.iamActions.values()).sort((a, b) => {
      const serviceCompare = a.service.localeCompare(b.service);
      if (serviceCompare !== 0) return serviceCompare;
      return a.action.localeCompare(b.action);
    });

    // Sort assumed roles by ARN for deterministic output
    const sortedRoles = Array.from(this.assumedRoles.values()).sort((a, b) =>
      a.roleArn.localeCompare(b.roleArn),
    );

    const snapshot: PermissionsSnapshot = {
      version: SNAPSHOT_VERSION,
      testName: this.testName,
      assumedRoles: sortedRoles,
      iamActions: sortedActions,
    };

    if (this.options.includeTimestamps) {
      return {
        ...snapshot,
        timestamp: new Date().toISOString(),
      };
    }

    return snapshot;
  }

  /**
   * Record an IAM action
   */
  public recordAction(service: string, action: string, resources?: string[]): void {
    if (!this.isRecording) return;

    // Normalize service name to lowercase
    const normalizedService = service.toLowerCase();

    // Check exclusions
    if (this.options.excludeServices.includes(normalizedService)) {
      return;
    }

    const fullAction = `${normalizedService}:${action}`;
    if (this.options.excludeActions.includes(fullAction)) {
      return;
    }

    // Create a unique key for deduplication
    const key = this.options.includeResourceArns && resources?.length
      ? `${fullAction}:${resources.sort().join(',')}`
      : fullAction;

    if (!this.iamActions.has(key)) {
      const recordedAction: RecordedIamAction = {
        service: normalizedService,
        action,
      };

      if (this.options.includeResourceArns && resources?.length) {
        this.iamActions.set(key, {
          ...recordedAction,
          resources: [...resources].sort(),
        });
      } else {
        this.iamActions.set(key, recordedAction);
      }
    }
  }

  /**
   * Record a role assumption
   */
  public recordRoleAssumption(
    roleArn: string,
    sessionName?: string,
    externalId?: string,
  ): void {
    if (!this.isRecording) return;

    // Use roleArn as the key for deduplication
    if (!this.assumedRoles.has(roleArn)) {
      const assumption: RecordedRoleAssumption = { roleArn };
      if (sessionName) {
        this.assumedRoles.set(roleArn, { ...assumption, sessionName });
      }
      if (externalId) {
        this.assumedRoles.set(roleArn, {
          ...this.assumedRoles.get(roleArn) ?? assumption,
          externalId,
        });
      }
      if (!sessionName && !externalId) {
        this.assumedRoles.set(roleArn, assumption);
      }
    }
  }

  /**
   * Check if recording is currently in progress
   */
  public get recording(): boolean {
    return this.isRecording;
  }

  /**
   * Clear all recorded data
   */
  public clear(): void {
    this.iamActions.clear();
    this.assumedRoles.clear();
    this.testName = undefined;
  }
}

/**
 * Global singleton instance for easy access
 */
let globalRecorder: PermissionsRecorder | undefined;

/**
 * Get or create the global permissions recorder instance
 */
export function getGlobalRecorder(options?: PermissionsRecorderOptions): PermissionsRecorder {
  if (!globalRecorder) {
    globalRecorder = new PermissionsRecorder(options);
  }
  return globalRecorder;
}

/**
 * Reset the global recorder (useful for testing)
 */
export function resetGlobalRecorder(): void {
  if (globalRecorder) {
    globalRecorder.clear();
  }
  globalRecorder = undefined;
}
