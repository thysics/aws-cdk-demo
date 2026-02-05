import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  writePermissionsSnapshot,
  readPermissionsSnapshot,
  safeWritePermissionsSnapshot,
  safeReadPermissionsSnapshot,
} from '../lib/snapshot-writer';
import { PermissionsSnapshot } from '../lib/types';

describe('snapshot-writer', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-snapshot-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('writePermissionsSnapshot', () => {
    it('should write a snapshot file with correct content', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: { 's3:ListBuckets': 1 },
      };

      writePermissionsSnapshot(tempDir, snapshot);

      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(snapshot);
    });

    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'path');
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      writePermissionsSnapshot(nestedDir, snapshot);

      const filePath = path.join(nestedDir, 'permissions.snapshot.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should use custom filename when provided', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      writePermissionsSnapshot(tempDir, snapshot, 'custom.json');

      const filePath = path.join(tempDir, 'custom.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should format JSON with indentation', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: { 's3:ListBuckets': 1, 's3:PutObject': 2 },
      };

      writePermissionsSnapshot(tempDir, snapshot);

      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should be indented and have trailing newline
      expect(content).toContain('\n');
      expect(content.endsWith('\n')).toBe(true);
      expect(content).toMatch(/\s{2}"version"/); // 2-space indent
    });
  });

  describe('readPermissionsSnapshot', () => {
    it('should read an existing snapshot file', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: { 's3:ListBuckets': 1 },
      };

      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(snapshot), 'utf-8');

      const result = readPermissionsSnapshot(tempDir);
      expect(result).toEqual(snapshot);
    });

    it('should return null for non-existent file', () => {
      const result = readPermissionsSnapshot(tempDir);
      expect(result).toBeNull();
    });

    it('should return null for non-existent directory', () => {
      const result = readPermissionsSnapshot(path.join(tempDir, 'nonexistent'));
      expect(result).toBeNull();
    });

    it('should use custom filename when provided', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const filePath = path.join(tempDir, 'custom.json');
      fs.writeFileSync(filePath, JSON.stringify(snapshot), 'utf-8');

      const result = readPermissionsSnapshot(tempDir, 'custom.json');
      expect(result).toEqual(snapshot);
    });

    it('should throw for invalid snapshot format', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, '{"invalid": "data"}', 'utf-8');

      expect(() => readPermissionsSnapshot(tempDir)).toThrow('Invalid permissions snapshot format');
    });

    it('should throw for malformed JSON', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, 'not valid json', 'utf-8');

      expect(() => readPermissionsSnapshot(tempDir)).toThrow();
    });
  });

  describe('safeWritePermissionsSnapshot', () => {
    it('should return true on success', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const result = safeWritePermissionsSnapshot(tempDir, snapshot);
      expect(result).toBe(true);
    });

    it('should return false and not throw on write error', () => {
      // Create a file where we expect a directory
      const invalidPath = path.join(tempDir, 'file-not-dir');
      fs.writeFileSync(invalidPath, 'content');

      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      // Spy on console.error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Try to write to the file as if it were a directory
      const nestedPath = path.join(invalidPath, 'subdir');
      const result = safeWritePermissionsSnapshot(nestedPath, snapshot);

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('safeReadPermissionsSnapshot', () => {
    it('should return snapshot on success', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      writePermissionsSnapshot(tempDir, snapshot);

      const result = safeReadPermissionsSnapshot(tempDir);
      expect(result).toEqual(snapshot);
    });

    it('should return null for non-existent file', () => {
      const result = safeReadPermissionsSnapshot(tempDir);
      expect(result).toBeNull();
    });

    it('should return null and not throw on read error', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, 'invalid json', 'utf-8');

      // Spy on console.error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = safeReadPermissionsSnapshot(tempDir);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('snapshot validation', () => {
    it('should accept valid snapshot with all fields', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: ['role1', 'role2'],
        actions: { action1: 1, action2: 2 },
      };

      writePermissionsSnapshot(tempDir, snapshot);
      const result = readPermissionsSnapshot(tempDir);
      expect(result).toEqual(snapshot);
    });

    it('should accept empty roles and actions', () => {
      const snapshot: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      writePermissionsSnapshot(tempDir, snapshot);
      const result = readPermissionsSnapshot(tempDir);
      expect(result).toEqual(snapshot);
    });

    it('should reject missing version', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify({ roles: [], actions: {} }), 'utf-8');

      expect(() => readPermissionsSnapshot(tempDir)).toThrow('Invalid permissions snapshot format');
    });

    it('should reject missing roles', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify({ version: '1.0', actions: {} }), 'utf-8');

      expect(() => readPermissionsSnapshot(tempDir)).toThrow('Invalid permissions snapshot format');
    });

    it('should reject missing actions', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify({ version: '1.0', roles: [] }), 'utf-8');

      expect(() => readPermissionsSnapshot(tempDir)).toThrow('Invalid permissions snapshot format');
    });

    it('should reject non-string roles', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({ version: '1.0', roles: [123], actions: {} }),
        'utf-8'
      );

      expect(() => readPermissionsSnapshot(tempDir)).toThrow('Invalid permissions snapshot format');
    });

    it('should reject non-number action counts', () => {
      const filePath = path.join(tempDir, 'permissions.snapshot.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({ version: '1.0', roles: [], actions: { action: 'not-a-number' } }),
        'utf-8'
      );

      expect(() => readPermissionsSnapshot(tempDir)).toThrow('Invalid permissions snapshot format');
    });
  });
});
