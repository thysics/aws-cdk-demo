import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PermissionsSnapshotManager,
  PermissionsSnapshotError,
  PERMISSIONS_SNAPSHOT_FILENAME,
} from '../../../lib/permissions-snapshot/permissions-snapshot';
import {
  PermissionsTracker,
} from '../../../lib/permissions-snapshot/permissions-tracker';
import type {
  PermissionsSnapshot,
  RecordedAction,
  RecordedRoleAssumption,
} from '../../../lib/permissions-snapshot/types';
import { PERMISSIONS_SNAPSHOT_VERSION } from '../../../lib/permissions-snapshot/types';

describe('PermissionsSnapshotManager', () => {
  let tempDir: string;

  beforeEach(() => {
    PermissionsTracker.resetInstance();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
  });

  afterEach(() => {
    PermissionsTracker.resetInstance();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createSnapshot', () => {
    it('should create a snapshot with basic structure', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const actions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const roleAssumptions: RecordedRoleAssumption[] = [
        { roleArn: 'arn:aws:iam::123456789012:role/MyRole', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const snapshot = manager.createSnapshot(actions, roleAssumptions);
      
      expect(snapshot.version).toBe(PERMISSIONS_SNAPSHOT_VERSION);
      expect(snapshot.testName).toBe('test-case');
      expect(snapshot.actions).toHaveLength(1);
      expect(snapshot.roleAssumptions).toHaveLength(1);
      expect(snapshot.actionSummary).toHaveLength(1);
    });

    it('should create action summary with counts', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const actions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:01Z' },
        { service: 's3', action: 'GetObject', timestamp: '2024-01-01T00:00:02Z' },
      ];
      
      const snapshot = manager.createSnapshot(actions, []);
      
      expect(snapshot.actionSummary).toHaveLength(2);
      
      const putObjectSummary = snapshot.actionSummary.find(
        a => a.service === 's3' && a.action === 'PutObject'
      );
      expect(putObjectSummary?.count).toBe(2);
      
      const getObjectSummary = snapshot.actionSummary.find(
        a => a.service === 's3' && a.action === 'GetObject'
      );
      expect(getObjectSummary?.count).toBe(1);
    });

    it('should sort actions and summaries consistently', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const actions: RecordedAction[] = [
        { service: 'lambda', action: 'Invoke', timestamp: '2024-01-01T00:00:02Z' },
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
        { service: 'lambda', action: 'CreateFunction', timestamp: '2024-01-01T00:00:01Z' },
      ];
      
      const snapshot = manager.createSnapshot(actions, []);
      
      // Actions should be sorted by service, then action, then timestamp
      expect(snapshot.actions[0].service).toBe('lambda');
      expect(snapshot.actions[0].action).toBe('CreateFunction');
      expect(snapshot.actions[1].service).toBe('lambda');
      expect(snapshot.actions[1].action).toBe('Invoke');
      expect(snapshot.actions[2].service).toBe('s3');
      
      // Summary should be sorted by service, then action
      expect(snapshot.actionSummary[0].service).toBe('lambda');
      expect(snapshot.actionSummary[0].action).toBe('CreateFunction');
      expect(snapshot.actionSummary[1].service).toBe('lambda');
      expect(snapshot.actionSummary[1].action).toBe('Invoke');
    });
  });

  describe('saveSnapshot and loadSnapshot', () => {
    it('should save and load snapshot correctly', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const actions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const roleAssumptions: RecordedRoleAssumption[] = [
        { roleArn: 'arn:aws:iam::123456789012:role/MyRole', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const originalSnapshot = manager.createSnapshot(actions, roleAssumptions);
      manager.saveSnapshot(originalSnapshot, tempDir);
      
      const loadedSnapshot = manager.loadSnapshot(tempDir);
      
      expect(loadedSnapshot).toBeDefined();
      expect(loadedSnapshot?.testName).toBe('test-case');
      expect(loadedSnapshot?.actions).toEqual(originalSnapshot.actions);
      expect(loadedSnapshot?.roleAssumptions).toEqual(originalSnapshot.roleAssumptions);
    });

    it('should create directory if it does not exist', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      const snapshot = manager.createSnapshot([], []);
      
      const nestedDir = path.join(tempDir, 'nested', 'dir');
      manager.saveSnapshot(snapshot, nestedDir);
      
      expect(fs.existsSync(path.join(nestedDir, PERMISSIONS_SNAPSHOT_FILENAME))).toBe(true);
    });

    it('should return undefined for non-existent snapshot', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      const loaded = manager.loadSnapshot(path.join(tempDir, 'nonexistent'));
      expect(loaded).toBeUndefined();
    });
  });

  describe('compareSnapshots', () => {
    it('should report match for identical snapshots', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const actions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const snapshot1 = manager.createSnapshot(actions, []);
      const snapshot2 = manager.createSnapshot(actions, []);
      
      const result = manager.compareSnapshots(snapshot1, snapshot2);
      
      expect(result.matches).toBe(true);
      expect(result.addedActions).toHaveLength(0);
      expect(result.removedActions).toHaveLength(0);
    });

    it('should detect added actions', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const baselineActions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const currentActions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
        { service: 's3', action: 'DeleteObject', timestamp: '2024-01-01T00:00:01Z' },
      ];
      
      const baseline = manager.createSnapshot(baselineActions, []);
      const current = manager.createSnapshot(currentActions, []);
      
      const result = manager.compareSnapshots(baseline, current);
      
      expect(result.matches).toBe(false);
      expect(result.addedActions).toHaveLength(1);
      expect(result.addedActions[0].action).toBe('DeleteObject');
    });

    it('should detect removed actions', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const baselineActions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
        { service: 's3', action: 'DeleteObject', timestamp: '2024-01-01T00:00:01Z' },
      ];
      
      const currentActions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const baseline = manager.createSnapshot(baselineActions, []);
      const current = manager.createSnapshot(currentActions, []);
      
      const result = manager.compareSnapshots(baseline, current);
      
      expect(result.matches).toBe(false);
      expect(result.removedActions).toHaveLength(1);
      expect(result.removedActions[0].action).toBe('DeleteObject');
    });

    it('should detect added role assumptions', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const baselineRoles: RecordedRoleAssumption[] = [];
      
      const currentRoles: RecordedRoleAssumption[] = [
        { roleArn: 'arn:aws:iam::123456789012:role/NewRole', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const baseline = manager.createSnapshot([], baselineRoles);
      const current = manager.createSnapshot([], currentRoles);
      
      const result = manager.compareSnapshots(baseline, current);
      
      expect(result.matches).toBe(false);
      expect(result.addedRoleAssumptions).toHaveLength(1);
      expect(result.addedRoleAssumptions[0].roleArn).toContain('NewRole');
    });

    it('should detect removed role assumptions', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const baselineRoles: RecordedRoleAssumption[] = [
        { roleArn: 'arn:aws:iam::123456789012:role/OldRole', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const currentRoles: RecordedRoleAssumption[] = [];
      
      const baseline = manager.createSnapshot([], baselineRoles);
      const current = manager.createSnapshot([], currentRoles);
      
      const result = manager.compareSnapshots(baseline, current);
      
      expect(result.matches).toBe(false);
      expect(result.removedRoleAssumptions).toHaveLength(1);
      expect(result.removedRoleAssumptions[0].roleArn).toContain('OldRole');
    });

    it('should include diff message when there are changes', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      
      const baselineActions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const currentActions: RecordedAction[] = [
        { service: 's3', action: 'DeleteObject', timestamp: '2024-01-01T00:00:00Z' },
      ];
      
      const baseline = manager.createSnapshot(baselineActions, []);
      const current = manager.createSnapshot(currentActions, []);
      
      const result = manager.compareSnapshots(baseline, current);
      
      expect(result.diffMessage).toBeDefined();
      expect(result.diffMessage).toContain('Added IAM Actions');
      expect(result.diffMessage).toContain('Removed IAM Actions');
    });
  });

  describe('validateAgainstSnapshot', () => {
    it('should create new snapshot when none exists', () => {
      const manager = new PermissionsSnapshotManager('test-case');
      manager.startRecording();
      
      const tracker = PermissionsTracker.getInstance();
      tracker.recordAction('s3', 'PutObject');
      
      const result = manager.validateAgainstSnapshot(tempDir);
      
      expect(result.matches).toBe(true);
      expect(fs.existsSync(path.join(tempDir, PERMISSIONS_SNAPSHOT_FILENAME))).toBe(true);
    });

    it('should throw when snapshot changes and failOnChange is true', () => {
      const manager = new PermissionsSnapshotManager('test-case', { failOnChange: true });
      
      // Create initial snapshot
      const initialSnapshot: PermissionsSnapshot = {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        testName: 'test-case',
        createdAt: '2024-01-01T00:00:00Z',
        actions: [{ service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' }],
        roleAssumptions: [],
        actionSummary: [{ service: 's3', action: 'PutObject', count: 1 }],
      };
      manager.saveSnapshot(initialSnapshot, tempDir);
      
      // Record different action
      manager.startRecording();
      const tracker = PermissionsTracker.getInstance();
      tracker.recordAction('s3', 'DeleteObject');
      
      expect(() => manager.validateAgainstSnapshot(tempDir)).toThrow(PermissionsSnapshotError);
    });

    it('should update snapshot when updateSnapshot is true', () => {
      const manager = new PermissionsSnapshotManager('test-case', { 
        failOnChange: true,
        updateSnapshot: true,
      });
      
      // Create initial snapshot
      const initialSnapshot: PermissionsSnapshot = {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        testName: 'test-case',
        createdAt: '2024-01-01T00:00:00Z',
        actions: [{ service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' }],
        roleAssumptions: [],
        actionSummary: [{ service: 's3', action: 'PutObject', count: 1 }],
      };
      manager.saveSnapshot(initialSnapshot, tempDir);
      
      // Record different action
      manager.startRecording();
      const tracker = PermissionsTracker.getInstance();
      tracker.recordAction('s3', 'DeleteObject');
      
      const result = manager.validateAgainstSnapshot(tempDir);
      
      expect(result.matches).toBe(true); // matches because we updated
      
      // Verify the snapshot was updated
      const updatedSnapshot = manager.loadSnapshot(tempDir);
      expect(updatedSnapshot?.actionSummary.find(a => a.action === 'DeleteObject')).toBeDefined();
    });

    it('should not throw when failOnChange is false', () => {
      const manager = new PermissionsSnapshotManager('test-case', { failOnChange: false });
      
      // Create initial snapshot
      const initialSnapshot: PermissionsSnapshot = {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        testName: 'test-case',
        createdAt: '2024-01-01T00:00:00Z',
        actions: [{ service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00Z' }],
        roleAssumptions: [],
        actionSummary: [{ service: 's3', action: 'PutObject', count: 1 }],
      };
      manager.saveSnapshot(initialSnapshot, tempDir);
      
      // Record different action
      manager.startRecording();
      const tracker = PermissionsTracker.getInstance();
      tracker.recordAction('s3', 'DeleteObject');
      
      const result = manager.validateAgainstSnapshot(tempDir);
      
      expect(result.matches).toBe(false);
      expect(result.addedActions).toHaveLength(1);
    });
  });
});

describe('PermissionsSnapshotError', () => {
  it('should include comparison result', () => {
    const result = {
      matches: false,
      addedActions: [{ service: 's3', action: 'NewAction', timestamp: '2024-01-01T00:00:00Z' }],
      removedActions: [],
      addedRoleAssumptions: [],
      removedRoleAssumptions: [],
    };
    
    const error = new PermissionsSnapshotError('Test error', result);
    
    expect(error.name).toBe('PermissionsSnapshotError');
    expect(error.message).toBe('Test error');
    expect(error.comparisonResult).toBe(result);
  });
});
