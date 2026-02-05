import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PermissionsSnapshot } from '../../lib/permissions/types';
import {
  PermissionsSnapshotWriter,
  DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME,
} from '../../lib/permissions/snapshot-writer';
import {
  PermissionsSnapshotComparator,
  SnapshotDiff,
} from '../../lib/permissions/snapshot-comparator';

describe('PermissionsSnapshotWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-permissions-test-'));
  });

  afterEach(() => {
    deleteFolderRecursive(tmpDir);
  });

  const createTestSnapshot = (overrides?: Partial<PermissionsSnapshot>): PermissionsSnapshot => ({
    version: '1.0.0',
    testName: 'test-case',
    capturedAt: '2024-01-15T10:00:00.000Z',
    assumedRoles: [
      { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-15T10:00:01.000Z' },
    ],
    iamActions: [
      { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:02.000Z' },
      { service: 's3', action: 'PutObject', timestamp: '2024-01-15T10:00:03.000Z' },
    ],
    ...overrides,
  });

  describe('write', () => {
    test('writes snapshot to default filename', () => {
      const snapshot = createTestSnapshot();

      PermissionsSnapshotWriter.write(snapshot, tmpDir);

      const filePath = path.join(tmpDir, DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('writes snapshot to custom filename', () => {
      const snapshot = createTestSnapshot();
      const customFilename = 'custom-permissions.json';

      PermissionsSnapshotWriter.write(snapshot, tmpDir, customFilename);

      const filePath = path.join(tmpDir, customFilename);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('creates directory if it does not exist', () => {
      const snapshot = createTestSnapshot();
      const nestedDir = path.join(tmpDir, 'nested', 'snapshot');

      PermissionsSnapshotWriter.write(snapshot, nestedDir);

      const filePath = path.join(nestedDir, DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('writes valid JSON with 2-space indentation', () => {
      const snapshot = createTestSnapshot();

      PermissionsSnapshotWriter.write(snapshot, tmpDir);

      const filePath = path.join(tmpDir, DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check that it's valid JSON
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe('1.0.0');

      // Check 2-space indentation (lines should start with spaces in multiples of 2)
      const lines = content.split('\n');
      const indentedLines = lines.filter(line => line.startsWith('  '));
      expect(indentedLines.length).toBeGreaterThan(0);
    });

    test('sorts IAM actions alphabetically', () => {
      const snapshot = createTestSnapshot({
        iamActions: [
          { service: 'lambda', action: 'CreateFunction', timestamp: '2024-01-15T10:00:01.000Z' },
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:02.000Z' },
          { service: 'ec2', action: 'DescribeInstances', timestamp: '2024-01-15T10:00:03.000Z' },
        ],
      });

      PermissionsSnapshotWriter.write(snapshot, tmpDir);

      const loaded = PermissionsSnapshotWriter.read(tmpDir)!;
      const actions = loaded.iamActions.map(a => `${a.service}:${a.action}`);
      expect(actions).toEqual([
        'ec2:DescribeInstances',
        'lambda:CreateFunction',
        's3:GetObject',
      ]);
    });

    test('sorts assumed roles alphabetically by roleArn', () => {
      const snapshot = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/ZRole', timestamp: '2024-01-15T10:00:01.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/ARole', timestamp: '2024-01-15T10:00:02.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/MRole', timestamp: '2024-01-15T10:00:03.000Z' },
        ],
      });

      PermissionsSnapshotWriter.write(snapshot, tmpDir);

      const loaded = PermissionsSnapshotWriter.read(tmpDir)!;
      const roles = loaded.assumedRoles.map(r => r.roleArn);
      expect(roles).toEqual([
        'arn:aws:iam::123456789012:role/ARole',
        'arn:aws:iam::123456789012:role/MRole',
        'arn:aws:iam::123456789012:role/ZRole',
      ]);
    });

    test('overwrites existing snapshot file', () => {
      const snapshot1 = createTestSnapshot({ testName: 'first-test' });
      const snapshot2 = createTestSnapshot({ testName: 'second-test' });

      PermissionsSnapshotWriter.write(snapshot1, tmpDir);
      PermissionsSnapshotWriter.write(snapshot2, tmpDir);

      const loaded = PermissionsSnapshotWriter.read(tmpDir)!;
      expect(loaded.testName).toBe('second-test');
    });
  });

  describe('read', () => {
    test('reads existing snapshot file', () => {
      const snapshot = createTestSnapshot();
      PermissionsSnapshotWriter.write(snapshot, tmpDir);

      const loaded = PermissionsSnapshotWriter.read(tmpDir);

      expect(loaded).toBeDefined();
      expect(loaded!.version).toBe('1.0.0');
      expect(loaded!.testName).toBe('test-case');
    });

    test('reads from custom filename', () => {
      const snapshot = createTestSnapshot({ testName: 'custom-test' });
      const customFilename = 'custom-snapshot.json';
      PermissionsSnapshotWriter.write(snapshot, tmpDir, customFilename);

      const loaded = PermissionsSnapshotWriter.read(tmpDir, customFilename);

      expect(loaded).toBeDefined();
      expect(loaded!.testName).toBe('custom-test');
    });

    test('returns undefined for non-existent file', () => {
      const loaded = PermissionsSnapshotWriter.read(tmpDir);

      expect(loaded).toBeUndefined();
    });

    test('returns undefined for non-existent directory', () => {
      const nonExistentDir = path.join(tmpDir, 'does-not-exist');

      const loaded = PermissionsSnapshotWriter.read(nonExistentDir);

      expect(loaded).toBeUndefined();
    });

    test('returns undefined for invalid JSON file', () => {
      const filePath = path.join(tmpDir, DEFAULT_PERMISSIONS_SNAPSHOT_FILENAME);
      fs.writeFileSync(filePath, 'not valid json {{{', 'utf-8');

      const loaded = PermissionsSnapshotWriter.read(tmpDir);

      expect(loaded).toBeUndefined();
    });

    test('preserves all snapshot fields', () => {
      const snapshot = createTestSnapshot({
        assumedRoles: [
          {
            roleArn: 'arn:aws:iam::123456789012:role/TestRole',
            sessionName: 'my-session',
            timestamp: '2024-01-15T10:00:01.000Z',
          },
        ],
      });
      PermissionsSnapshotWriter.write(snapshot, tmpDir);

      const loaded = PermissionsSnapshotWriter.read(tmpDir)!;

      expect(loaded.version).toBe(snapshot.version);
      expect(loaded.testName).toBe(snapshot.testName);
      expect(loaded.capturedAt).toBe(snapshot.capturedAt);
      expect(loaded.assumedRoles[0].roleArn).toBe(snapshot.assumedRoles[0].roleArn);
      expect(loaded.assumedRoles[0].sessionName).toBe(snapshot.assumedRoles[0].sessionName);
    });
  });

  describe('round-trip', () => {
    test('write and read produces equivalent snapshot', () => {
      const snapshot = createTestSnapshot();

      PermissionsSnapshotWriter.write(snapshot, tmpDir);
      const loaded = PermissionsSnapshotWriter.read(tmpDir);

      expect(loaded).toEqual(expect.objectContaining({
        version: snapshot.version,
        testName: snapshot.testName,
        capturedAt: snapshot.capturedAt,
      }));
    });
  });
});

describe('PermissionsSnapshotComparator', () => {
  const createTestSnapshot = (overrides?: Partial<PermissionsSnapshot>): PermissionsSnapshot => ({
    version: '1.0.0',
    testName: 'test-case',
    capturedAt: '2024-01-15T10:00:00.000Z',
    assumedRoles: [],
    iamActions: [],
    ...overrides,
  });

  describe('compare', () => {
    test('returns no changes for identical snapshots', () => {
      const snapshot = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(snapshot, snapshot);

      expect(diff.hasChanges).toBe(false);
      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.addedActions).toEqual([]);
      expect(diff.removedActions).toEqual([]);
    });

    test('detects added roles', () => {
      const current = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });
      const expected = createTestSnapshot();

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/NewRole']);
      expect(diff.removedRoles).toEqual([]);
    });

    test('detects removed roles', () => {
      const current = createTestSnapshot();
      const expected = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual(['arn:aws:iam::123456789012:role/OldRole']);
    });

    test('detects added actions', () => {
      const current = createTestSnapshot({
        iamActions: [
          { service: 's3', action: 'PutObject', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });
      const expected = createTestSnapshot();

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedActions).toEqual(['s3:PutObject']);
      expect(diff.removedActions).toEqual([]);
    });

    test('detects removed actions', () => {
      const current = createTestSnapshot();
      const expected = createTestSnapshot({
        iamActions: [
          { service: 'lambda', action: 'CreateFunction', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedActions).toEqual([]);
      expect(diff.removedActions).toEqual(['lambda:CreateFunction']);
    });

    test('detects multiple changes', () => {
      const current = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole', timestamp: '2024-01-15T10:00:00.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/SharedRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
          { service: 'ec2', action: 'DescribeInstances', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });
      const expected = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole', timestamp: '2024-01-15T10:00:00.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/SharedRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
          { service: 'lambda', action: 'CreateFunction', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/NewRole']);
      expect(diff.removedRoles).toEqual(['arn:aws:iam::123456789012:role/OldRole']);
      expect(diff.addedActions).toEqual(['ec2:DescribeInstances']);
      expect(diff.removedActions).toEqual(['lambda:CreateFunction']);
    });

    test('ignores duplicate roles', () => {
      const current = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-15T10:00:00.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-15T10:00:01.000Z' },
        ],
      });
      const expected = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(false);
    });

    test('ignores duplicate actions', () => {
      const current = createTestSnapshot({
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:01.000Z' },
        ],
      });
      const expected = createTestSnapshot({
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(false);
    });

    test('ignores order of roles', () => {
      const current = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/RoleA', timestamp: '2024-01-15T10:00:00.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/RoleB', timestamp: '2024-01-15T10:00:01.000Z' },
        ],
      });
      const expected = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/RoleB', timestamp: '2024-01-15T10:00:00.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/RoleA', timestamp: '2024-01-15T10:00:01.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(false);
    });

    test('ignores order of actions', () => {
      const current = createTestSnapshot({
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
          { service: 'lambda', action: 'CreateFunction', timestamp: '2024-01-15T10:00:01.000Z' },
        ],
      });
      const expected = createTestSnapshot({
        iamActions: [
          { service: 'lambda', action: 'CreateFunction', timestamp: '2024-01-15T10:00:00.000Z' },
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:01.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, expected);

      expect(diff.hasChanges).toBe(false);
    });

    test('handles undefined expected snapshot', () => {
      const current = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [
          { service: 's3', action: 'GetObject', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, undefined);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/TestRole']);
      expect(diff.addedActions).toEqual(['s3:GetObject']);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.removedActions).toEqual([]);
    });

    test('returns no changes for empty current with undefined expected', () => {
      const current = createTestSnapshot();

      const diff = PermissionsSnapshotComparator.compare(current, undefined);

      expect(diff.hasChanges).toBe(false);
    });

    test('returns sorted diff arrays', () => {
      const current = createTestSnapshot({
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/ZRole', timestamp: '2024-01-15T10:00:00.000Z' },
          { roleArn: 'arn:aws:iam::123456789012:role/ARole', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
        iamActions: [
          { service: 's3', action: 'PutObject', timestamp: '2024-01-15T10:00:00.000Z' },
          { service: 'ec2', action: 'DescribeInstances', timestamp: '2024-01-15T10:00:00.000Z' },
        ],
      });

      const diff = PermissionsSnapshotComparator.compare(current, undefined);

      expect(diff.addedRoles).toEqual([
        'arn:aws:iam::123456789012:role/ARole',
        'arn:aws:iam::123456789012:role/ZRole',
      ]);
      expect(diff.addedActions).toEqual([
        'ec2:DescribeInstances',
        's3:PutObject',
      ]);
    });
  });

  describe('formatDiff', () => {
    test('returns no changes message for empty diff', () => {
      const diff: SnapshotDiff = {
        hasChanges: false,
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toBe('No permissions changes detected.');
    });

    test('formats added roles', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('Added roles:');
      expect(output).toContain('+ arn:aws:iam::123456789012:role/NewRole');
    });

    test('formats removed roles', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedActions: [],
        removedActions: [],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('Removed roles:');
      expect(output).toContain('- arn:aws:iam::123456789012:role/OldRole');
    });

    test('formats added actions', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:PutObject'],
        removedActions: [],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('Added actions:');
      expect(output).toContain('+ s3:PutObject');
    });

    test('formats removed actions', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: ['lambda:CreateFunction'],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('Removed actions:');
      expect(output).toContain('- lambda:CreateFunction');
    });

    test('formats complete diff with all sections', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedActions: ['s3:PutObject'],
        removedActions: ['lambda:DeleteFunction'],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('Permissions snapshot mismatch:');
      expect(output).toContain('Added roles:');
      expect(output).toContain('+ arn:aws:iam::123456789012:role/NewRole');
      expect(output).toContain('Removed roles:');
      expect(output).toContain('- arn:aws:iam::123456789012:role/OldRole');
      expect(output).toContain('Added actions:');
      expect(output).toContain('+ s3:PutObject');
      expect(output).toContain('Removed actions:');
      expect(output).toContain('- lambda:DeleteFunction');
      expect(output).toContain('--update-permissions-snapshot');
    });

    test('includes update flag hint', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:GetObject'],
        removedActions: [],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('Run with --update-permissions-snapshot to update the snapshot.');
    });

    test('formats multiple items in each section', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [
          'arn:aws:iam::123456789012:role/Role1',
          'arn:aws:iam::123456789012:role/Role2',
        ],
        removedRoles: [],
        addedActions: [
          's3:GetObject',
          's3:PutObject',
          'lambda:CreateFunction',
        ],
        removedActions: [],
      };

      const output = PermissionsSnapshotComparator.formatDiff(diff);

      expect(output).toContain('+ arn:aws:iam::123456789012:role/Role1');
      expect(output).toContain('+ arn:aws:iam::123456789012:role/Role2');
      expect(output).toContain('+ s3:GetObject');
      expect(output).toContain('+ s3:PutObject');
      expect(output).toContain('+ lambda:CreateFunction');
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
