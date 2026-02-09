import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readSnapshot,
  readSnapshotOrNull,
  readSnapshotRequired,
  snapshotExists,
} from '../lib/snapshot-reader';
import { SnapshotFile } from '../lib/snapshot-format';

describe('snapshot-reader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-reader-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const validSnapshotFile: SnapshotFile = {
    metadata: {
      version: '1.0',
      testName: 'test-snapshot',
      timestamp: '2024-01-01T00:00:00.000Z',
    },
    actions: [
      { service: 's3', action: 'GetObject' },
      { service: 's3', action: 'PutObject' },
    ],
    assumedRoles: [
      { roleArn: 'arn:aws:iam::123456789012:role/MyRole', assumedVia: 'AssumeRole' },
    ],
  };

  describe('readSnapshot', () => {
    it('should return exists: false for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.json');
      const result = readSnapshot(filePath);

      expect(result.exists).toBe(false);
      expect(result.snapshot).toBeNull();
    });

    it('should read and parse a valid snapshot file', () => {
      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(validSnapshotFile), 'utf-8');

      const result = readSnapshot(filePath);

      expect(result.exists).toBe(true);
      expect(result.snapshot).toEqual(validSnapshotFile);
    });

    it('should throw for invalid JSON', () => {
      const filePath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(filePath, 'not valid json', 'utf-8');

      expect(() => readSnapshot(filePath)).toThrow();
    });

    it('should throw for missing metadata', () => {
      const filePath = path.join(tempDir, 'missing-metadata.json');
      fs.writeFileSync(filePath, JSON.stringify({
        actions: [],
        assumedRoles: [],
      }), 'utf-8');

      expect(() => readSnapshot(filePath)).toThrow('metadata');
    });

    it('should throw for missing actions array', () => {
      const filePath = path.join(tempDir, 'missing-actions.json');
      fs.writeFileSync(filePath, JSON.stringify({
        metadata: { version: '1.0', testName: 'test', timestamp: 'now' },
        assumedRoles: [],
      }), 'utf-8');

      expect(() => readSnapshot(filePath)).toThrow('actions');
    });

    it('should throw for invalid action structure', () => {
      const filePath = path.join(tempDir, 'invalid-action.json');
      fs.writeFileSync(filePath, JSON.stringify({
        metadata: { version: '1.0', testName: 'test', timestamp: 'now' },
        actions: [{ service: 's3' }], // missing action field
        assumedRoles: [],
      }), 'utf-8');

      expect(() => readSnapshot(filePath)).toThrow('action');
    });

    it('should throw for invalid role structure', () => {
      const filePath = path.join(tempDir, 'invalid-role.json');
      fs.writeFileSync(filePath, JSON.stringify({
        metadata: { version: '1.0', testName: 'test', timestamp: 'now' },
        actions: [],
        assumedRoles: [{ roleArn: 'arn:...' }], // missing assumedVia
      }), 'utf-8');

      expect(() => readSnapshot(filePath)).toThrow('assumedVia');
    });
  });

  describe('readSnapshotOrNull', () => {
    it('should return null for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.json');
      expect(readSnapshotOrNull(filePath)).toBeNull();
    });

    it('should return snapshot for existing file', () => {
      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(validSnapshotFile), 'utf-8');

      expect(readSnapshotOrNull(filePath)).toEqual(validSnapshotFile);
    });
  });

  describe('readSnapshotRequired', () => {
    it('should throw for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.json');
      expect(() => readSnapshotRequired(filePath)).toThrow('does not exist');
    });

    it('should return snapshot for existing file', () => {
      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(validSnapshotFile), 'utf-8');

      expect(readSnapshotRequired(filePath)).toEqual(validSnapshotFile);
    });
  });

  describe('snapshotExists', () => {
    it('should return false for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.json');
      expect(snapshotExists(filePath)).toBe(false);
    });

    it('should return true for existing file', () => {
      const filePath = path.join(tempDir, 'test.json');
      fs.writeFileSync(filePath, '{}', 'utf-8');

      expect(snapshotExists(filePath)).toBe(true);
    });
  });
});
