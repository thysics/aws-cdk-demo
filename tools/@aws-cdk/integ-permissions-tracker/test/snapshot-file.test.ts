/**
 * Unit tests for snapshot file operations.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getPermissionSnapshotPath,
  writePermissionSnapshot,
  readPermissionSnapshot,
  snapshotExists,
  PERMISSION_SNAPSHOT_EXTENSION,
} from '../lib/snapshot-file';
import { PermissionSnapshot } from '../lib/types';

describe('snapshot-file', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getPermissionSnapshotPath', () => {
    test('generates correct path for simple test name', () => {
      const result = getPermissionSnapshotPath('integ.my-test', '/path/to/snapshots');
      expect(result).toBe('/path/to/snapshots/integ.my-test.permissions.snapshot.json');
    });

    test('generates correct path for test name with dots', () => {
      const result = getPermissionSnapshotPath('integ.my.complex.test', '/path/to/snapshots');
      expect(result).toBe('/path/to/snapshots/integ.my.complex.test.permissions.snapshot.json');
    });

    test('generates correct path for test name with hyphens', () => {
      const result = getPermissionSnapshotPath('integ.my-complex-test', '/snapshots');
      expect(result).toBe('/snapshots/integ.my-complex-test.permissions.snapshot.json');
    });

    test('handles relative paths', () => {
      const result = getPermissionSnapshotPath('integ.test', './snapshots');
      expect(result).toBe('snapshots/integ.test.permissions.snapshot.json');
    });

    test('handles empty directory path', () => {
      const result = getPermissionSnapshotPath('integ.test', '');
      expect(result).toBe('integ.test.permissions.snapshot.json');
    });
  });

  describe('writePermissionSnapshot', () => {
    test('writes snapshot to file with correct content', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: {
          s3: ['GetObject', 'PutObject'],
          lambda: ['InvokeFunction'],
        },
      };

      const filePath = path.join(tempDir, 'test.snapshot.json');
      writePermissionSnapshot(filePath, snapshot);

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(snapshot);
    });

    test('creates directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'dir');
      const filePath = path.join(nestedDir, 'test.snapshot.json');
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      writePermissionSnapshot(filePath, snapshot);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('produces deterministic output with sorted keys', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-b', 'role-a'],
        actions: {
          zeta: ['action2', 'action1'],
          alpha: ['xyz', 'abc'],
        },
      };

      const filePath = path.join(tempDir, 'test.snapshot.json');
      writePermissionSnapshot(filePath, snapshot);

      const content = fs.readFileSync(filePath, 'utf-8');
      // check that the content has sorted keys
      const lines = content.split('\n');
      const actionsLineIndex = lines.findIndex(l => l.includes('"actions"'));
      const alphaIndex = lines.findIndex(l => l.includes('"alpha"'));
      const zetaIndex = lines.findIndex(l => l.includes('"zeta"'));

      // alpha should come before zeta in the output
      expect(alphaIndex).toBeLessThan(zetaIndex);
      expect(actionsLineIndex).toBeLessThan(alphaIndex);
    });

    test('appends newline at end of file', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const filePath = path.join(tempDir, 'test.snapshot.json');
      writePermissionSnapshot(filePath, snapshot);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.endsWith('\n')).toBe(true);
    });

    test('overwrites existing file', () => {
      const filePath = path.join(tempDir, 'test.snapshot.json');

      const snapshot1: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a'],
        actions: {},
      };
      writePermissionSnapshot(filePath, snapshot1);

      const snapshot2: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-b'],
        actions: {},
      };
      writePermissionSnapshot(filePath, snapshot2);

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed.roles).toEqual(['role-b']);
    });
  });

  describe('readPermissionSnapshot', () => {
    test('reads snapshot from file', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: {
          s3: ['GetObject'],
        },
      };

      const filePath = path.join(tempDir, 'test.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

      const result = readPermissionSnapshot(filePath);
      expect(result).toEqual(snapshot);
    });

    test('returns undefined for non-existent file', () => {
      const filePath = path.join(tempDir, 'non-existent.json');
      const result = readPermissionSnapshot(filePath);
      expect(result).toBeUndefined();
    });

    test('reads empty snapshot correctly', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const filePath = path.join(tempDir, 'empty.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

      const result = readPermissionSnapshot(filePath);
      expect(result).toEqual(snapshot);
    });

    test('round-trips through write and read', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a', 'role-b'],
        actions: {
          s3: ['GetObject', 'PutObject'],
          lambda: ['InvokeFunction'],
          sts: ['AssumeRole'],
        },
      };

      const filePath = path.join(tempDir, 'roundtrip.snapshot.json');
      writePermissionSnapshot(filePath, snapshot);
      const result = readPermissionSnapshot(filePath);

      expect(result).toEqual(snapshot);
    });
  });

  describe('snapshotExists', () => {
    test('returns true for existing file', () => {
      const filePath = path.join(tempDir, 'exists.json');
      fs.writeFileSync(filePath, '{}', 'utf-8');

      expect(snapshotExists(filePath)).toBe(true);
    });

    test('returns false for non-existent file', () => {
      const filePath = path.join(tempDir, 'does-not-exist.json');
      expect(snapshotExists(filePath)).toBe(false);
    });
  });

  describe('PERMISSION_SNAPSHOT_EXTENSION', () => {
    test('has correct value', () => {
      expect(PERMISSION_SNAPSHOT_EXTENSION).toBe('.permissions.snapshot.json');
    });
  });
});
