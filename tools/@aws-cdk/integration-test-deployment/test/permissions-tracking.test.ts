import * as fs from 'fs';
import * as path from 'path';
import { PermissionsCollector } from '@aws-cdk/permissions-tracker';
import {
  PermissionsTrackingManager,
  formatPermissionsError,
  getSnapshotDirectoryForTest,
  getTestNameFromPath,
  PERMISSIONS_SNAPSHOT_FILENAME,
} from '../lib/permissions-tracking';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PermissionsTrackingManager', () => {
  const testSnapshotDir = '/test/snapshots';
  const testName = 'integ.my-test';

  beforeEach(() => {
    jest.clearAllMocks();
    PermissionsCollector.resetInstance();

    // Default mock implementations
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => undefined);
  });

  describe('constructor', () => {
    test('creates with default options', () => {
      const manager = new PermissionsTrackingManager();
      expect(manager.isEnabled()).toBe(true);
      expect(manager.isValidationSkipped()).toBe(false);
      expect(manager.shouldUpdateSnapshot()).toBe(false);
    });

    test('creates with custom options', () => {
      const manager = new PermissionsTrackingManager({
        enabled: false,
        skipValidation: true,
        updateSnapshot: true,
      });
      expect(manager.isEnabled()).toBe(false);
      expect(manager.isValidationSkipped()).toBe(true);
      expect(manager.shouldUpdateSnapshot()).toBe(true);
    });
  });

  describe('initializeForTest', () => {
    test('resets collector when enabled', () => {
      const manager = new PermissionsTrackingManager({ enabled: true });

      // Add some data to collector
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      manager.initializeForTest(testName, testSnapshotDir);

      // Collector should be reset
      const newCollector = PermissionsCollector.getInstance();
      expect(newCollector.getApiCalls()).toHaveLength(0);
    });

    test('does nothing when disabled', () => {
      const manager = new PermissionsTrackingManager({ enabled: false });

      // Add some data to collector
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      manager.initializeForTest(testName, testSnapshotDir);

      // Collector should not be reset (still has data)
      expect(collector.getApiCalls()).toHaveLength(1);
    });
  });

  describe('finalize', () => {
    test('returns success when disabled', () => {
      const manager = new PermissionsTrackingManager({ enabled: false });

      const result = manager.finalize();

      expect(result.passed).toBe(true);
      expect(result.updated).toBe(false);
      expect(result.snapshotPath).toBe('');
    });

    test('saves snapshot and returns success when skipValidation is true', () => {
      const manager = new PermissionsTrackingManager({
        enabled: true,
        skipValidation: true,
      });

      manager.initializeForTest(testName, testSnapshotDir);

      // Add some permissions
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      const result = manager.finalize();

      expect(result.passed).toBe(true);
      expect(result.updated).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    test('fails when no stored snapshot exists and updateSnapshot is false', () => {
      const manager = new PermissionsTrackingManager({
        enabled: true,
        skipValidation: false,
        updateSnapshot: false,
      });

      mockFs.existsSync.mockReturnValue(false);

      manager.initializeForTest(testName, testSnapshotDir);

      const result = manager.finalize();

      expect(result.passed).toBe(false);
      expect(result.diffMessage).toContain('No stored permissions snapshot found');
    });

    test('creates snapshot when no stored snapshot exists and updateSnapshot is true', () => {
      const manager = new PermissionsTrackingManager({
        enabled: true,
        skipValidation: false,
        updateSnapshot: true,
      });

      mockFs.existsSync.mockReturnValue(false);

      manager.initializeForTest(testName, testSnapshotDir);

      // Add some permissions
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      const result = manager.finalize();

      expect(result.passed).toBe(true);
      expect(result.updated).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    test('returns success when snapshots match', () => {
      const manager = new PermissionsTrackingManager({
        enabled: true,
        skipValidation: false,
        updateSnapshot: false,
      });

      const storedSnapshot = {
        version: '1.0',
        testName: testName,
        timestamp: '2024-01-01T00:00:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [
          { service: 's3', action: 'GetObject' },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedSnapshot));

      manager.initializeForTest(testName, testSnapshotDir);

      // Add matching permissions
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      const result = manager.finalize();

      expect(result.passed).toBe(true);
      expect(result.updated).toBe(false);
      expect(result.diff?.identical).toBe(true);
    });

    test('fails when snapshots differ and updateSnapshot is false', () => {
      const manager = new PermissionsTrackingManager({
        enabled: true,
        skipValidation: false,
        updateSnapshot: false,
      });

      const storedSnapshot = {
        version: '1.0',
        testName: testName,
        timestamp: '2024-01-01T00:00:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [
          { service: 's3', action: 'GetObject' },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedSnapshot));

      manager.initializeForTest(testName, testSnapshotDir);

      // Add different permissions
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject', // Different action
        timestamp: new Date(),
      });

      const result = manager.finalize();

      expect(result.passed).toBe(false);
      expect(result.diff?.identical).toBe(false);
      expect(result.diff?.newActions).toHaveLength(1);
      expect(result.diff?.removedActions).toHaveLength(1);
      expect(result.diffMessage).toContain('PERMISSIONS SNAPSHOT MISMATCH');
    });

    test('updates snapshot when snapshots differ and updateSnapshot is true', () => {
      const manager = new PermissionsTrackingManager({
        enabled: true,
        skipValidation: false,
        updateSnapshot: true,
      });

      const storedSnapshot = {
        version: '1.0',
        testName: testName,
        timestamp: '2024-01-01T00:00:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [
          { service: 's3', action: 'GetObject' },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedSnapshot));

      manager.initializeForTest(testName, testSnapshotDir);

      // Add different permissions
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject',
        timestamp: new Date(),
      });

      const result = manager.finalize();

      expect(result.passed).toBe(true);
      expect(result.updated).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getSnapshotPath', () => {
    test('returns correct path', () => {
      const manager = new PermissionsTrackingManager({ enabled: true });
      manager.initializeForTest(testName, testSnapshotDir);

      const snapshotPath = manager.getSnapshotPath();

      expect(snapshotPath).toBe(path.join(testSnapshotDir, PERMISSIONS_SNAPSHOT_FILENAME));
    });

    test('throws when not initialized', () => {
      const manager = new PermissionsTrackingManager({ enabled: true });

      expect(() => manager.getSnapshotPath()).toThrow('snapshot directory not initialized');
    });
  });
});

describe('formatPermissionsError', () => {
  test('formats error message correctly', () => {
    const result = {
      passed: false,
      snapshotPath: '/test/snapshots/permissions.snapshot.json',
      updated: false,
      diffMessage: 'Test diff message',
    };

    const formatted = formatPermissionsError(result);

    expect(formatted).toContain('PERMISSIONS SNAPSHOT MISMATCH');
    expect(formatted).toContain('/test/snapshots/permissions.snapshot.json');
    expect(formatted).toContain('Test diff message');
    expect(formatted).toContain('--update-permissions-snapshot');
    expect(formatted).toContain('--skip-permissions-check');
  });
});

describe('getSnapshotDirectoryForTest', () => {
  test('returns correct snapshot directory', () => {
    const testPath = '/packages/aws-s3/test/integ.bucket.js';
    const snapshotDir = getSnapshotDirectoryForTest(testPath);

    expect(snapshotDir).toBe('/packages/aws-s3/test/integ.bucket.snapshot');
  });

  test('handles .ts extension', () => {
    const testPath = '/packages/aws-s3/test/integ.bucket.ts';
    const snapshotDir = getSnapshotDirectoryForTest(testPath);

    expect(snapshotDir).toBe('/packages/aws-s3/test/integ.bucket.snapshot');
  });
});

describe('getTestNameFromPath', () => {
  test('extracts test name from .js path', () => {
    const testPath = '/packages/aws-s3/test/integ.bucket.js';
    const testName = getTestNameFromPath(testPath);

    expect(testName).toBe('integ.bucket');
  });

  test('extracts test name from .ts path', () => {
    const testPath = '/packages/aws-s3/test/integ.bucket.ts';
    const testName = getTestNameFromPath(testPath);

    expect(testName).toBe('integ.bucket');
  });
});
