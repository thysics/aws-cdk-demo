import * as fs from 'fs';
import * as path from 'path';
import type {
  PermissionsSnapshot,
  RecordedAction,
  RoleAssumption,
  SnapshotComparisonResult,
  PermissionsSummary,
} from './types';

/**
 * Current version of the snapshot format
 */
export const SNAPSHOT_VERSION = '1.0.0';

/**
 * Default file extension for snapshot files
 */
export const SNAPSHOT_EXTENSION = '.permissions.snap';

/**
 * Manager for creating, loading, saving, and comparing permission snapshots
 */
export class SnapshotManager {
  /**
   * Create a new permissions snapshot from recorded data
   */
  static createSnapshot(
    testName: string,
    actions: RecordedAction[],
    roleAssumptions: RoleAssumption[],
  ): PermissionsSnapshot {
    // Sort actions for deterministic output
    const sortedActions = [...actions].sort((a, b) => {
      const actionCompare = a.iamAction.localeCompare(b.iamAction);
      if (actionCompare !== 0) return actionCompare;
      
      // If actions are the same, sort by resources
      const aResources = a.resources?.join(',') || '';
      const bResources = b.resources?.join(',') || '';
      return aResources.localeCompare(bResources);
    });

    // Calculate summary
    const services = [...new Set(actions.map(a => a.service))].sort();
    const summary: PermissionsSummary = {
      totalActions: sortedActions.length,
      totalRoleAssumptions: roleAssumptions.length,
      services,
    };

    return {
      version: SNAPSHOT_VERSION,
      testName,
      timestamp: new Date().toISOString(),
      actions: sortedActions,
      roleAssumptions,
      summary,
    };
  }

  /**
   * Load a snapshot from a file
   */
  static loadSnapshot(filePath: string): PermissionsSnapshot | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as PermissionsSnapshot;
    } catch (error) {
      console.error(`Failed to load snapshot from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Save a snapshot to a file
   */
  static saveSnapshot(snapshot: PermissionsSnapshot, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const content = JSON.stringify(snapshot, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Get the default snapshot path for a test
   */
  static getDefaultSnapshotPath(testName: string, baseDir?: string): string {
    const sanitizedName = testName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const dir = baseDir || process.cwd();
    return path.join(dir, `${sanitizedName}${SNAPSHOT_EXTENSION}`);
  }

  /**
   * Compare two snapshots and return the differences
   */
  static compareSnapshots(
    baseline: PermissionsSnapshot,
    current: PermissionsSnapshot,
  ): SnapshotComparisonResult {
    // Create sets of action keys for comparison
    const baselineActionKeys = new Set(
      baseline.actions.map(a => this.actionToKey(a))
    );
    const currentActionKeys = new Set(
      current.actions.map(a => this.actionToKey(a))
    );

    // Find added actions
    const addedActions = current.actions.filter(
      a => !baselineActionKeys.has(this.actionToKey(a))
    );

    // Find removed actions
    const removedActions = baseline.actions.filter(
      a => !currentActionKeys.has(this.actionToKey(a))
    );

    // Create sets of role assumption keys for comparison
    const baselineRoleKeys = new Set(
      baseline.roleAssumptions.map(r => r.roleArn)
    );
    const currentRoleKeys = new Set(
      current.roleAssumptions.map(r => r.roleArn)
    );

    // Find added role assumptions
    const addedRoleAssumptions = current.roleAssumptions.filter(
      r => !baselineRoleKeys.has(r.roleArn)
    );

    // Find removed role assumptions
    const removedRoleAssumptions = baseline.roleAssumptions.filter(
      r => !currentRoleKeys.has(r.roleArn)
    );

    // Check if snapshots match
    const match = addedActions.length === 0 &&
                  removedActions.length === 0 &&
                  addedRoleAssumptions.length === 0 &&
                  removedRoleAssumptions.length === 0;

    // Generate diff message
    const diffMessage = this.generateDiffMessage({
      addedActions,
      removedActions,
      addedRoleAssumptions,
      removedRoleAssumptions,
    });

    return {
      match,
      addedActions,
      removedActions,
      addedRoleAssumptions,
      removedRoleAssumptions,
      diffMessage,
    };
  }

  /**
   * Create a unique key for an action (for comparison purposes)
   */
  private static actionToKey(action: RecordedAction): string {
    const resourcesPart = action.resources?.sort().join(',') || '';
    return `${action.iamAction}${resourcesPart ? ':' + resourcesPart : ''}`;
  }

  /**
   * Generate a human-readable diff message
   */
  private static generateDiffMessage(diff: {
    addedActions: RecordedAction[];
    removedActions: RecordedAction[];
    addedRoleAssumptions: RoleAssumption[];
    removedRoleAssumptions: RoleAssumption[];
  }): string {
    const lines: string[] = [];

    if (diff.addedActions.length > 0) {
      lines.push('Added IAM Actions:');
      for (const action of diff.addedActions) {
        lines.push(`  + ${action.iamAction}`);
        if (action.resources?.length) {
          lines.push(`    Resources: ${action.resources.join(', ')}`);
        }
      }
    }

    if (diff.removedActions.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Removed IAM Actions:');
      for (const action of diff.removedActions) {
        lines.push(`  - ${action.iamAction}`);
        if (action.resources?.length) {
          lines.push(`    Resources: ${action.resources.join(', ')}`);
        }
      }
    }

    if (diff.addedRoleAssumptions.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Added Role Assumptions:');
      for (const role of diff.addedRoleAssumptions) {
        lines.push(`  + ${role.roleArn}`);
        if (role.sessionName) {
          lines.push(`    Session: ${role.sessionName}`);
        }
      }
    }

    if (diff.removedRoleAssumptions.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Removed Role Assumptions:');
      for (const role of diff.removedRoleAssumptions) {
        lines.push(`  - ${role.roleArn}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : 'No changes detected';
  }

  /**
   * Format a snapshot as a human-readable string
   */
  static formatSnapshot(snapshot: PermissionsSnapshot): string {
    const lines: string[] = [
      `Permissions Snapshot: ${snapshot.testName}`,
      `Version: ${snapshot.version}`,
      `Generated: ${snapshot.timestamp}`,
      '',
      `Summary:`,
      `  Total Actions: ${snapshot.summary.totalActions}`,
      `  Total Role Assumptions: ${snapshot.summary.totalRoleAssumptions}`,
      `  Services: ${snapshot.summary.services.join(', ')}`,
      '',
      'IAM Actions:',
    ];

    for (const action of snapshot.actions) {
      lines.push(`  - ${action.iamAction}`);
      if (action.resources?.length) {
        lines.push(`    Resources: ${action.resources.join(', ')}`);
      }
    }

    if (snapshot.roleAssumptions.length > 0) {
      lines.push('');
      lines.push('Role Assumptions:');
      for (const role of snapshot.roleAssumptions) {
        lines.push(`  - ${role.roleArn}`);
        if (role.sessionName) {
          lines.push(`    Session: ${role.sessionName}`);
        }
      }
    }

    return lines.join('\n');
  }
}
