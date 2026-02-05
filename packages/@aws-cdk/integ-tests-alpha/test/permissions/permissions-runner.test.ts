import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionsRunner } from '../../lib/permissions/permissions-runner';
import { PermissionsTracker } from '../../lib/permissions/permissions-tracker';
import { PermissionsSnapshotWriter } from '../../lib/permissions/snapshot-writer';
import type { PermissionsSnapshot } from '../../lib/permissions/types';

describe('PermissionsRunner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-permissions-runner-test-'));
    // Reset the tracker instance before each test
    PermissionsTracker.resetInstance();
  });

  afterEach(() => {
    // Ensure tracking is stopped
    PermissionsRunner.stopTracking();
    deleteFolderRecursive(tmpDir);
  });

  describe('setupTracking', () => {
    test('starts tracking with the given test name', () => {
      PermissionsRunner.setupTracking('my-test');

      expect(PermissionsRunner.isTrackingActive()).toBe(true);
      expect(PermissionsTracker.getInstance().getTestName()).toBe('my-test');
    });

    test('can be called multiple times to track different tests', () => {
      PermissionsRunner.setupTracking('test-1');
      expect(PermissionsTracker.getInstance().getTestName()).toBe('test-1');

      PermissionsRunner.setupTracking('test-2');
      expect(PermissionsTracker.getInstance().getTestName()).toBe('test-2');
    });

    test('handles errors gracefully', () => {
      // Even if there's an issue, it should not throw
      expect(() => PermissionsRunner.setupTracking('test')).not.toThrow();
    });
  });

  describe('finalizeTracking', () => {
    test('creates initial snapshot when none exists', () => {
      PermissionsRunner.setupTracking('new-test');

      const result = PermissionsRunner.finalizeTracking(tmpDir);

      expect(result.success).toBe(true);
      expect(result.snapshotUpdated).toBe(true);
      expect(result.message).toContain('Initial permissions snapshot created');

      // Verify snapshot file was created
      const snapshotFile = path.join(tmpDir, 'permissions.snapshot.json');
      expect(fs.existsSync(snapshotFile)).toBe(true);
    });

    test('returns success when snapshot matches', () => {
      // Setup and finalize to create initial snapshot
      PermissionsRunner.setupTracking('matching-test');
      PermissionsRunner.finalizeTracking(tmpDir);

      // Run again - should match
      PermissionsRunner.setupTracking('matching-test');
      const result = PermissionsRunner.finalizeTracking(tmpDir);

      expect(result.success).toBe(true);
      expect(result.snapshotUpdated).toBe(false);
      expect(result.message).toBe('Permissions snapshot matches expected.');
    });

    test('returns failure when snapshot differs', () => {
      // Create initial snapshot
      const existingSnapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'diff-test',
        capturedAt: '2024-01-15T10:00:00.000Z',
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      };
      PermissionsSnapshotWriter.write(existingSnapshot, tmpDir);

      // Run test that produces different permissions
      PermissionsRunner.setupTracking('diff-test');
      // The new snapshot will be empty (no SDK calls tracked)

      const result = PermissionsRunner.finalizeTracking(tmpDir);

      expect(result.success).toBe(false);
      expect(result.snapshotUpdated).toBe(false);
      expect(result.diff).toBeDefined();
      expect(result.diff!.hasChanges).toBe(true);
      expect(result.diff!.removedRoles).toContain('arn:aws:iam::123456789012:role/OldRole');
      expect(result.diff!.removedActions).toContain('s3:GetObject');
    });

    test('updates snapshot in update mode', () => {
      // Create initial snapshot
      const existingSnapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'update-test',
        capturedAt: '2024-01-15T10:00:00.000Z',
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [],
      };
      PermissionsSnapshotWriter.write(existingSnapshot, tmpDir);

      // Run with update mode
      PermissionsRunner.setupTracking('update-test');
      const result = PermissionsRunner.finalizeTracking(tmpDir, { updateSnapshots: true });

      expect(result.success).toBe(true);
      expect(result.snapshotUpdated).toBe(true);
      expect(result.message).toContain('Permissions snapshot updated');

      // Verify snapshot was updated (old role should be gone)
      const updated = PermissionsSnapshotWriter.read(tmpDir);
      expect(updated).toBeDefined();
      expect(updated!.assumedRoles).toHaveLength(0);
    });

    test('stops tracking after finalization', () => {
      PermissionsRunner.setupTracking('test');
      expect(PermissionsRunner.isTrackingActive()).toBe(true);

      PermissionsRunner.finalizeTracking(tmpDir);

      expect(PermissionsRunner.isTrackingActive()).toBe(false);
    });

    test('resets tracker for next test', () => {
      PermissionsRunner.setupTracking('first-test');
      PermissionsRunner.finalizeTracking(tmpDir);

      // Should be able to start fresh
      PermissionsRunner.setupTracking('second-test');
      expect(PermissionsTracker.getInstance().getTestName()).toBe('second-test');
    });

    test('handles errors gracefully and returns success', () => {
      // Don't setup tracking - finalize on non-tracking state should still work
      const result = PermissionsRunner.finalizeTracking(tmpDir);

      // Should not fail the test
      expect(result.success).toBe(true);
    });
  });

  describe('isTrackingActive', () => {
    test('returns false when not tracking', () => {
      expect(PermissionsRunner.isTrackingActive()).toBe(false);
    });

    test('returns true when tracking', () => {
      PermissionsRunner.setupTracking('test');
      expect(PermissionsRunner.isTrackingActive()).toBe(true);
    });

    test('returns false after stopping', () => {
      PermissionsRunner.setupTracking('test');
      PermissionsRunner.stopTracking();
      expect(PermissionsRunner.isTrackingActive()).toBe(false);
    });
  });

  describe('stopTracking', () => {
    test('stops active tracking', () => {
      PermissionsRunner.setupTracking('test');
      PermissionsRunner.stopTracking();

      expect(PermissionsRunner.isTrackingActive()).toBe(false);
    });

    test('handles being called when not tracking', () => {
      // Should not throw
      expect(() => PermissionsRunner.stopTracking()).not.toThrow();
    });

    test('resets tracker state', () => {
      PermissionsRunner.setupTracking('test');
      PermissionsRunner.stopTracking();

      // Should be able to start fresh
      PermissionsRunner.setupTracking('new-test');
      expect(PermissionsTracker.getInstance().getTestName()).toBe('new-test');
    });
  });

  describe('getMiddlewarePlugin', () => {
    test('returns undefined when not tracking', () => {
      const plugin = PermissionsRunner.getMiddlewarePlugin();
      expect(plugin).toBeUndefined();
    });

    test('returns plugin when tracking is active', () => {
      PermissionsRunner.setupTracking('test');
      const plugin = PermissionsRunner.getMiddlewarePlugin();

      expect(plugin).toBeDefined();
      expect(typeof plugin!.applyToStack).toBe('function');
    });

    test('returns undefined after stopping tracking', () => {
      PermissionsRunner.setupTracking('test');
      PermissionsRunner.stopTracking();

      const plugin = PermissionsRunner.getMiddlewarePlugin();
      expect(plugin).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    test('full workflow: setup, finalize, validate', () => {
      // First run - creates snapshot
      PermissionsRunner.setupTracking('workflow-test');
      const firstResult = PermissionsRunner.finalizeTracking(tmpDir);
      expect(firstResult.success).toBe(true);
      expect(firstResult.snapshotUpdated).toBe(true);

      // Second run - validates against snapshot
      PermissionsRunner.setupTracking('workflow-test');
      const secondResult = PermissionsRunner.finalizeTracking(tmpDir);
      expect(secondResult.success).toBe(true);
      expect(secondResult.snapshotUpdated).toBe(false);
    });

    test('handles test failure scenario (stop without finalize)', () => {
      PermissionsRunner.setupTracking('failing-test');

      // Simulate test failure - stop without finalize
      PermissionsRunner.stopTracking();

      // Should be able to start new test
      PermissionsRunner.setupTracking('next-test');
      expect(PermissionsRunner.isTrackingActive()).toBe(true);
      expect(PermissionsTracker.getInstance().getTestName()).toBe('next-test');
    });

    test('handles multiple sequential tests', () => {
      const snapshotDir1 = path.join(tmpDir, 'test1.snapshot');
      const snapshotDir2 = path.join(tmpDir, 'test2.snapshot');

      // Run first test
      PermissionsRunner.setupTracking('test-1');
      const result1 = PermissionsRunner.finalizeTracking(snapshotDir1);
      expect(result1.success).toBe(true);

      // Run second test
      PermissionsRunner.setupTracking('test-2');
      const result2 = PermissionsRunner.finalizeTracking(snapshotDir2);
      expect(result2.success).toBe(true);

      // Verify both snapshots exist
      expect(fs.existsSync(path.join(snapshotDir1, 'permissions.snapshot.json'))).toBe(true);
      expect(fs.existsSync(path.join(snapshotDir2, 'permissions.snapshot.json'))).toBe(true);
    });
  });
});

// Helper function to clean up temp directories
function deleteFolderRecursive(directoryPath: string) {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath).forEach((file) => {
      const curPath = path.join(directoryPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(directoryPath);
  }
}
