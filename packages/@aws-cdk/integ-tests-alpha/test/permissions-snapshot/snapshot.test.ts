import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SnapshotManager,
  SNAPSHOT_EXTENSION,
  PermissionsSnapshotError,
} from '../../lib/permissions-snapshot/snapshot';
import type { PermissionsSnapshot } from '../../lib/permissions-snapshot/types';
import { SNAPSHOT_VERSION } from '../../lib/permissions-snapshot/tracker';

describe('SnapshotManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestSnapshot = (overrides: Partial<PermissionsSnapshot> = {}): PermissionsSnapshot => ({
    version: SNAPSHOT_VERSION,
    timestamp: new Date().toISOString(),
    testName: 'test-snapshot',
    roles: [
      { roleArn: 'arn:aws:iam::123456789012:role/TestRole', sessionName: 'test-session' },
    ],
    actions: [
      { service: 's3', action: 'GetObject', count: 5 },
      { service: 'sts', action: 'AssumeRole', count: 1 },
    ],
    ...overrides,
  });

  describe('save', () => {
    test('saves a snapshot to disk', () => {
      const snapshot = createTestSnapshot();
      const filePath = SnapshotManager.save(snapshot, { directory: tempDir });

      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toContain(SNAPSHOT_EXTENSION);
    });

    test('creates directory if it does not exist', () => {
      const snapshot = createTestSnapshot();
      const nestedDir = path.join(tempDir, 'nested', 'directory');

      const filePath = SnapshotManager.save(snapshot, { directory: nestedDir });

      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('uses custom base name when provided', () => {
      const snapshot = createTestSnapshot();
      const filePath = SnapshotManager.save(snapshot, {
        directory: tempDir,
        baseName: 'custom-name',
      });

      expect(filePath).toContain('custom-name');
    });

    test('sanitizes test name for file name', () => {
      const snapshot = createTestSnapshot({ testName: 'Test/With:Special*Characters' });
      const filePath = SnapshotManager.save(snapshot, { directory: tempDir });

      expect(filePath).toMatch(/test-with-special-characters/);
    });

    test('pretty prints by default', () => {
      const snapshot = createTestSnapshot();
      const filePath = SnapshotManager.save(snapshot, { directory: tempDir });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('\n');
    });

    test('can disable pretty printing', () => {
      const snapshot = createTestSnapshot();
      const filePath = SnapshotManager.save(snapshot, {
        directory: tempDir,
        prettyPrint: false,
      });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('\n');
    });
  });

  describe('load', () => {
    test('loads a snapshot from disk', () => {
      const snapshot = createTestSnapshot();
      const filePath = SnapshotManager.save(snapshot, { directory: tempDir });

      const loaded = SnapshotManager.load({ filePath });

      expect(loaded).toBeDefined();
      expect(loaded?.testName).toBe(snapshot.testName);
      expect(loaded?.roles).toEqual(snapshot.roles);
      expect(loaded?.actions).toEqual(snapshot.actions);
    });

    test('returns undefined for non-existent file', () => {
      const loaded = SnapshotManager.load({
        filePath: path.join(tempDir, 'non-existent.json'),
      });

      expect(loaded).toBeUndefined();
    });

    test('throws error for invalid snapshot format', () => {
      const filePath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(filePath, JSON.stringify({ invalid: 'data' }));

      expect(() => SnapshotManager.load({ filePath })).toThrow('Invalid snapshot');
    });

    test('throws error for incompatible version', () => {
      const snapshot = createTestSnapshot({ version: '99.0.0' });
      const filePath = path.join(tempDir, 'old-version.json');
      fs.writeFileSync(filePath, JSON.stringify(snapshot));

      expect(() => SnapshotManager.load({ filePath })).toThrow('not compatible');
    });
  });

  describe('compare', () => {
    test('returns matches=true for identical snapshots', () => {
      const snapshot = createTestSnapshot();
      const result = SnapshotManager.compare(snapshot, snapshot);

      expect(result.matches).toBe(true);
      expect(result.addedRoles).toHaveLength(0);
      expect(result.removedRoles).toHaveLength(0);
      expect(result.addedActions).toHaveLength(0);
      expect(result.removedActions).toHaveLength(0);
    });

    test('detects added roles', () => {
      const existing = createTestSnapshot({ roles: [] });
      const current = createTestSnapshot();

      const result = SnapshotManager.compare(existing, current);

      expect(result.matches).toBe(false);
      expect(result.addedRoles).toHaveLength(1);
      expect(result.removedRoles).toHaveLength(0);
    });

    test('detects removed roles', () => {
      const existing = createTestSnapshot();
      const current = createTestSnapshot({ roles: [] });

      const result = SnapshotManager.compare(existing, current);

      expect(result.matches).toBe(false);
      expect(result.addedRoles).toHaveLength(0);
      expect(result.removedRoles).toHaveLength(1);
    });

    test('detects added actions', () => {
      const existing = createTestSnapshot({ actions: [] });
      const current = createTestSnapshot();

      const result = SnapshotManager.compare(existing, current);

      expect(result.matches).toBe(false);
      expect(result.addedActions).toHaveLength(2);
      expect(result.removedActions).toHaveLength(0);
    });

    test('detects removed actions', () => {
      const existing = createTestSnapshot();
      const current = createTestSnapshot({ actions: [] });

      const result = SnapshotManager.compare(existing, current);

      expect(result.matches).toBe(false);
      expect(result.addedActions).toHaveLength(0);
      expect(result.removedActions).toHaveLength(2);
    });

    test('ignores action count differences', () => {
      const existing = createTestSnapshot({
        actions: [{ service: 's3', action: 'GetObject', count: 5 }],
      });
      const current = createTestSnapshot({
        actions: [{ service: 's3', action: 'GetObject', count: 10 }],
      });

      const result = SnapshotManager.compare(existing, current);

      expect(result.matches).toBe(true);
    });

    test('generates a meaningful summary', () => {
      const existing = createTestSnapshot({
        roles: [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole' }],
        actions: [{ service: 's3', action: 'GetObject', count: 1 }],
      });
      const current = createTestSnapshot({
        roles: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
        actions: [{ service: 's3', action: 'PutObject', count: 1 }],
      });

      const result = SnapshotManager.compare(existing, current);

      expect(result.summary).toContain('Added roles');
      expect(result.summary).toContain('Removed roles');
      expect(result.summary).toContain('Added actions');
      expect(result.summary).toContain('Removed actions');
    });

    test('summary shows no changes when snapshots match', () => {
      const snapshot = createTestSnapshot();
      const result = SnapshotManager.compare(snapshot, snapshot);

      expect(result.summary).toBe('No changes detected.');
    });
  });

  describe('getSnapshotPath', () => {
    test('returns correct path for test file', () => {
      const testFilePath = '/path/to/test/integ.my-test.ts';
      const snapshotPath = SnapshotManager.getSnapshotPath(testFilePath);

      expect(snapshotPath).toBe(`/path/to/test/integ.my-test${SNAPSHOT_EXTENSION}`);
    });

    test('handles .js extension', () => {
      const testFilePath = '/path/to/test/integ.my-test.js';
      const snapshotPath = SnapshotManager.getSnapshotPath(testFilePath);

      expect(snapshotPath).toBe(`/path/to/test/integ.my-test${SNAPSHOT_EXTENSION}`);
    });
  });
});

describe('PermissionsSnapshotError', () => {
  test('includes comparison result in error', () => {
    const comparisonResult = {
      matches: false,
      addedRoles: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
      removedRoles: [],
      addedActions: [],
      removedActions: [],
      summary: 'Added roles:\n  + arn:aws:iam::123456789012:role/NewRole',
    };

    const error = new PermissionsSnapshotError(
      'Snapshot comparison failed',
      comparisonResult,
    );

    expect(error.name).toBe('PermissionsSnapshotError');
    expect(error.message).toBe('Snapshot comparison failed');
    expect(error.comparisonResult).toBe(comparisonResult);
  });
});
