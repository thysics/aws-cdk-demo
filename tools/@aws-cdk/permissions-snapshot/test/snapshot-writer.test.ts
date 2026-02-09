import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  writeSnapshot,
  writeSnapshotFile,
  getSnapshotPath,
} from '../lib/snapshot-writer';
import { PermissionsSnapshot } from '../lib/types';
import { SnapshotFile, SNAPSHOT_FORMAT_VERSION } from '../lib/snapshot-format';

describe('snapshot-writer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-writer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writeSnapshot', () => {
    it('should write a snapshot file with correct format', () => {
      const snapshot: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'PutObject' },
          { service: 's3', action: 'GetObject' },
        ],
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/MyRole', assumedVia: 'AssumeRole' },
        ],
      };

      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      writeSnapshot(snapshot, filePath, { testName: 'test-snapshot' });

      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.metadata.version).toBe(SNAPSHOT_FORMAT_VERSION);
      expect(content.metadata.testName).toBe('test-snapshot');
      expect(content.metadata.timestamp).toBeDefined();
      expect(content.actions).toHaveLength(2);
      expect(content.assumedRoles).toHaveLength(1);
    });

    it('should sort actions deterministically', () => {
      const snapshot: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'PutObject' },
          { service: 'lambda', action: 'CreateFunction' },
          { service: 's3', action: 'GetObject' },
        ],
        assumedRoles: [],
      };

      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      writeSnapshot(snapshot, filePath, { testName: 'test' });

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.actions[0]).toEqual({ service: 'lambda', action: 'CreateFunction' });
      expect(content.actions[1]).toEqual({ service: 's3', action: 'GetObject' });
      expect(content.actions[2]).toEqual({ service: 's3', action: 'PutObject' });
    });

    it('should deduplicate actions', () => {
      const snapshot: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'PutObject' },
          { service: 's3', action: 'PutObject' },
          { service: 's3', action: 'GetObject' },
        ],
        assumedRoles: [],
      };

      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      writeSnapshot(snapshot, filePath, { testName: 'test' });

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.actions).toHaveLength(2);
    });

    it('should create parent directories if they do not exist', () => {
      const snapshot: PermissionsSnapshot = { actions: [], assumedRoles: [] };
      const filePath = path.join(tempDir, 'nested', 'dir', 'test.permissions.snapshot.json');

      writeSnapshot(snapshot, filePath, { testName: 'test' });

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should include description in metadata when provided', () => {
      const snapshot: PermissionsSnapshot = { actions: [], assumedRoles: [] };
      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');

      writeSnapshot(snapshot, filePath, {
        testName: 'test',
        description: 'Test description',
      });

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.metadata.description).toBe('Test description');
    });

    it('should use custom indentation', () => {
      const snapshot: PermissionsSnapshot = { actions: [], assumedRoles: [] };
      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');

      writeSnapshot(snapshot, filePath, { testName: 'test', indent: 4 });

      const content = fs.readFileSync(filePath, 'utf-8');
      // With indent of 4, we should see 4 spaces
      expect(content).toContain('    "metadata"');
    });
  });

  describe('writeSnapshotFile', () => {
    it('should write a snapshot file object directly', () => {
      const snapshotFile: SnapshotFile = {
        metadata: {
          version: '1.0',
          testName: 'my-test',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      const filePath = path.join(tempDir, 'test.permissions.snapshot.json');
      writeSnapshotFile(snapshotFile, filePath);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content).toEqual(snapshotFile);
    });
  });

  describe('getSnapshotPath', () => {
    it('should generate correct path for .ts file', () => {
      expect(getSnapshotPath('/path/to/integ.my-test.ts')).toBe(
        '/path/to/integ.my-test.permissions.snapshot.json'
      );
    });

    it('should generate correct path for .js file', () => {
      expect(getSnapshotPath('/path/to/integ.my-test.js')).toBe(
        '/path/to/integ.my-test.permissions.snapshot.json'
      );
    });

    it('should handle files without extension', () => {
      expect(getSnapshotPath('/path/to/integ.my-test')).toBe(
        '/path/to/integ.my-test.permissions.snapshot.json'
      );
    });

    it('should handle paths with .snapshot already in name', () => {
      expect(getSnapshotPath('/path/to/integ.my-test.snapshot')).toBe(
        '/path/to/integ.my-test.permissions.snapshot.json'
      );
    });
  });
});
