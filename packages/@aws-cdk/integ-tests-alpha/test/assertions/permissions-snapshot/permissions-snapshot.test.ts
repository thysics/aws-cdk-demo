import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PermissionsSnapshotManager,
  PERMISSIONS_SNAPSHOT_FILENAME,
  isPermissionsSnapshotEnabled,
  isSnapshotUpdateEnabled,
} from '../../lib/assertions/permissions-snapshot/permissions-snapshot';
import type { PermissionsSnapshot } from '../../lib/assertions/permissions-snapshot/types';

describe('PermissionsSnapshotManager', () => {
  let manager: PermissionsSnapshotManager;
  let tempDir: string;

  beforeEach(() => {
    manager = new PermissionsSnapshotManager({ enabled: true });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('saveSnapshot', () => {
    test('should save snapshot to disk', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '2024-01-01T00:00:00.000Z',
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole' },
        ],
        actionSummary: ['s3:GetObject', 's3:PutObject'],
      };

      manager.saveSnapshot(snapshot, tempDir);

      const filePath = path.join(tempDir, PERMISSIONS_SNAPSHOT_FILENAME);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.version).toBe('1.0.0');
      expect(content.testName).toBe('test-case');
      expect(content.actions).toHaveLength(2);
      expect(content.roleAssumptions).toHaveLength(1);
    });

    test('should create directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'snapshot');
      const snapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '2024-01-01T00:00:00.000Z',
        actions: [],
        roleAssumptions: [],
        actionSummary: [],
      };

      manager.saveSnapshot(snapshot, nestedDir);

      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    test('should remove timestamps from saved snapshot', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '2024-01-01T00:00:00.000Z',
        actions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-01T00:00:01.000Z' },
        ],
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-01T00:00:02.000Z' },
        ],
        actionSummary: ['s3:GetObject'],
      };

      manager.saveSnapshot(snapshot, tempDir);

      const filePath = path.join(tempDir, PERMISSIONS_SNAPSHOT_FILENAME);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Main timestamp should be empty string
      expect(content.timestamp).toBe('');
      // Action timestamp should be undefined
      expect(content.actions[0].timestamp).toBeUndefined();
      // Role assumption timestamp should be undefined
      expect(content.roleAssumptions[0].timestamp).toBeUndefined();
    });
  });

  describe('loadSnapshot', () => {
    test('should load snapshot from disk', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [
          { service: 's3', action: 'GetObject' },
        ],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject'],
      };

      const filePath = path.join(tempDir, PERMISSIONS_SNAPSHOT_FILENAME);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      const loaded = manager.loadSnapshot(tempDir);

      expect(loaded).toBeDefined();
      expect(loaded!.testName).toBe('test-case');
      expect(loaded!.actions).toHaveLength(1);
    });

    test('should return undefined if snapshot does not exist', () => {
      const loaded = manager.loadSnapshot(tempDir);
      expect(loaded).toBeUndefined();
    });

    test('should handle invalid JSON gracefully', () => {
      const filePath = path.join(tempDir, PERMISSIONS_SNAPSHOT_FILENAME);
      fs.writeFileSync(filePath, 'invalid json');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const loaded = manager.loadSnapshot(tempDir);

      expect(loaded).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('compareSnapshots', () => {
    test('should detect no differences for identical snapshots', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [
          { service: 's3', action: 'GetObject' },
        ],
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole' },
        ],
        actionSummary: ['s3:GetObject'],
      };

      const diff = manager.compareSnapshots(snapshot, snapshot);

      expect(diff.hasDifferences).toBe(false);
      expect(diff.addedActions).toHaveLength(0);
      expect(diff.removedActions).toHaveLength(0);
      expect(diff.addedRoleAssumptions).toHaveLength(0);
      expect(diff.removedRoleAssumptions).toHaveLength(0);
    });

    test('should detect added actions', () => {
      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [
          { service: 's3', action: 'GetObject' },
        ],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject'],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        actionSummary: ['s3:GetObject', 's3:PutObject'],
      };

      const diff = manager.compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.addedActions).toHaveLength(1);
      expect(diff.addedActions[0]).toMatchObject({ service: 's3', action: 'PutObject' });
      expect(diff.removedActions).toHaveLength(0);
    });

    test('should detect removed actions', () => {
      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject', 's3:PutObject'],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        actions: [
          { service: 's3', action: 'GetObject' },
        ],
        actionSummary: ['s3:GetObject'],
      };

      const diff = manager.compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.addedActions).toHaveLength(0);
      expect(diff.removedActions).toHaveLength(1);
      expect(diff.removedActions[0]).toMatchObject({ service: 's3', action: 'PutObject' });
    });

    test('should detect added role assumptions', () => {
      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [],
        roleAssumptions: [],
        actionSummary: [],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole' },
        ],
      };

      const diff = manager.compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.addedRoleAssumptions).toHaveLength(1);
      expect(diff.addedRoleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/NewRole');
    });

    test('should detect removed role assumptions', () => {
      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [],
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole' },
        ],
        actionSummary: [],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        roleAssumptions: [],
      };

      const diff = manager.compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.removedRoleAssumptions).toHaveLength(1);
      expect(diff.removedRoleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/OldRole');
    });

    test('should create human-readable summary', () => {
      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [
          { service: 's3', action: 'GetObject' },
        ],
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole' },
        ],
        actionSummary: ['s3:GetObject'],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        actions: [
          { service: 's3', action: 'PutObject' },
        ],
        roleAssumptions: [
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole' },
        ],
        actionSummary: ['s3:PutObject'],
      };

      const diff = manager.compareSnapshots(baseline, current);

      expect(diff.summary).toContain('Added IAM Actions:');
      expect(diff.summary).toContain('s3:PutObject');
      expect(diff.summary).toContain('Removed IAM Actions:');
      expect(diff.summary).toContain('s3:GetObject');
      expect(diff.summary).toContain('Added Role Assumptions:');
      expect(diff.summary).toContain('NewRole');
      expect(diff.summary).toContain('Removed Role Assumptions:');
      expect(diff.summary).toContain('OldRole');
    });
  });

  describe('validateSnapshot', () => {
    test('should create new snapshot if none exists', () => {
      const current: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '2024-01-01T00:00:00.000Z',
        actions: [{ service: 's3', action: 'GetObject' }],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject'],
      };

      const result = manager.validateSnapshot(current, tempDir);

      expect(result.passed).toBe(true);
      expect(fs.existsSync(path.join(tempDir, PERMISSIONS_SNAPSHOT_FILENAME))).toBe(true);
    });

    test('should pass if snapshot matches baseline', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [{ service: 's3', action: 'GetObject' }],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject'],
      };

      // Save baseline
      manager.saveSnapshot(snapshot, tempDir);

      // Validate current
      const result = manager.validateSnapshot(snapshot, tempDir);

      expect(result.passed).toBe(true);
      expect(result.diff).toBeUndefined();
    });

    test('should fail if snapshot has changes', () => {
      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [{ service: 's3', action: 'GetObject' }],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject'],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        actionSummary: ['s3:GetObject', 's3:PutObject'],
      };

      // Save baseline
      manager.saveSnapshot(baseline, tempDir);

      // Validate current
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = manager.validateSnapshot(current, tempDir);
      consoleSpy.mockRestore();

      expect(result.passed).toBe(false);
      expect(result.diff).toBeDefined();
      expect(result.diff!.hasDifferences).toBe(true);
    });

    test('should update snapshot if updateSnapshot is enabled', () => {
      const updateManager = new PermissionsSnapshotManager({
        enabled: true,
        updateSnapshot: true,
      });

      const baseline: PermissionsSnapshot = {
        version: '1.0.0',
        testName: 'test-case',
        timestamp: '',
        actions: [{ service: 's3', action: 'GetObject' }],
        roleAssumptions: [],
        actionSummary: ['s3:GetObject'],
      };

      const current: PermissionsSnapshot = {
        ...baseline,
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        actionSummary: ['s3:GetObject', 's3:PutObject'],
      };

      // Save baseline
      updateManager.saveSnapshot(baseline, tempDir);

      // Validate current (should update)
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = updateManager.validateSnapshot(current, tempDir);
      consoleSpy.mockRestore();

      expect(result.passed).toBe(true);

      // Verify snapshot was updated
      const loaded = updateManager.loadSnapshot(tempDir);
      expect(loaded!.actions).toHaveLength(2);
    });
  });

  describe('isEnabled', () => {
    test('should return false by default', () => {
      const defaultManager = new PermissionsSnapshotManager();
      expect(defaultManager.isEnabled()).toBe(false);
    });

    test('should return true when enabled', () => {
      const enabledManager = new PermissionsSnapshotManager({ enabled: true });
      expect(enabledManager.isEnabled()).toBe(true);
    });
  });
});

describe('environment variable helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isPermissionsSnapshotEnabled', () => {
    test('should return false when not set', () => {
      delete process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT;
      expect(isPermissionsSnapshotEnabled()).toBe(false);
    });

    test('should return true when set to "true"', () => {
      process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT = 'true';
      expect(isPermissionsSnapshotEnabled()).toBe(true);
    });

    test('should return true when set to "1"', () => {
      process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT = '1';
      expect(isPermissionsSnapshotEnabled()).toBe(true);
    });

    test('should return false for other values', () => {
      process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT = 'false';
      expect(isPermissionsSnapshotEnabled()).toBe(false);
    });
  });

  describe('isSnapshotUpdateEnabled', () => {
    test('should return false when not set', () => {
      delete process.env.CDK_INTEG_UPDATE_PERMISSIONS_SNAPSHOT;
      expect(isSnapshotUpdateEnabled()).toBe(false);
    });

    test('should return true when set to "true"', () => {
      process.env.CDK_INTEG_UPDATE_PERMISSIONS_SNAPSHOT = 'true';
      expect(isSnapshotUpdateEnabled()).toBe(true);
    });

    test('should return true when set to "1"', () => {
      process.env.CDK_INTEG_UPDATE_PERMISSIONS_SNAPSHOT = '1';
      expect(isSnapshotUpdateEnabled()).toBe(true);
    });
  });
});
