import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PermissionsSnapshotRecorder,
  PermissionsSnapshotError,
  compareSnapshots,
  formatComparisonResult,
} from '../lib/permissions-snapshot/snapshot-recorder';
import { getGlobalCollector, resetGlobalCollector } from '../lib/permissions-snapshot/sdk-interceptor';
import type { PermissionsSnapshot, SnapshotComparisonResult } from '../lib/permissions-snapshot/types';

describe('compareSnapshots', () => {
  const baseSnapshot: PermissionsSnapshot = {
    testName: 'test',
    createdAt: '2024-01-01T00:00:00.000Z',
    actions: [
      { service: 's3', action: 'PutObject', timestamp: '2024-01-01T00:00:00.000Z' },
      { service: 's3', action: 'GetObject', timestamp: '2024-01-01T00:00:00.000Z' },
    ],
    roleAssumptions: [
      { roleArn: 'arn:aws:iam::123456789012:role/TestRole', sessionName: 'session', timestamp: '2024-01-01T00:00:00.000Z' },
    ],
    permissions: ['s3:GetObject', 's3:PutObject'],
  };

  test('returns match for identical snapshots', () => {
    const result = compareSnapshots(baseSnapshot, baseSnapshot);
    expect(result.match).toBe(true);
    expect(result.addedActions).toHaveLength(0);
    expect(result.removedActions).toHaveLength(0);
    expect(result.addedRoleAssumptions).toHaveLength(0);
    expect(result.removedRoleAssumptions).toHaveLength(0);
  });

  test('detects added actions', () => {
    const newSnapshot: PermissionsSnapshot = {
      ...baseSnapshot,
      actions: [...baseSnapshot.actions, { service: 'cloudformation', action: 'CreateStack', timestamp: '2024-01-01T00:00:00.000Z' }],
      permissions: [...baseSnapshot.permissions, 'cloudformation:CreateStack'],
    };

    const result = compareSnapshots(newSnapshot, baseSnapshot);
    expect(result.match).toBe(false);
    expect(result.addedActions).toEqual(['cloudformation:CreateStack']);
    expect(result.removedActions).toHaveLength(0);
  });

  test('detects removed actions', () => {
    const newSnapshot: PermissionsSnapshot = {
      ...baseSnapshot,
      actions: [baseSnapshot.actions[0]],
      permissions: ['s3:PutObject'],
    };

    const result = compareSnapshots(newSnapshot, baseSnapshot);
    expect(result.match).toBe(false);
    expect(result.addedActions).toHaveLength(0);
    expect(result.removedActions).toEqual(['s3:GetObject']);
  });

  test('detects added role assumptions', () => {
    const newSnapshot: PermissionsSnapshot = {
      ...baseSnapshot,
      roleAssumptions: [
        ...baseSnapshot.roleAssumptions,
        { roleArn: 'arn:aws:iam::123456789012:role/NewRole', sessionName: 'new-session', timestamp: '2024-01-01T00:00:00.000Z' },
      ],
    };

    const result = compareSnapshots(newSnapshot, baseSnapshot);
    expect(result.match).toBe(false);
    expect(result.addedRoleAssumptions).toHaveLength(1);
    expect(result.addedRoleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/NewRole');
  });

  test('detects removed role assumptions', () => {
    const newSnapshot: PermissionsSnapshot = {
      ...baseSnapshot,
      roleAssumptions: [],
    };

    const result = compareSnapshots(newSnapshot, baseSnapshot);
    expect(result.match).toBe(false);
    expect(result.removedRoleAssumptions).toHaveLength(1);
    expect(result.removedRoleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
  });
});

describe('formatComparisonResult', () => {
  test('formats matching result', () => {
    const result: SnapshotComparisonResult = {
      match: true,
      addedActions: [],
      removedActions: [],
      addedRoleAssumptions: [],
      removedRoleAssumptions: [],
    };

    expect(formatComparisonResult(result)).toBe('Permissions snapshot matches.');
  });

  test('formats mismatching result with all changes', () => {
    const result: SnapshotComparisonResult = {
      match: false,
      addedActions: ['s3:NewAction'],
      removedActions: ['s3:OldAction'],
      addedRoleAssumptions: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole', sessionName: 'new', timestamp: '' }],
      removedRoleAssumptions: [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole', sessionName: 'old', timestamp: '' }],
    };

    const formatted = formatComparisonResult(result);
    expect(formatted).toContain('Permissions snapshot does not match');
    expect(formatted).toContain('+ s3:NewAction');
    expect(formatted).toContain('- s3:OldAction');
    expect(formatted).toContain('+ arn:aws:iam::123456789012:role/NewRole');
    expect(formatted).toContain('- arn:aws:iam::123456789012:role/OldRole');
  });
});

describe('PermissionsSnapshotRecorder', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
    resetGlobalCollector();
  });

  afterEach(() => {
    resetGlobalCollector();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates snapshot file when none exists', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'my-test',
      snapshotDirectory: tempDir,
    });

    recorder.startRecording();
    const collector = getGlobalCollector();
    collector.recordAction('s3', 'PutObject');
    
    const result = recorder.validate();
    
    expect(result.match).toBe(true);
    expect(fs.existsSync(recorder.getSnapshotPath())).toBe(true);
  });

  test('validates matching snapshot', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'my-test',
      snapshotDirectory: tempDir,
    });

    // Create initial snapshot
    recorder.startRecording();
    getGlobalCollector().recordAction('s3', 'PutObject');
    recorder.validate();

    // Validate again with same actions
    recorder.startRecording();
    getGlobalCollector().recordAction('s3', 'PutObject');
    const result = recorder.validate();

    expect(result.match).toBe(true);
  });

  test('detects mismatch and throws by default', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'my-test',
      snapshotDirectory: tempDir,
    });

    // Create initial snapshot
    recorder.startRecording();
    getGlobalCollector().recordAction('s3', 'PutObject');
    recorder.validate();

    // Try to validate with different actions
    recorder.startRecording();
    getGlobalCollector().recordAction('cloudformation', 'CreateStack');

    expect(() => recorder.validate()).toThrow(PermissionsSnapshotError);
  });

  test('updates snapshot when updateSnapshots is true', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'my-test',
      snapshotDirectory: tempDir,
      updateSnapshots: true,
    });

    // Create initial snapshot
    recorder.startRecording();
    getGlobalCollector().recordAction('s3', 'PutObject');
    recorder.validate();

    // Validate with different actions (should update)
    recorder.startRecording();
    getGlobalCollector().recordAction('cloudformation', 'CreateStack');
    const result = recorder.validate();

    expect(result.match).toBe(false);
    
    // Verify snapshot was updated
    const savedSnapshot = recorder.loadSnapshot();
    expect(savedSnapshot?.permissions).toContain('cloudformation:CreateStack');
    expect(savedSnapshot?.permissions).not.toContain('s3:PutObject');
  });

  test('does not throw when failOnMismatch is false', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'my-test',
      snapshotDirectory: tempDir,
      failOnMismatch: false,
    });

    // Create initial snapshot
    recorder.startRecording();
    getGlobalCollector().recordAction('s3', 'PutObject');
    recorder.validate();

    // Validate with different actions (should not throw)
    recorder.startRecording();
    getGlobalCollector().recordAction('cloudformation', 'CreateStack');
    const result = recorder.validate();

    expect(result.match).toBe(false);
    expect(result.addedActions).toContain('cloudformation:CreateStack');
    expect(result.removedActions).toContain('s3:PutObject');
  });

  test('generates permissions document from multiple snapshots', () => {
    // Create multiple snapshots
    const recorder1 = new PermissionsSnapshotRecorder({
      testName: 'test-1',
      snapshotDirectory: tempDir,
    });
    recorder1.startRecording();
    getGlobalCollector().recordAction('s3', 'PutObject');
    recorder1.validate();

    const recorder2 = new PermissionsSnapshotRecorder({
      testName: 'test-2',
      snapshotDirectory: tempDir,
    });
    recorder2.startRecording();
    getGlobalCollector().recordAction('cloudformation', 'CreateStack');
    getGlobalCollector().recordAction('s3', 'GetObject');
    recorder2.validate();

    // Generate document
    const document = PermissionsSnapshotRecorder.generatePermissionsDocument(tempDir);

    expect(document.totalTests).toBe(2);
    expect(document.uniquePermissions).toContain('s3:PutObject');
    expect(document.uniquePermissions).toContain('s3:GetObject');
    expect(document.uniquePermissions).toContain('cloudformation:CreateStack');
    expect(document.permissionsByTest['test-1']).toContain('s3:PutObject');
    expect(document.permissionsByTest['test-2']).toContain('cloudformation:CreateStack');
  });
});

describe('PermissionsSnapshotError', () => {
  test('contains comparison result and snapshots', () => {
    const comparisonResult: SnapshotComparisonResult = {
      match: false,
      addedActions: ['s3:NewAction'],
      removedActions: [],
      addedRoleAssumptions: [],
      removedRoleAssumptions: [],
    };

    const currentSnapshot: PermissionsSnapshot = {
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [],
      roleAssumptions: [],
      permissions: ['s3:NewAction'],
    };

    const expectedSnapshot: PermissionsSnapshot = {
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [],
      roleAssumptions: [],
      permissions: [],
    };

    const error = new PermissionsSnapshotError(
      'Permissions mismatch',
      comparisonResult,
      currentSnapshot,
      expectedSnapshot,
    );

    expect(error.name).toBe('PermissionsSnapshotError');
    expect(error.comparisonResult).toBe(comparisonResult);
    expect(error.currentSnapshot).toBe(currentSnapshot);
    expect(error.expectedSnapshot).toBe(expectedSnapshot);
  });
});
