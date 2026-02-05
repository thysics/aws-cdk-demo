import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionsRecorder } from '../lib/permissions-recorder';
import {
  assertPermissionsSnapshot,
  checkPermissionsSnapshot,
  updatePermissionsSnapshot,
  assertOrUpdatePermissionsSnapshot,
  getPermissionsDiff,
  isUpdateMode,
  UPDATE_PERMISSIONS_ENV,
} from '../lib/assertion';
import { writePermissionsSnapshot } from '../lib/snapshot-writer';

describe('assertion', () => {
  let tempDir: string;
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-test-'));
    // Create a fresh recorder for each test
    recorder = new PermissionsRecorder();
    PermissionsRecorder.resetGlobalInstance();
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Clear environment variable
    delete process.env[UPDATE_PERMISSIONS_ENV];
  });

  describe('isUpdateMode', () => {
    it('should return false when env var not set', () => {
      delete process.env[UPDATE_PERMISSIONS_ENV];
      expect(isUpdateMode()).toBe(false);
    });

    it('should return true when env var is "true"', () => {
      process.env[UPDATE_PERMISSIONS_ENV] = 'true';
      expect(isUpdateMode()).toBe(true);
    });

    it('should return true when env var is "1"', () => {
      process.env[UPDATE_PERMISSIONS_ENV] = '1';
      expect(isUpdateMode()).toBe(true);
    });

    it('should return false when env var is "false"', () => {
      process.env[UPDATE_PERMISSIONS_ENV] = 'false';
      expect(isUpdateMode()).toBe(false);
    });

    it('should return false when env var is empty string', () => {
      process.env[UPDATE_PERMISSIONS_ENV] = '';
      expect(isUpdateMode()).toBe(false);
    });
  });

  describe('checkPermissionsSnapshot', () => {
    it('should create new snapshot if none exists', () => {
      // Add some recorded data
      recorder.recordedActions.set('s3:ListBuckets', 1);

      const result = checkPermissionsSnapshot(tempDir, { recorder });

      expect(result.passed).toBe(true);
      expect(result.newSnapshot).toBe(true);
      expect(result.message).toContain('Created new permissions snapshot');

      // Verify file was created
      expect(fs.existsSync(path.join(tempDir, 'permissions.snapshot.json'))).toBe(true);
    });

    it('should pass when snapshot matches', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with matching data
      recorder.recordedActions.set('s3:ListBuckets', 1);

      const result = checkPermissionsSnapshot(tempDir, { recorder });

      expect(result.passed).toBe(true);
      expect(result.newSnapshot).toBe(false);
      expect(result.diff).toBeUndefined();
    });

    it('should fail when snapshot differs', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with different data
      recorder.recordedActions.set('s3:DeleteBucket', 1);

      const result = checkPermissionsSnapshot(tempDir, { recorder });

      expect(result.passed).toBe(false);
      expect(result.newSnapshot).toBe(false);
      expect(result.diff).toBeDefined();
      expect(result.diff!.addedActions).toContain('s3:DeleteBucket');
      expect(result.diff!.removedActions).toContain('s3:ListBuckets');
    });

    it('should use global instance by default', () => {
      // Use the global instance
      const globalRecorder = PermissionsRecorder.globalInstance;
      globalRecorder.recordedActions.set('s3:ListBuckets', 1);

      const result = checkPermissionsSnapshot(tempDir);

      expect(result.passed).toBe(true);
      expect(result.newSnapshot).toBe(true);
    });
  });

  describe('assertPermissionsSnapshot', () => {
    it('should not throw when snapshot matches', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with matching data
      recorder.recordedActions.set('s3:ListBuckets', 1);

      expect(() => {
        assertPermissionsSnapshot(tempDir, { recorder });
      }).not.toThrow();
    });

    it('should throw when snapshot differs', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with different data
      recorder.recordedActions.set('s3:DeleteBucket', 1);

      expect(() => {
        assertPermissionsSnapshot(tempDir, { recorder });
      }).toThrow();
    });

    it('should include test name in error message', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: {},
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with different data
      recorder.recordedActions.set('s3:DeleteBucket', 1);

      expect(() => {
        assertPermissionsSnapshot(tempDir, {
          recorder,
          testName: 'integ.lambda.ts',
        });
      }).toThrow(/integ\.lambda\.ts/);
    });

    it('should create new snapshot on first run', () => {
      recorder.recordedActions.set('s3:ListBuckets', 1);

      expect(() => {
        assertPermissionsSnapshot(tempDir, { recorder });
      }).not.toThrow();

      expect(fs.existsSync(path.join(tempDir, 'permissions.snapshot.json'))).toBe(true);
    });
  });

  describe('updatePermissionsSnapshot', () => {
    it('should write current permissions to snapshot', () => {
      recorder.recordedActions.set('s3:ListBuckets', 1);
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/TestRole');

      updatePermissionsSnapshot(tempDir, { recorder });

      const content = fs.readFileSync(
        path.join(tempDir, 'permissions.snapshot.json'),
        'utf-8',
      );
      const snapshot = JSON.parse(content);

      expect(snapshot.actions['s3:ListBuckets']).toBe(1);
      expect(snapshot.roles).toContain('arn:aws:iam::123456789012:role/TestRole');
    });

    it('should overwrite existing snapshot', () => {
      // Create initial snapshot
      const existing = {
        version: '1.0',
        roles: [],
        actions: { 's3:PutObject': 2 },
      };
      writePermissionsSnapshot(tempDir, existing);

      // Update with new data
      recorder.recordedActions.set('s3:ListBuckets', 1);
      updatePermissionsSnapshot(tempDir, { recorder });

      const content = fs.readFileSync(
        path.join(tempDir, 'permissions.snapshot.json'),
        'utf-8',
      );
      const snapshot = JSON.parse(content);

      expect(snapshot.actions['s3:ListBuckets']).toBe(1);
      expect(snapshot.actions['s3:PutObject']).toBeUndefined();
    });
  });

  describe('assertOrUpdatePermissionsSnapshot', () => {
    it('should assert when update mode is not enabled', () => {
      delete process.env[UPDATE_PERMISSIONS_ENV];

      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with different data
      recorder.recordedActions.set('s3:DeleteBucket', 1);

      expect(() => {
        assertOrUpdatePermissionsSnapshot(tempDir, { recorder });
      }).toThrow();
    });

    it('should update when update mode is enabled', () => {
      process.env[UPDATE_PERMISSIONS_ENV] = 'true';

      // Create existing snapshot
      const existing = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, existing);

      // Set up recorder with different data
      recorder.recordedActions.set('s3:DeleteBucket', 1);

      // Should not throw, instead should update
      expect(() => {
        assertOrUpdatePermissionsSnapshot(tempDir, { recorder });
      }).not.toThrow();

      // Verify snapshot was updated
      const content = fs.readFileSync(
        path.join(tempDir, 'permissions.snapshot.json'),
        'utf-8',
      );
      const snapshot = JSON.parse(content);
      expect(snapshot.actions['s3:DeleteBucket']).toBe(1);
      expect(snapshot.actions['s3:ListBuckets']).toBeUndefined();
    });
  });

  describe('getPermissionsDiff', () => {
    it('should return null if no expected snapshot exists', () => {
      recorder.recordedActions.set('s3:ListBuckets', 1);

      const diff = getPermissionsDiff(tempDir, { recorder });

      expect(diff).toBeNull();
    });

    it('should return diff when snapshot exists', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with different data
      recorder.recordedActions.set('s3:DeleteBucket', 1);

      const diff = getPermissionsDiff(tempDir, { recorder });

      expect(diff).not.toBeNull();
      expect(diff!.addedActions).toContain('s3:DeleteBucket');
      expect(diff!.removedActions).toContain('s3:ListBuckets');
    });

    it('should return empty diff when snapshots match', () => {
      // Create expected snapshot
      const expected = {
        version: '1.0',
        roles: [],
        actions: { 's3:ListBuckets': 1 },
      };
      writePermissionsSnapshot(tempDir, expected);

      // Set up recorder with matching data
      recorder.recordedActions.set('s3:ListBuckets', 1);

      const diff = getPermissionsDiff(tempDir, { recorder });

      expect(diff).not.toBeNull();
      expect(diff!.addedActions).toEqual([]);
      expect(diff!.removedActions).toEqual([]);
      expect(diff!.addedRoles).toEqual([]);
      expect(diff!.removedRoles).toEqual([]);
      expect(diff!.changedActionCounts).toEqual([]);
    });
  });
});
