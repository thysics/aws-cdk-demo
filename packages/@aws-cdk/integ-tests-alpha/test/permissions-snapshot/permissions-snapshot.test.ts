import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  PermissionsSnapshotRecorder,
  compareSnapshots,
  createSnapshot,
  formatSnapshot,
  loadSnapshot,
  saveSnapshot,
  SNAPSHOT_FORMAT_VERSION,
} from '../../lib/permissions-snapshot/permissions-snapshot';
import type {
  PermissionsSnapshot,
  IamAction,
  AssumedRole,
} from '../../lib/permissions-snapshot/types';

describe('PermissionsSnapshotRecorder', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates a snapshot with recorded actions', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'test-recording',
      snapshotDirectory: tempDir,
    });

    recorder.start();
    // In real usage, the interceptor plugin would capture actions
    // Here we're just testing the state management
    const snapshot = recorder.stop();

    expect(snapshot.version).toBe(SNAPSHOT_FORMAT_VERSION);
    expect(snapshot.testName).toBe('test-recording');
    expect(snapshot.createdAt).toBeDefined();
    expect(snapshot.actions).toEqual([]);
    expect(snapshot.assumedRoles).toEqual([]);
  });

  test('throws error when stopping without starting', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'test',
      snapshotDirectory: tempDir,
    });

    expect(() => recorder.stop()).toThrow('Recording is not in progress');
  });

  test('throws error when starting twice', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'test',
      snapshotDirectory: tempDir,
    });

    recorder.start();
    expect(() => recorder.start()).toThrow('Recording is already in progress');
  });

  test('saves snapshot to correct path', async () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'my-test',
      snapshotDirectory: tempDir,
    });

    recorder.start();
    recorder.stop();
    await recorder.save();

    const snapshotPath = recorder.getSnapshotPath();
    expect(fs.existsSync(snapshotPath)).toBe(true);

    const savedContent = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(savedContent.testName).toBe('my-test');
  });

  test('sanitizes test name for file path', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'test/with:special*chars',
      snapshotDirectory: tempDir,
    });

    const snapshotPath = recorder.getSnapshotPath();
    expect(snapshotPath).toContain('test_with_special_chars');
    expect(snapshotPath).not.toContain('/with:');
  });

  test('loads baseline snapshot', async () => {
    // Create a baseline snapshot
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'baseline-test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject' },
      ],
      assumedRoles: [],
    };

    const snapshotPath = path.join(tempDir, 'baseline-test.permissions.snap.json');
    fs.writeFileSync(snapshotPath, JSON.stringify(baseline, null, 2));

    const recorder = new PermissionsSnapshotRecorder({
      testName: 'baseline-test',
      snapshotDirectory: tempDir,
    });

    const loaded = await recorder.loadBaseline();
    expect(loaded).toEqual(baseline);
  });

  test('returns null for missing baseline', async () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'non-existent-test',
      snapshotDirectory: tempDir,
    });

    const loaded = await recorder.loadBaseline();
    expect(loaded).toBeNull();
  });

  test('hasBaseline returns false for missing snapshot', () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'new-test',
      snapshotDirectory: tempDir,
    });

    expect(recorder.hasBaseline()).toBe(false);
  });

  test('hasBaseline returns true for existing snapshot', async () => {
    const recorder = new PermissionsSnapshotRecorder({
      testName: 'existing-test',
      snapshotDirectory: tempDir,
    });

    recorder.start();
    recorder.stop();
    await recorder.save();

    expect(recorder.hasBaseline()).toBe(true);
  });
});

describe('compareSnapshots', () => {
  test('returns match for identical snapshots', () => {
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject' },
        { service: 'CloudFormation', action: 'CreateStack' },
      ],
      assumedRoles: [
        { roleArn: 'arn:aws:iam::123456789012:role/TestRole' },
      ],
    };

    const current: PermissionsSnapshot = {
      ...baseline,
      createdAt: '2024-01-02T00:00:00.000Z', // Different timestamp
    };

    const result = compareSnapshots(baseline, current);

    expect(result.match).toBe(true);
    expect(result.addedActions).toEqual([]);
    expect(result.removedActions).toEqual([]);
    expect(result.addedRoles).toEqual([]);
    expect(result.removedRoles).toEqual([]);
  });

  test('detects added actions', () => {
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject' },
      ],
      assumedRoles: [],
    };

    const current: PermissionsSnapshot = {
      ...baseline,
      actions: [
        { service: 'S3', action: 'PutObject' },
        { service: 'S3', action: 'GetObject' },
      ],
    };

    const result = compareSnapshots(baseline, current);

    expect(result.match).toBe(false);
    expect(result.addedActions).toEqual([{ service: 'S3', action: 'GetObject' }]);
    expect(result.removedActions).toEqual([]);
    expect(result.summary).toContain('Added actions');
    expect(result.summary).toContain('S3:GetObject');
  });

  test('detects removed actions', () => {
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject' },
        { service: 'S3', action: 'GetObject' },
      ],
      assumedRoles: [],
    };

    const current: PermissionsSnapshot = {
      ...baseline,
      actions: [
        { service: 'S3', action: 'PutObject' },
      ],
    };

    const result = compareSnapshots(baseline, current);

    expect(result.match).toBe(false);
    expect(result.addedActions).toEqual([]);
    expect(result.removedActions).toEqual([{ service: 'S3', action: 'GetObject' }]);
    expect(result.summary).toContain('Removed actions');
    expect(result.summary).toContain('S3:GetObject');
  });

  test('detects added roles', () => {
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [],
      assumedRoles: [],
    };

    const current: PermissionsSnapshot = {
      ...baseline,
      assumedRoles: [
        { roleArn: 'arn:aws:iam::123456789012:role/NewRole' },
      ],
    };

    const result = compareSnapshots(baseline, current);

    expect(result.match).toBe(false);
    expect(result.addedRoles).toEqual([{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }]);
    expect(result.removedRoles).toEqual([]);
    expect(result.summary).toContain('Added roles');
  });

  test('detects removed roles', () => {
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [],
      assumedRoles: [
        { roleArn: 'arn:aws:iam::123456789012:role/OldRole' },
      ],
    };

    const current: PermissionsSnapshot = {
      ...baseline,
      assumedRoles: [],
    };

    const result = compareSnapshots(baseline, current);

    expect(result.match).toBe(false);
    expect(result.addedRoles).toEqual([]);
    expect(result.removedRoles).toEqual([{ roleArn: 'arn:aws:iam::123456789012:role/OldRole' }]);
    expect(result.summary).toContain('Removed roles');
  });

  test('ignores resources by default', () => {
    const baseline: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject', resources: ['bucket1'] },
      ],
      assumedRoles: [],
    };

    const current: PermissionsSnapshot = {
      ...baseline,
      actions: [
        { service: 'S3', action: 'PutObject', resources: ['bucket2'] },
      ],
    };

    const result = compareSnapshots(baseline, current);

    expect(result.match).toBe(true);
  });
});

describe('createSnapshot', () => {
  test('creates snapshot with deduplicated and sorted actions', () => {
    const actions: IamAction[] = [
      { service: 'S3', action: 'GetObject' },
      { service: 'CloudFormation', action: 'CreateStack' },
      { service: 'S3', action: 'GetObject' }, // Duplicate
      { service: 'S3', action: 'PutObject' },
    ];

    const roles: AssumedRole[] = [];

    const snapshot = createSnapshot('test', actions, roles);

    expect(snapshot.actions).toEqual([
      { service: 'CloudFormation', action: 'CreateStack' },
      { service: 'S3', action: 'GetObject' },
      { service: 'S3', action: 'PutObject' },
    ]);
  });

  test('creates snapshot with deduplicated and sorted roles', () => {
    const actions: IamAction[] = [];

    const roles: AssumedRole[] = [
      { roleArn: 'arn:aws:iam::123456789012:role/RoleB' },
      { roleArn: 'arn:aws:iam::123456789012:role/RoleA' },
      { roleArn: 'arn:aws:iam::123456789012:role/RoleB' }, // Duplicate
    ];

    const snapshot = createSnapshot('test', actions, roles);

    expect(snapshot.assumedRoles).toEqual([
      { roleArn: 'arn:aws:iam::123456789012:role/RoleA' },
      { roleArn: 'arn:aws:iam::123456789012:role/RoleB' },
    ]);
  });
});

describe('formatSnapshot', () => {
  test('formats snapshot as human-readable string', () => {
    const snapshot: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'my-test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject' },
        { service: 'CloudFormation', action: 'CreateStack' },
      ],
      assumedRoles: [
        { roleArn: 'arn:aws:iam::123456789012:role/TestRole' },
      ],
    };

    const formatted = formatSnapshot(snapshot);

    expect(formatted).toContain('my-test');
    expect(formatted).toContain(SNAPSHOT_FORMAT_VERSION);
    expect(formatted).toContain('S3:PutObject');
    expect(formatted).toContain('CloudFormation:CreateStack');
    expect(formatted).toContain('arn:aws:iam::123456789012:role/TestRole');
  });

  test('formats empty snapshot', () => {
    const snapshot: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'empty-test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [],
      assumedRoles: [],
    };

    const formatted = formatSnapshot(snapshot);

    expect(formatted).toContain('(none)');
  });
});

describe('loadSnapshot and saveSnapshot', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-io-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('saves and loads snapshot correctly', () => {
    const snapshot: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'io-test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [
        { service: 'S3', action: 'PutObject' },
      ],
      assumedRoles: [
        { roleArn: 'arn:aws:iam::123456789012:role/TestRole' },
      ],
    };

    const snapshotPath = path.join(tempDir, 'test.permissions.snap.json');
    saveSnapshot(snapshot, snapshotPath);

    const loaded = loadSnapshot(snapshotPath);
    expect(loaded).toEqual(snapshot);
  });

  test('creates directory if it does not exist', () => {
    const snapshot: PermissionsSnapshot = {
      version: SNAPSHOT_FORMAT_VERSION,
      testName: 'nested-test',
      createdAt: '2024-01-01T00:00:00.000Z',
      actions: [],
      assumedRoles: [],
    };

    const snapshotPath = path.join(tempDir, 'nested', 'dir', 'test.permissions.snap.json');
    saveSnapshot(snapshot, snapshotPath);

    expect(fs.existsSync(snapshotPath)).toBe(true);
  });
});
