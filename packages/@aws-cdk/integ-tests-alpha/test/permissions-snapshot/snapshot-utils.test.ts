import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readSnapshot,
  writeSnapshot,
  getSnapshotPath,
  compareSnapshots,
  formatComparisonResult,
  assertSnapshotMatch,
  updateSnapshot,
  DEFAULT_SNAPSHOT_FILENAME,
} from '../../lib/permissions-snapshot/snapshot-utils';
import type { PermissionsSnapshot } from '../../lib/permissions-snapshot/types';
import { SNAPSHOT_VERSION } from '../../lib/permissions-snapshot/permissions-recorder';

describe('Snapshot Utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createValidSnapshot = (overrides?: Partial<PermissionsSnapshot>): PermissionsSnapshot => ({
    version: SNAPSHOT_VERSION,
    assumedRoles: [],
    iamActions: [],
    ...overrides,
  });

  describe('readSnapshot', () => {
    test('should return undefined for non-existent file', () => {
      const result = readSnapshot(path.join(tempDir, 'non-existent.json'));
      expect(result).toBeUndefined();
    });

    test('should read valid snapshot', () => {
      const snapshot = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject' }],
      });
      const filePath = path.join(tempDir, 'snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(snapshot));

      const result = readSnapshot(filePath);

      expect(result).toEqual(snapshot);
    });

    test('should throw for invalid JSON', () => {
      const filePath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(filePath, 'not valid json');

      expect(() => readSnapshot(filePath)).toThrow('Failed to read snapshot');
    });

    test('should throw for missing version', () => {
      const filePath = path.join(tempDir, 'no-version.json');
      fs.writeFileSync(filePath, JSON.stringify({ iamActions: [] }));

      expect(() => readSnapshot(filePath)).toThrow('missing version');
    });
  });

  describe('writeSnapshot', () => {
    test('should write snapshot to file', () => {
      const snapshot = createValidSnapshot({
        testName: 'my-test',
        iamActions: [{ service: 's3', action: 'PutObject' }],
      });
      const filePath = path.join(tempDir, 'output.json');

      writeSnapshot(filePath, snapshot);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(snapshot);
    });

    test('should create directory if it does not exist', () => {
      const snapshot = createValidSnapshot();
      const filePath = path.join(tempDir, 'nested', 'dir', 'output.json');

      writeSnapshot(filePath, snapshot);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('should write pretty-formatted JSON', () => {
      const snapshot = createValidSnapshot();
      const filePath = path.join(tempDir, 'pretty.json');

      writeSnapshot(filePath, snapshot);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('\n');
      expect(content).toContain('  '); // Indentation
    });
  });

  describe('getSnapshotPath', () => {
    test('should generate snapshot path from test file path', () => {
      const testPath = '/path/to/test/integ.my-test.ts';
      const result = getSnapshotPath(testPath);

      expect(result).toBe(`/path/to/test/integ.my-test.js.snapshot/${DEFAULT_SNAPSHOT_FILENAME}`);
    });

    test('should handle .js extension', () => {
      const testPath = '/path/to/test/integ.my-test.js';
      const result = getSnapshotPath(testPath);

      expect(result).toBe(`/path/to/test/integ.my-test.js.snapshot/${DEFAULT_SNAPSHOT_FILENAME}`);
    });
  });

  describe('compareSnapshots', () => {
    test('should return matches=true for identical snapshots', () => {
      const snapshot = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject' }],
        assumedRoles: [{ roleArn: 'arn:aws:iam::123456789012:role/TestRole' }],
      });

      const result = compareSnapshots(snapshot, snapshot);

      expect(result.matches).toBe(true);
      expect(result.addedActions).toHaveLength(0);
      expect(result.removedActions).toHaveLength(0);
      expect(result.addedRoles).toHaveLength(0);
      expect(result.removedRoles).toHaveLength(0);
    });

    test('should detect added actions', () => {
      const expected = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });
      const actual = createValidSnapshot({
        iamActions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
      });

      const result = compareSnapshots(expected, actual);

      expect(result.matches).toBe(false);
      expect(result.addedActions).toHaveLength(1);
      expect(result.addedActions[0]).toEqual({ service: 's3', action: 'PutObject' });
    });

    test('should detect removed actions', () => {
      const expected = createValidSnapshot({
        iamActions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
      });
      const actual = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });

      const result = compareSnapshots(expected, actual);

      expect(result.matches).toBe(false);
      expect(result.removedActions).toHaveLength(1);
      expect(result.removedActions[0]).toEqual({ service: 's3', action: 'PutObject' });
    });

    test('should detect added roles', () => {
      const expected = createValidSnapshot({ assumedRoles: [] });
      const actual = createValidSnapshot({
        assumedRoles: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
      });

      const result = compareSnapshots(expected, actual);

      expect(result.matches).toBe(false);
      expect(result.addedRoles).toHaveLength(1);
    });

    test('should detect removed roles', () => {
      const expected = createValidSnapshot({
        assumedRoles: [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole' }],
      });
      const actual = createValidSnapshot({ assumedRoles: [] });

      const result = compareSnapshots(expected, actual);

      expect(result.matches).toBe(false);
      expect(result.removedRoles).toHaveLength(1);
    });

    test('should allow additional actions when option is set', () => {
      const expected = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });
      const actual = createValidSnapshot({
        iamActions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
      });

      const result = compareSnapshots(expected, actual, { allowAdditionalActions: true });

      expect(result.matches).toBe(true);
      expect(result.addedActions).toHaveLength(1); // Still reported, but matches=true
    });

    test('should ignore resource ARNs by default', () => {
      const expected = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject', resources: ['arn:aws:s3:::bucket-1/*'] }],
      });
      const actual = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject', resources: ['arn:aws:s3:::bucket-2/*'] }],
      });

      const result = compareSnapshots(expected, actual);

      expect(result.matches).toBe(true);
    });

    test('should compare resource ARNs when option is disabled', () => {
      const expected = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject', resources: ['arn:aws:s3:::bucket-1/*'] }],
      });
      const actual = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject', resources: ['arn:aws:s3:::bucket-2/*'] }],
      });

      const result = compareSnapshots(expected, actual, { ignoreResourceArns: false });

      expect(result.matches).toBe(false);
    });
  });

  describe('formatComparisonResult', () => {
    test('should format matching result', () => {
      const result = formatComparisonResult({
        matches: true,
        addedActions: [],
        removedActions: [],
        addedRoles: [],
        removedRoles: [],
      });

      expect(result).toBe('Permissions snapshot matches expected.');
    });

    test('should format mismatch with added actions', () => {
      const result = formatComparisonResult({
        matches: false,
        addedActions: [{ service: 's3', action: 'PutObject' }],
        removedActions: [],
        addedRoles: [],
        removedRoles: [],
      });

      expect(result).toContain('Permissions snapshot mismatch detected');
      expect(result).toContain('Added IAM Actions');
      expect(result).toContain('+ s3:PutObject');
    });

    test('should format mismatch with removed actions', () => {
      const result = formatComparisonResult({
        matches: false,
        addedActions: [],
        removedActions: [{ service: 's3', action: 'GetObject' }],
        addedRoles: [],
        removedRoles: [],
      });

      expect(result).toContain('Removed IAM Actions');
      expect(result).toContain('- s3:GetObject');
    });

    test('should format mismatch with role changes', () => {
      const result = formatComparisonResult({
        matches: false,
        addedActions: [],
        removedActions: [],
        addedRoles: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
        removedRoles: [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole' }],
      });

      expect(result).toContain('Added Role Assumptions');
      expect(result).toContain('+ arn:aws:iam::123456789012:role/NewRole');
      expect(result).toContain('Removed Role Assumptions');
      expect(result).toContain('- arn:aws:iam::123456789012:role/OldRole');
    });
  });

  describe('assertSnapshotMatch', () => {
    test('should throw for missing snapshot', () => {
      const actual = createValidSnapshot();
      const snapshotPath = path.join(tempDir, 'non-existent.json');

      expect(() => assertSnapshotMatch(snapshotPath, actual)).toThrow('not found');
    });

    test('should pass for matching snapshot', () => {
      const snapshot = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject' }],
      });
      const snapshotPath = path.join(tempDir, 'snapshot.json');
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));

      expect(() => assertSnapshotMatch(snapshotPath, snapshot)).not.toThrow();
    });

    test('should throw for mismatched snapshot', () => {
      const expected = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });
      const actual = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject' }],
      });
      const snapshotPath = path.join(tempDir, 'snapshot.json');
      fs.writeFileSync(snapshotPath, JSON.stringify(expected));

      expect(() => assertSnapshotMatch(snapshotPath, actual)).toThrow('mismatch');
    });
  });

  describe('updateSnapshot', () => {
    test('should create new snapshot', () => {
      const snapshot = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject' }],
      });
      const snapshotPath = path.join(tempDir, 'new-snapshot.json');

      const result = updateSnapshot(snapshotPath, snapshot);

      expect(result.created).toBe(true);
      expect(result.updated).toBe(false);
      expect(fs.existsSync(snapshotPath)).toBe(true);
    });

    test('should update existing snapshot when different', () => {
      const original = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });
      const updated = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'PutObject' }],
      });
      const snapshotPath = path.join(tempDir, 'existing-snapshot.json');
      fs.writeFileSync(snapshotPath, JSON.stringify(original));

      const result = updateSnapshot(snapshotPath, updated);

      expect(result.created).toBe(false);
      expect(result.updated).toBe(true);

      const content = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(content.iamActions[0].action).toBe('PutObject');
    });

    test('should not update identical snapshot', () => {
      const snapshot = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });
      const snapshotPath = path.join(tempDir, 'identical-snapshot.json');
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));

      const result = updateSnapshot(snapshotPath, snapshot);

      expect(result.created).toBe(false);
      expect(result.updated).toBe(false);
    });

    test('should force update when option is set', () => {
      const snapshot = createValidSnapshot({
        iamActions: [{ service: 's3', action: 'GetObject' }],
      });
      const snapshotPath = path.join(tempDir, 'force-snapshot.json');
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));

      const result = updateSnapshot(snapshotPath, snapshot, { force: true });

      expect(result.updated).toBe(true);
    });
  });
});
