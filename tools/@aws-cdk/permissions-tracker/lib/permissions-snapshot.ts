import { PermissionsCollector } from './permissions-collector';
import { AssumedRole, CapturedApiCall } from './types';

/**
 * Represents a role that was assumed during the test run.
 * This is the serializable format for the snapshot file.
 */
export interface SnapshotAssumedRole {
  /** The ARN of the role that was assumed */
  roleArn: string;
  /** The session name used for the assumed role */
  sessionName?: string;
  /** Duration in seconds for the assumed role session */
  durationSeconds?: number;
  /** The principal that assumed this role */
  assumedBy?: string;
}

/**
 * Represents an action performed during the test run.
 * This is the serializable format for the snapshot file.
 */
export interface SnapshotAction {
  /** The AWS service name (e.g., 's3', 'sts', 'cloudformation') */
  service: string;
  /** The API action name (e.g., 'GetObject', 'AssumeRole') */
  action: string;
  /** The AWS region where the call was made */
  region?: string;
  /** Resource patterns involved in this action */
  resources?: string[];
}

/**
 * The complete snapshot data structure.
 * This is the format of the permissions.snapshot.json file.
 */
export interface SnapshotData {
  /** Version of the snapshot format */
  version: string;
  /** Name of the test that generated this snapshot */
  testName: string;
  /** Timestamp when the snapshot was generated (ISO 8601 format) */
  timestamp: string;
  /** List of roles that were assumed during the test */
  rolesAssumed: SnapshotAssumedRole[];
  /** List of actions that were performed during the test */
  actionsPerformed: SnapshotAction[];
}

/**
 * Options for creating a permissions snapshot.
 */
export interface PermissionsSnapshotOptions {
  /** Name of the test */
  testName: string;
  /**
   * Timestamp for the snapshot.
   * @default - current timestamp
   */
  timestamp?: Date;
}

/**
 * Validation error for malformed snapshots.
 */
export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotValidationError';
  }
}

/**
 * Current version of the snapshot format.
 */
export const SNAPSHOT_VERSION = '1.0';

/**
 * Class representing a permissions snapshot for a test run.
 *
 * The snapshot captures all roles assumed and actions performed during a test,
 * in a deterministic format suitable for git-diff comparisons and regression testing.
 *
 * @example
 * ```typescript
 * // Create from a collector after test run
 * const collector = PermissionsCollector.getInstance();
 * const snapshot = PermissionsSnapshot.fromCollector(collector, { testName: 'my-test' });
 *
 * // Serialize to JSON
 * const json = snapshot.toJSON();
 *
 * // Save to file
 * fs.writeFileSync('permissions.snapshot.json', JSON.stringify(json, null, 2));
 *
 * // Load from JSON
 * const loadedSnapshot = PermissionsSnapshot.fromJSON(json);
 * ```
 */
export class PermissionsSnapshot {
  private readonly data: SnapshotData;

  private constructor(data: SnapshotData) {
    this.data = data;
  }

  /**
   * Creates a new PermissionsSnapshot from a PermissionsCollector.
   *
   * @param collector - The collector containing recorded permissions
   * @param options - Options for creating the snapshot
   * @returns A new PermissionsSnapshot instance
   */
  public static fromCollector(
    collector: PermissionsCollector,
    options: PermissionsSnapshotOptions,
  ): PermissionsSnapshot {
    const collected = collector.getCollectedPermissions();
    const timestamp = options.timestamp || new Date();

    // Convert assumed roles to snapshot format
    const rolesAssumed = PermissionsSnapshot.convertAssumedRoles(collected.assumedRoles);

    // Convert API calls to snapshot format and deduplicate
    const actionsPerformed = PermissionsSnapshot.convertAndDeduplicateActions(collected.apiCalls);

    const data: SnapshotData = {
      version: SNAPSHOT_VERSION,
      testName: options.testName,
      timestamp: timestamp.toISOString(),
      rolesAssumed,
      actionsPerformed,
    };

    return new PermissionsSnapshot(data);
  }

  /**
   * Creates a PermissionsSnapshot from JSON data.
   *
   * @param json - The JSON data to parse
   * @returns A new PermissionsSnapshot instance
   * @throws SnapshotValidationError if the JSON is malformed or missing required fields
   */
  public static fromJSON(json: unknown): PermissionsSnapshot {
    PermissionsSnapshot.validateSnapshotData(json);
    const data = json as SnapshotData;

    // Ensure deterministic sorting
    const sortedData: SnapshotData = {
      version: data.version,
      testName: data.testName,
      timestamp: data.timestamp,
      rolesAssumed: PermissionsSnapshot.sortRoles(data.rolesAssumed),
      actionsPerformed: PermissionsSnapshot.sortActions(data.actionsPerformed),
    };

    return new PermissionsSnapshot(sortedData);
  }

  /**
   * Serializes the snapshot to a JSON-serializable object.
   *
   * The output is deterministically sorted to ensure stable diffs:
   * - Roles are sorted by roleArn
   * - Actions are sorted by service, then action, then region
   *
   * @returns The snapshot data as a plain object
   */
  public toJSON(): SnapshotData {
    return {
      version: this.data.version,
      testName: this.data.testName,
      timestamp: this.data.timestamp,
      rolesAssumed: PermissionsSnapshot.sortRoles(this.data.rolesAssumed),
      actionsPerformed: PermissionsSnapshot.sortActions(this.data.actionsPerformed),
    };
  }

  /**
   * Gets the test name from the snapshot.
   */
  public getTestName(): string {
    return this.data.testName;
  }

  /**
   * Gets the timestamp from the snapshot.
   */
  public getTimestamp(): string {
    return this.data.timestamp;
  }

  /**
   * Gets the roles assumed in this snapshot.
   */
  public getRolesAssumed(): SnapshotAssumedRole[] {
    return [...this.data.rolesAssumed];
  }

  /**
   * Gets the actions performed in this snapshot.
   */
  public getActionsPerformed(): SnapshotAction[] {
    return [...this.data.actionsPerformed];
  }

  /**
   * Gets the snapshot version.
   */
  public getVersion(): string {
    return this.data.version;
  }

  /**
   * Converts assumed roles from collector format to snapshot format.
   */
  private static convertAssumedRoles(assumedRoles: AssumedRole[]): SnapshotAssumedRole[] {
    // Deduplicate by roleArn (keep first occurrence)
    const seen = new Set<string>();
    const deduplicated: SnapshotAssumedRole[] = [];

    for (const role of assumedRoles) {
      if (!seen.has(role.roleArn)) {
        seen.add(role.roleArn);
        deduplicated.push({
          roleArn: role.roleArn,
          sessionName: role.sessionName,
          durationSeconds: role.durationSeconds,
          assumedBy: role.assumedBy,
        });
      }
    }

    return PermissionsSnapshot.sortRoles(deduplicated);
  }

  /**
   * Converts API calls to actions and deduplicates them.
   */
  private static convertAndDeduplicateActions(apiCalls: CapturedApiCall[]): SnapshotAction[] {
    // Group by service:action:region
    const actionMap = new Map<string, SnapshotAction>();

    for (const call of apiCalls) {
      const key = `${call.service}:${call.action}:${call.region || ''}`;

      if (!actionMap.has(key)) {
        actionMap.set(key, {
          service: call.service,
          action: call.action,
          region: call.region,
        });
      }
    }

    return PermissionsSnapshot.sortActions(Array.from(actionMap.values()));
  }

  /**
   * Sorts roles deterministically by roleArn.
   */
  private static sortRoles(roles: SnapshotAssumedRole[]): SnapshotAssumedRole[] {
    return [...roles].sort((a, b) => a.roleArn.localeCompare(b.roleArn));
  }

  /**
   * Sorts actions deterministically by service, then action, then region.
   */
  private static sortActions(actions: SnapshotAction[]): SnapshotAction[] {
    return [...actions].sort((a, b) => {
      // Sort by service first
      const serviceCompare = a.service.localeCompare(b.service);
      if (serviceCompare !== 0) return serviceCompare;

      // Then by action
      const actionCompare = a.action.localeCompare(b.action);
      if (actionCompare !== 0) return actionCompare;

      // Then by region (empty region sorts first)
      const regionA = a.region || '';
      const regionB = b.region || '';
      return regionA.localeCompare(regionB);
    });
  }

  /**
   * Validates that the provided JSON is a valid snapshot.
   */
  private static validateSnapshotData(json: unknown): void {
    if (!json || typeof json !== 'object') {
      throw new SnapshotValidationError('snapshot must be an object');
    }

    const data = json as Record<string, unknown>;

    // Validate required fields
    if (typeof data.version !== 'string') {
      throw new SnapshotValidationError('snapshot.version must be a string');
    }

    if (typeof data.testName !== 'string') {
      throw new SnapshotValidationError('snapshot.testName must be a string');
    }

    if (typeof data.timestamp !== 'string') {
      throw new SnapshotValidationError('snapshot.timestamp must be a string');
    }

    if (!Array.isArray(data.rolesAssumed)) {
      throw new SnapshotValidationError('snapshot.rolesAssumed must be an array');
    }

    if (!Array.isArray(data.actionsPerformed)) {
      throw new SnapshotValidationError('snapshot.actionsPerformed must be an array');
    }

    // Validate each role
    for (let i = 0; i < data.rolesAssumed.length; i++) {
      const role = (data.rolesAssumed as unknown[])[i];
      PermissionsSnapshot.validateRole(role, i);
    }

    // Validate each action
    for (let i = 0; i < data.actionsPerformed.length; i++) {
      const action = (data.actionsPerformed as unknown[])[i];
      PermissionsSnapshot.validateAction(action, i);
    }
  }

  /**
   * Validates a role object.
   */
  private static validateRole(role: unknown, index: number): void {
    if (!role || typeof role !== 'object') {
      throw new SnapshotValidationError(`rolesAssumed[${index}] must be an object`);
    }

    const roleData = role as Record<string, unknown>;
    if (typeof roleData.roleArn !== 'string') {
      throw new SnapshotValidationError(`rolesAssumed[${index}].roleArn must be a string`);
    }
  }

  /**
   * Validates an action object.
   */
  private static validateAction(action: unknown, index: number): void {
    if (!action || typeof action !== 'object') {
      throw new SnapshotValidationError(`actionsPerformed[${index}] must be an object`);
    }

    const actionData = action as Record<string, unknown>;
    if (typeof actionData.service !== 'string') {
      throw new SnapshotValidationError(`actionsPerformed[${index}].service must be a string`);
    }

    if (typeof actionData.action !== 'string') {
      throw new SnapshotValidationError(`actionsPerformed[${index}].action must be a string`);
    }
  }
}
