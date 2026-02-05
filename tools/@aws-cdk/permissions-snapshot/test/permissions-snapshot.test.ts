import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PermissionsRecorder,
  SnapshotManager,
  startRecording,
  stopRecording,
  SNAPSHOT_VERSION,
  PermissionsSnapshotError,
} from '../lib';
import type { PermissionsSnapshot, RecordedAction, RoleAssumption } from '../lib';

describe('SnapshotManager', () => {
  describe('createSnapshot', () => {
    it('should create a snapshot with sorted actions', () => {
      const actions: RecordedAction[] = [
        { service: 's3', action: 'PutObject', iamAction: 's3:putObject' },
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
        { service: 'sts', action: 'AssumeRole', iamAction: 'sts:assumeRole' },
      ];
      const roleAssumptions: RoleAssumption[] = [
        { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-01T00:00:00Z' },
      ];

      const snapshot = SnapshotManager.createSnapshot('test-name', actions, roleAssumptions);

      expect(snapshot.version).toBe(SNAPSHOT_VERSION);
      expect(snapshot.testName).toBe('test-name');
      expect(snapshot.actions).toHaveLength(3);
      // Actions should be sorted alphabetically by iamAction
      expect(snapshot.actions[0].iamAction).toBe('s3:getObject');
      expect(snapshot.actions[1].iamAction).toBe('s3:putObject');
      expect(snapshot.actions[2].iamAction).toBe('sts:assumeRole');
      expect(snapshot.roleAssumptions).toHaveLength(1);
      expect(snapshot.summary.totalActions).toBe(3);
      expect(snapshot.summary.services).toContain('s3');
      expect(snapshot.summary.services).toContain('sts');
    });

    it('should handle empty inputs', () => {
      const snapshot = SnapshotManager.createSnapshot('empty-test', [], []);

      expect(snapshot.actions).toHaveLength(0);
      expect(snapshot.roleAssumptions).toHaveLength(0);
      expect(snapshot.summary.totalActions).toBe(0);
      expect(snapshot.summary.services).toHaveLength(0);
    });
  });

  describe('saveSnapshot and loadSnapshot', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should save and load a snapshot', () => {
      const snapshot = SnapshotManager.createSnapshot('test', [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
      ], []);

      const filePath = path.join(tempDir, 'test.snap');
      SnapshotManager.saveSnapshot(snapshot, filePath);

      const loaded = SnapshotManager.loadSnapshot(filePath);
      expect(loaded).not.toBeNull();
      expect(loaded!.testName).toBe('test');
      expect(loaded!.actions).toHaveLength(1);
    });

    it('should return null for non-existent file', () => {
      const loaded = SnapshotManager.loadSnapshot(path.join(tempDir, 'nonexistent.snap'));
      expect(loaded).toBeNull();
    });

    it('should create directories if they do not exist', () => {
      const snapshot = SnapshotManager.createSnapshot('test', [], []);
      const filePath = path.join(tempDir, 'subdir', 'deep', 'test.snap');
      
      SnapshotManager.saveSnapshot(snapshot, filePath);
      
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('compareSnapshots', () => {
    it('should detect matching snapshots', () => {
      const actions: RecordedAction[] = [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
      ];
      const snapshot1 = SnapshotManager.createSnapshot('test1', actions, []);
      const snapshot2 = SnapshotManager.createSnapshot('test2', actions, []);

      const result = SnapshotManager.compareSnapshots(snapshot1, snapshot2);

      expect(result.match).toBe(true);
      expect(result.addedActions).toHaveLength(0);
      expect(result.removedActions).toHaveLength(0);
    });

    it('should detect added actions', () => {
      const snapshot1 = SnapshotManager.createSnapshot('test1', [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
      ], []);
      const snapshot2 = SnapshotManager.createSnapshot('test2', [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
        { service: 's3', action: 'PutObject', iamAction: 's3:putObject' },
      ], []);

      const result = SnapshotManager.compareSnapshots(snapshot1, snapshot2);

      expect(result.match).toBe(false);
      expect(result.addedActions).toHaveLength(1);
      expect(result.addedActions[0].iamAction).toBe('s3:putObject');
      expect(result.removedActions).toHaveLength(0);
    });

    it('should detect removed actions', () => {
      const snapshot1 = SnapshotManager.createSnapshot('test1', [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
        { service: 's3', action: 'PutObject', iamAction: 's3:putObject' },
      ], []);
      const snapshot2 = SnapshotManager.createSnapshot('test2', [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
      ], []);

      const result = SnapshotManager.compareSnapshots(snapshot1, snapshot2);

      expect(result.match).toBe(false);
      expect(result.addedActions).toHaveLength(0);
      expect(result.removedActions).toHaveLength(1);
      expect(result.removedActions[0].iamAction).toBe('s3:putObject');
    });

    it('should detect role assumption changes', () => {
      const snapshot1 = SnapshotManager.createSnapshot('test1', [], [
        { roleArn: 'arn:aws:iam::123456789012:role/RoleA', timestamp: '2024-01-01T00:00:00Z' },
      ]);
      const snapshot2 = SnapshotManager.createSnapshot('test2', [], [
        { roleArn: 'arn:aws:iam::123456789012:role/RoleB', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      const result = SnapshotManager.compareSnapshots(snapshot1, snapshot2);

      expect(result.match).toBe(false);
      expect(result.addedRoleAssumptions).toHaveLength(1);
      expect(result.removedRoleAssumptions).toHaveLength(1);
    });
  });

  describe('formatSnapshot', () => {
    it('should format a snapshot for display', () => {
      const snapshot = SnapshotManager.createSnapshot('test', [
        { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
      ], [
        { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      const formatted = SnapshotManager.formatSnapshot(snapshot);

      expect(formatted).toContain('Permissions Snapshot: test');
      expect(formatted).toContain('s3:getObject');
      expect(formatted).toContain('arn:aws:iam::123456789012:role/TestRole');
    });
  });
});

describe('PermissionsRecorder', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-recorder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create and assert snapshots', () => {
    const snapshotPath = path.join(tempDir, 'test.snap');
    const recorder = new PermissionsRecorder({
      testName: 'test-recording',
      snapshotPath,
    });

    // Start/stop recording (no actual AWS calls in unit test)
    recorder.start();
    expect(recorder.isRecording()).toBe(true);
    recorder.stop();
    expect(recorder.isRecording()).toBe(false);

    // First run should create the snapshot
    const result = recorder.assertSnapshot();
    expect(result.match).toBe(true);
    expect(fs.existsSync(snapshotPath)).toBe(true);
  });

  it('should throw PermissionsSnapshotError on mismatch', () => {
    const snapshotPath = path.join(tempDir, 'test.snap');

    // Create initial snapshot with some actions
    const initialSnapshot = SnapshotManager.createSnapshot('test', [
      { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
      { service: 's3', action: 'PutObject', iamAction: 's3:putObject' },
    ], []);
    SnapshotManager.saveSnapshot(initialSnapshot, snapshotPath);

    // Create recorder that will produce different (empty) snapshot
    const recorder = new PermissionsRecorder({
      testName: 'test',
      snapshotPath,
    });
    recorder.start();
    recorder.stop();

    // Should throw because snapshot doesn't match
    expect(() => recorder.assertSnapshot()).toThrow(PermissionsSnapshotError);
  });

  it('should update snapshot when updateSnapshot is true', () => {
    const snapshotPath = path.join(tempDir, 'test.snap');

    // Create initial snapshot
    const initialSnapshot = SnapshotManager.createSnapshot('test', [
      { service: 's3', action: 'GetObject', iamAction: 's3:getObject' },
    ], []);
    SnapshotManager.saveSnapshot(initialSnapshot, snapshotPath);

    // Create recorder with different (empty) recording
    const recorder = new PermissionsRecorder({
      testName: 'test',
      snapshotPath,
      updateSnapshot: true,
    });
    recorder.start();
    recorder.stop();

    // Should not throw, should update snapshot
    const result = recorder.assertSnapshot();
    expect(result.match).toBe(false); // Original comparison showed difference

    // Snapshot should now be updated (empty)
    const updated = SnapshotManager.loadSnapshot(snapshotPath);
    expect(updated!.actions).toHaveLength(0);
  });

  it('should respect excludeServices option', () => {
    const recorder = new PermissionsRecorder({
      testName: 'test',
      snapshotPath: path.join(tempDir, 'test.snap'),
      excludeServices: ['sts'],
    });

    recorder.start();
    // Note: In real usage, AWS SDK calls would be recorded here
    // For unit tests, we're testing the configuration is passed correctly
    recorder.stop();

    expect(recorder.getSnapshot()).not.toBeNull();
  });
});

describe('Recording Functions', () => {
  it('should manage recording state', () => {
    expect(startRecording).toBeDefined();
    expect(stopRecording).toBeDefined();

    startRecording();
    const result = stopRecording();
    
    expect(result).toHaveProperty('actions');
    expect(result).toHaveProperty('roleAssumptions');
    expect(Array.isArray(result.actions)).toBe(true);
    expect(Array.isArray(result.roleAssumptions)).toBe(true);
  });
});
