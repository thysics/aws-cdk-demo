import {
  PermissionsSnapshot,
  SnapshotAssumedRole,
  SnapshotAction,
  SnapshotData,
} from './permissions-snapshot';

/**
 * Represents a difference in a role between two snapshots.
 */
export interface RoleDiff {
  /** The role that was added or removed */
  role: SnapshotAssumedRole;
  /** Whether this role was added (true) or removed (false) */
  added: boolean;
}

/**
 * Represents a difference in an action between two snapshots.
 */
export interface ActionDiff {
  /** The action that was added or removed */
  action: SnapshotAction;
  /** Whether this action was added (true) or removed (false) */
  added: boolean;
}

/**
 * The result of comparing two permissions snapshots.
 */
export interface SnapshotDiffResult {
  /** Whether the snapshots are identical */
  identical: boolean;
  /** Roles that were added in the actual snapshot */
  newRoles: SnapshotAssumedRole[];
  /** Roles that were removed in the actual snapshot */
  removedRoles: SnapshotAssumedRole[];
  /** Actions that were added in the actual snapshot */
  newActions: SnapshotAction[];
  /** Actions that were removed in the actual snapshot */
  removedActions: SnapshotAction[];
}

/**
 * Options for formatting the diff report.
 */
export interface DiffFormatOptions {
  /**
   * Whether to include a header in the output.
   * @default true
   */
  includeHeader?: boolean;
  /**
   * Whether to use colors in the output.
   * @default true
   */
  useColors?: boolean;
  /**
   * The maximum number of items to show per section.
   * @default - no limit
   */
  maxItemsPerSection?: number;
}

/**
 * Class for comparing two permissions snapshots and producing diff reports.
 *
 * The comparator identifies differences between an expected snapshot (baseline)
 * and an actual snapshot (current), highlighting new and removed permissions.
 *
 * @example
 * ```typescript
 * const comparator = new SnapshotComparator(expectedSnapshot, actualSnapshot);
 * const diff = comparator.compare();
 *
 * if (!diff.identical) {
 *   console.log(comparator.formatDiff());
 * }
 * ```
 */
export class SnapshotComparator {
  private readonly expected: PermissionsSnapshot;
  private readonly actual: PermissionsSnapshot;
  private cachedDiff?: SnapshotDiffResult;

  /**
   * Creates a new SnapshotComparator.
   *
   * @param expected - The expected/baseline snapshot
   * @param actual - The actual/current snapshot to compare
   */
  constructor(expected: PermissionsSnapshot, actual: PermissionsSnapshot) {
    this.expected = expected;
    this.actual = actual;
  }

  /**
   * Compares the two snapshots and returns the diff result.
   *
   * @returns The diff result containing all differences
   */
  public compare(): SnapshotDiffResult {
    if (this.cachedDiff) {
      return this.cachedDiff;
    }

    const expectedRoles = this.expected.getRolesAssumed();
    const actualRoles = this.actual.getRolesAssumed();
    const expectedActions = this.expected.getActionsPerformed();
    const actualActions = this.actual.getActionsPerformed();

    // Find role differences
    const newRoles = this.findNewRoles(expectedRoles, actualRoles);
    const removedRoles = this.findRemovedRoles(expectedRoles, actualRoles);

    // Find action differences
    const newActions = this.findNewActions(expectedActions, actualActions);
    const removedActions = this.findRemovedActions(expectedActions, actualActions);

    const identical = newRoles.length === 0 &&
                     removedRoles.length === 0 &&
                     newActions.length === 0 &&
                     removedActions.length === 0;

    this.cachedDiff = {
      identical,
      newRoles,
      removedRoles,
      newActions,
      removedActions,
    };

    return this.cachedDiff;
  }

  /**
   * Formats the diff result as a human-readable string suitable for CI/CD logs.
   *
   * @param options - Formatting options
   * @returns Formatted diff string
   */
  public formatDiff(options: DiffFormatOptions = {}): string {
    const {
      includeHeader = true,
      useColors = true,
      maxItemsPerSection,
    } = options;

    const diff = this.compare();
    const lines: string[] = [];

    // Color codes
    const red = useColors ? '\x1b[31m' : '';
    const green = useColors ? '\x1b[32m' : '';
    const yellow = useColors ? '\x1b[33m' : '';
    const reset = useColors ? '\x1b[0m' : '';
    const bold = useColors ? '\x1b[1m' : '';

    if (diff.identical) {
      if (includeHeader) {
        lines.push(`${green}✓ Permissions snapshot matches${reset}`);
      }
      return lines.join('\n');
    }

    if (includeHeader) {
      lines.push(`${red}${bold}✗ Permissions snapshot mismatch${reset}`);
      lines.push('');
    }

    // Format new roles
    if (diff.newRoles.length > 0) {
      lines.push(`${yellow}New roles assumed (${diff.newRoles.length}):${reset}`);
      const rolesToShow = maxItemsPerSection
        ? diff.newRoles.slice(0, maxItemsPerSection)
        : diff.newRoles;

      for (const role of rolesToShow) {
        lines.push(`  ${green}+ ${role.roleArn}${reset}`);
        if (role.sessionName) {
          lines.push(`      session: ${role.sessionName}`);
        }
      }

      if (maxItemsPerSection && diff.newRoles.length > maxItemsPerSection) {
        lines.push(`  ... and ${diff.newRoles.length - maxItemsPerSection} more`);
      }
      lines.push('');
    }

    // Format removed roles
    if (diff.removedRoles.length > 0) {
      lines.push(`${yellow}Removed roles (${diff.removedRoles.length}):${reset}`);
      const rolesToShow = maxItemsPerSection
        ? diff.removedRoles.slice(0, maxItemsPerSection)
        : diff.removedRoles;

      for (const role of rolesToShow) {
        lines.push(`  ${red}- ${role.roleArn}${reset}`);
        if (role.sessionName) {
          lines.push(`      session: ${role.sessionName}`);
        }
      }

      if (maxItemsPerSection && diff.removedRoles.length > maxItemsPerSection) {
        lines.push(`  ... and ${diff.removedRoles.length - maxItemsPerSection} more`);
      }
      lines.push('');
    }

    // Format new actions
    if (diff.newActions.length > 0) {
      lines.push(`${yellow}New actions performed (${diff.newActions.length}):${reset}`);
      const actionsToShow = maxItemsPerSection
        ? diff.newActions.slice(0, maxItemsPerSection)
        : diff.newActions;

      for (const action of actionsToShow) {
        const regionSuffix = action.region ? ` (${action.region})` : '';
        lines.push(`  ${green}+ ${action.service}:${action.action}${regionSuffix}${reset}`);
      }

      if (maxItemsPerSection && diff.newActions.length > maxItemsPerSection) {
        lines.push(`  ... and ${diff.newActions.length - maxItemsPerSection} more`);
      }
      lines.push('');
    }

    // Format removed actions
    if (diff.removedActions.length > 0) {
      lines.push(`${yellow}Removed actions (${diff.removedActions.length}):${reset}`);
      const actionsToShow = maxItemsPerSection
        ? diff.removedActions.slice(0, maxItemsPerSection)
        : diff.removedActions;

      for (const action of actionsToShow) {
        const regionSuffix = action.region ? ` (${action.region})` : '';
        lines.push(`  ${red}- ${action.service}:${action.action}${regionSuffix}${reset}`);
      }

      if (maxItemsPerSection && diff.removedActions.length > maxItemsPerSection) {
        lines.push(`  ... and ${diff.removedActions.length - maxItemsPerSection} more`);
      }
      lines.push('');
    }

    // Summary
    const totalChanges = diff.newRoles.length + diff.removedRoles.length +
                        diff.newActions.length + diff.removedActions.length;
    lines.push(`${bold}Total changes: ${totalChanges}${reset}`);

    return lines.join('\n');
  }

  /**
   * Returns a summary of the diff suitable for use as a test failure message.
   */
  public getSummary(): string {
    const diff = this.compare();

    if (diff.identical) {
      return 'Snapshots are identical';
    }

    const parts: string[] = [];
    if (diff.newRoles.length > 0) {
      parts.push(`${diff.newRoles.length} new role(s)`);
    }
    if (diff.removedRoles.length > 0) {
      parts.push(`${diff.removedRoles.length} removed role(s)`);
    }
    if (diff.newActions.length > 0) {
      parts.push(`${diff.newActions.length} new action(s)`);
    }
    if (diff.removedActions.length > 0) {
      parts.push(`${diff.removedActions.length} removed action(s)`);
    }

    return `Snapshot mismatch: ${parts.join(', ')}`;
  }

  /**
   * Finds roles that are in actual but not in expected.
   */
  private findNewRoles(
    expected: SnapshotAssumedRole[],
    actual: SnapshotAssumedRole[],
  ): SnapshotAssumedRole[] {
    const expectedArns = new Set(expected.map(r => r.roleArn));
    return actual.filter(r => !expectedArns.has(r.roleArn));
  }

  /**
   * Finds roles that are in expected but not in actual.
   */
  private findRemovedRoles(
    expected: SnapshotAssumedRole[],
    actual: SnapshotAssumedRole[],
  ): SnapshotAssumedRole[] {
    const actualArns = new Set(actual.map(r => r.roleArn));
    return expected.filter(r => !actualArns.has(r.roleArn));
  }

  /**
   * Finds actions that are in actual but not in expected.
   */
  private findNewActions(
    expected: SnapshotAction[],
    actual: SnapshotAction[],
  ): SnapshotAction[] {
    const expectedKeys = new Set(expected.map(a => this.actionKey(a)));
    return actual.filter(a => !expectedKeys.has(this.actionKey(a)));
  }

  /**
   * Finds actions that are in expected but not in actual.
   */
  private findRemovedActions(
    expected: SnapshotAction[],
    actual: SnapshotAction[],
  ): SnapshotAction[] {
    const actualKeys = new Set(actual.map(a => this.actionKey(a)));
    return expected.filter(a => !actualKeys.has(this.actionKey(a)));
  }

  /**
   * Creates a unique key for an action for comparison purposes.
   */
  private actionKey(action: SnapshotAction): string {
    return `${action.service}:${action.action}:${action.region || ''}`;
  }

  /**
   * Creates a SnapshotComparator from JSON data.
   *
   * @param expectedJson - The expected snapshot as JSON
   * @param actualJson - The actual snapshot as JSON
   * @returns A new SnapshotComparator instance
   */
  public static fromJSON(
    expectedJson: SnapshotData,
    actualJson: SnapshotData,
  ): SnapshotComparator {
    const expected = PermissionsSnapshot.fromJSON(expectedJson);
    const actual = PermissionsSnapshot.fromJSON(actualJson);
    return new SnapshotComparator(expected, actual);
  }
}
