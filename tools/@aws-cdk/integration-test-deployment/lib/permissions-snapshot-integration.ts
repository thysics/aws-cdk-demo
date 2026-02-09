/**
 * Permissions snapshot integration for CLI integration tests.
 *
 * This module provides functionality to track AWS API calls during
 * integration tests and compare them against baseline snapshots.
 */

import * as path from 'path';
import { STSClient } from '@aws-sdk/client-sts';
import {
  PermissionsTracker,
  writeSnapshot,
  readSnapshotOrNull,
  compareSnapshotFiles,
  formatDiff,
  createSnapshotFile,
  getSnapshotPath,
  SnapshotFile,
  PermissionsSnapshot,
} from '@aws-cdk/permissions-snapshot';

/**
 * Options for permissions snapshot tracking during tests.
 */
export interface PermissionsSnapshotOptions {
  /**
   * Whether permissions tracking is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Whether to update snapshots instead of comparing.
   * @default false
   */
  updateSnapshots?: boolean;

  /**
   * Services to exclude from tracking.
   * @default []
   */
  excludeServices?: string[];

  /**
   * Specific actions to exclude (format: 'service:action').
   * @default []
   */
  excludeActions?: string[];
}

/**
 * Result of a permissions snapshot check.
 */
export interface PermissionsCheckResult {
  /**
   * Whether the check passed (no differences or updated).
   */
  passed: boolean;

  /**
   * Whether the snapshot was updated.
   */
  updated: boolean;

  /**
   * Human-readable message about the result.
   */
  message: string;

  /**
   * Detailed diff if there were differences.
   */
  diff?: string;
}

/**
 * Manages permissions tracking for a single integration test run.
 */
export class PermissionsSnapshotManager {
  private tracker: PermissionsTracker;
  private options: Required<PermissionsSnapshotOptions>;
  private registeredClients: Set<object> = new Set();

  constructor(options: PermissionsSnapshotOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      updateSnapshots: options.updateSnapshots ?? false,
      excludeServices: options.excludeServices ?? [],
      excludeActions: options.excludeActions ?? [],
    };

    this.tracker = PermissionsTracker.getInstance({
      excludeServices: this.options.excludeServices,
      excludeActions: this.options.excludeActions,
    });
  }

  /**
   * Register an AWS SDK client for tracking.
   */
  registerClient(client: object): void {
    if (!this.options.enabled) return;
    this.tracker.registerClient(client);
    this.registeredClients.add(client);
  }

  /**
   * Register an STS client (for convenience).
   */
  registerStsClient(client: STSClient): void {
    this.registerClient(client);
  }

  /**
   * Start tracking permissions.
   */
  start(): void {
    if (!this.options.enabled) return;
    this.tracker.clear();
    this.tracker.start();
  }

  /**
   * Stop tracking permissions.
   */
  stop(): void {
    if (!this.options.enabled) return;
    this.tracker.stop();
  }

  /**
   * Get the recorded permissions snapshot.
   */
  getSnapshot(): PermissionsSnapshot {
    return this.tracker.getRecordedPermissions();
  }

  /**
   * Check the recorded permissions against the baseline snapshot.
   *
   * @param testFilePath - Path to the test file (used to derive snapshot path)
   * @param testName - Name of the test for metadata
   * @returns Result of the check
   */
  async checkSnapshot(
    testFilePath: string,
    testName: string,
  ): Promise<PermissionsCheckResult> {
    if (!this.options.enabled) {
      return {
        passed: true,
        updated: false,
        message: 'Permissions tracking is disabled.',
      };
    }

    const snapshotPath = getSnapshotPath(testFilePath);
    const recorded = this.getSnapshot();
    const currentSnapshot = createSnapshotFile(recorded, testName);

    // Read existing snapshot
    const existingSnapshot = readSnapshotOrNull(snapshotPath);

    // Compare
    const diff = compareSnapshotFiles(existingSnapshot, currentSnapshot);

    if (!diff.hasDifferences) {
      return {
        passed: true,
        updated: false,
        message: 'Permissions snapshot matches.',
      };
    }

    // There are differences
    if (this.options.updateSnapshots) {
      // Update the snapshot
      writeSnapshot(recorded, snapshotPath, {
        testName,
        description: `Updated permissions snapshot for ${testName}`,
      });

      return {
        passed: true,
        updated: true,
        message: `Permissions snapshot updated at ${snapshotPath}`,
        diff: formatDiff(diff),
      };
    }

    // Fail the check
    return {
      passed: false,
      updated: false,
      message: `Permissions snapshot mismatch at ${snapshotPath}`,
      diff: formatDiff(diff),
    };
  }

  /**
   * Clean up and unregister all clients.
   */
  cleanup(): void {
    this.tracker.stop();
    for (const client of this.registeredClients) {
      this.tracker.unregisterClient(client);
    }
    this.registeredClients.clear();
    this.tracker.clear();
  }

  /**
   * Check if tracking is enabled.
   */
  isEnabled(): boolean {
    return this.options.enabled;
  }
}

/**
 * Parse permissions snapshot CLI options from command line arguments.
 *
 * @param args - Command line arguments
 * @returns Parsed options
 */
export function parsePermissionsSnapshotArgs(args: string[]): PermissionsSnapshotOptions {
  const options: PermissionsSnapshotOptions = {
    enabled: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--skip-permissions-snapshot') {
      options.enabled = false;
    } else if (arg === '--update-permissions-snapshot') {
      options.updateSnapshots = true;
    } else if (arg === '--exclude-permission-services') {
      const next = args[++i];
      if (next) {
        options.excludeServices = next.split(',').map(s => s.trim());
      }
    } else if (arg === '--exclude-permission-actions') {
      const next = args[++i];
      if (next) {
        options.excludeActions = next.split(',').map(s => s.trim());
      }
    }
  }

  return options;
}

/**
 * Create a permissions snapshot manager from CLI arguments.
 *
 * @param args - Command line arguments
 * @returns Configured manager
 */
export function createManagerFromArgs(args: string[]): PermissionsSnapshotManager {
  const options = parsePermissionsSnapshotArgs(args);
  return new PermissionsSnapshotManager(options);
}
