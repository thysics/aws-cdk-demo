import { STSClient } from '@aws-sdk/client-sts';
import { PermissionTracker } from '@aws-cdk/integ-permissions-tracker';
import * as permissionTracking from '../lib/permission-tracking';
import * as snapshotFile from '@aws-cdk/integ-permissions-tracker';

// mock the integ-permissions-tracker module
jest.mock('@aws-cdk/integ-permissions-tracker', () => {
  const originalModule = jest.requireActual('@aws-cdk/integ-permissions-tracker');

  // create a mock tracker class
  class MockPermissionTracker {
    private static instance: MockPermissionTracker | undefined;
    private records: Array<{ service: string; action: string }> = [];
    private assumedRoles: Set<string> = new Set();

    static getInstance() {
      if (!MockPermissionTracker.instance) {
        MockPermissionTracker.instance = new MockPermissionTracker();
      }
      return MockPermissionTracker.instance;
    }

    static resetInstance() {
      MockPermissionTracker.instance = undefined;
    }

    recordCall(service: string, action: string) {
      this.records.push({ service, action });
    }

    recordRoleAssumption(roleArn: string) {
      this.assumedRoles.add(roleArn);
    }

    getSnapshot() {
      const actions: Record<string, string[]> = {};
      for (const record of this.records) {
        if (!actions[record.service]) {
          actions[record.service] = [];
        }
        if (!actions[record.service].includes(record.action)) {
          actions[record.service].push(record.action);
        }
      }
      return {
        version: '1.0',
        roles: Array.from(this.assumedRoles).sort(),
        actions,
      };
    }

    clear() {
      this.records = [];
      this.assumedRoles.clear();
    }

    get isEmpty() {
      return this.records.length === 0 && this.assumedRoles.size === 0;
    }
  }

  return {
    ...originalModule,
    PermissionTracker: MockPermissionTracker,
    createPermissionTrackerPlugin: jest.fn(() => ({
      applyToStack: jest.fn(),
    })),
    getPermissionSnapshotPath: jest.fn((testName: string, dir: string) => `${dir}/${testName}.permissions.snapshot.json`),
    writePermissionSnapshot: jest.fn(),
    readPermissionSnapshot: jest.fn(),
    compareSnapshots: jest.fn(),
    formatSnapshotDiff: jest.fn(),
  };
});

describe('Permission Tracking', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // reset environment variables
    delete process.env.CDK_INTEG_TRACK_PERMISSIONS;
    delete process.env.CDK_INTEG_UPDATE_PERMISSIONS;
    // reset tracker instance
    (PermissionTracker as any).resetInstance();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isPermissionTrackingEnabled', () => {
    it('returns false when not enabled', () => {
      expect(permissionTracking.isPermissionTrackingEnabled()).toBe(false);
    });

    it('returns true when enabled via options', () => {
      expect(permissionTracking.isPermissionTrackingEnabled({ enabled: true })).toBe(true);
    });

    it('returns false when disabled via options', () => {
      process.env.CDK_INTEG_TRACK_PERMISSIONS = 'true';
      expect(permissionTracking.isPermissionTrackingEnabled({ enabled: false })).toBe(false);
    });

    it('returns true when env var is "true"', () => {
      process.env.CDK_INTEG_TRACK_PERMISSIONS = 'true';
      expect(permissionTracking.isPermissionTrackingEnabled()).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env.CDK_INTEG_TRACK_PERMISSIONS = '1';
      expect(permissionTracking.isPermissionTrackingEnabled()).toBe(true);
    });

    it('returns false when env var is other value', () => {
      process.env.CDK_INTEG_TRACK_PERMISSIONS = 'false';
      expect(permissionTracking.isPermissionTrackingEnabled()).toBe(false);
    });
  });

  describe('isUpdateSnapshotsEnabled', () => {
    it('returns false when not enabled', () => {
      expect(permissionTracking.isUpdateSnapshotsEnabled()).toBe(false);
    });

    it('returns true when enabled via options', () => {
      expect(permissionTracking.isUpdateSnapshotsEnabled({ updateSnapshots: true })).toBe(true);
    });

    it('returns true when env var is "true"', () => {
      process.env.CDK_INTEG_UPDATE_PERMISSIONS = 'true';
      expect(permissionTracking.isUpdateSnapshotsEnabled()).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env.CDK_INTEG_UPDATE_PERMISSIONS = '1';
      expect(permissionTracking.isUpdateSnapshotsEnabled()).toBe(true);
    });
  });

  describe('initializePermissionTracking', () => {
    it('returns undefined when tracking is disabled', () => {
      const result = permissionTracking.initializePermissionTracking({ enabled: false });
      expect(result).toBeUndefined();
    });

    it('returns context when tracking is enabled', () => {
      const result = permissionTracking.initializePermissionTracking({ enabled: true });
      expect(result).toBeDefined();
      expect(result?.tracker).toBeDefined();
      expect(result?.cleanup).toBeInstanceOf(Function);
    });

    it('cleanup function clears the tracker', () => {
      const context = permissionTracking.initializePermissionTracking({ enabled: true });
      expect(context).toBeDefined();

      // record something
      context!.tracker.recordCall('s3', 'GetObject');

      // cleanup should clear
      context!.cleanup();
      expect(context!.tracker.isEmpty).toBe(true);
    });
  });

  describe('instrumentStsClient', () => {
    it('adds middleware to STS client', () => {
      const mockClient = {
        middlewareStack: {
          use: jest.fn(),
        },
      } as unknown as STSClient;

      permissionTracking.instrumentStsClient(mockClient);

      expect(mockClient.middlewareStack.use).toHaveBeenCalled();
    });
  });

  describe('clearPermissionTracker', () => {
    it('clears the tracker', () => {
      const context = permissionTracking.initializePermissionTracking({ enabled: true });
      context!.tracker.recordCall('lambda', 'InvokeFunction');

      permissionTracking.clearPermissionTracker(context!.tracker);

      expect(context!.tracker.isEmpty).toBe(true);
    });
  });

  describe('finalizePermissionTracking', () => {
    beforeEach(() => {
      (snapshotFile.readPermissionSnapshot as jest.Mock).mockReturnValue(undefined);
      (snapshotFile.compareSnapshots as jest.Mock).mockReturnValue({ hasChanges: false });
    });

    it('returns passed when no permissions recorded', async () => {
      const context = permissionTracking.initializePermissionTracking({ enabled: true });
      expect(context).toBeDefined();

      const result = await permissionTracking.finalizePermissionTracking(
        'integ.test',
        '/path/to/snapshots',
        {}
      );

      expect(result.passed).toBe(true);
      expect(result.message).toContain('No permissions recorded');
    });

    it('writes snapshot in update mode', async () => {
      const context = permissionTracking.initializePermissionTracking({ enabled: true });
      context!.tracker.recordCall('s3', 'GetObject');

      const result = await permissionTracking.finalizePermissionTracking(
        'integ.test',
        '/path/to/snapshots',
        { updateSnapshots: true }
      );

      expect(result.passed).toBe(true);
      expect(snapshotFile.writePermissionSnapshot).toHaveBeenCalled();
    });

    it('compares with baseline in validation mode', async () => {
      const context = permissionTracking.initializePermissionTracking({ enabled: true });
      context!.tracker.recordCall('s3', 'GetObject');

      (snapshotFile.compareSnapshots as jest.Mock).mockReturnValue({ hasChanges: false });

      const result = await permissionTracking.finalizePermissionTracking(
        'integ.test',
        '/path/to/snapshots',
        { updateSnapshots: false }
      );

      expect(result.passed).toBe(true);
      expect(snapshotFile.readPermissionSnapshot).toHaveBeenCalled();
      expect(snapshotFile.compareSnapshots).toHaveBeenCalled();
    });

    it('returns failure when snapshot has changes', async () => {
      const context = permissionTracking.initializePermissionTracking({ enabled: true });
      context!.tracker.recordCall('s3', 'GetObject');

      (snapshotFile.compareSnapshots as jest.Mock).mockReturnValue({
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: ['s3'],
        removedServices: [],
        addedActions: { s3: ['GetObject'] },
        removedActions: {},
      });
      (snapshotFile.formatSnapshotDiff as jest.Mock).mockReturnValue('Diff output');

      const result = await permissionTracking.finalizePermissionTracking(
        'integ.test',
        '/path/to/snapshots',
        { updateSnapshots: false }
      );

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Permission snapshot mismatch');
    });
  });

  describe('getSnapshotDirectory', () => {
    it('generates snapshot directory from test path', () => {
      const result = permissionTracking.getSnapshotDirectory('/path/to/test/integ.my-test.ts');
      expect(result).toBe('/path/to/test/integ.my-test.integ.snapshot');
    });

    it('handles .js extension', () => {
      const result = permissionTracking.getSnapshotDirectory('/path/to/test/integ.my-test.js');
      expect(result).toBe('/path/to/test/integ.my-test.integ.snapshot');
    });
  });

  describe('getTestName', () => {
    it('extracts test name from path', () => {
      const result = permissionTracking.getTestName('/path/to/test/integ.my-test.ts');
      expect(result).toBe('integ.my-test');
    });

    it('handles .js extension', () => {
      const result = permissionTracking.getTestName('/path/to/test/integ.my-test.js');
      expect(result).toBe('integ.my-test');
    });

    it('handles complex test names', () => {
      const result = permissionTracking.getTestName('/path/to/test/integ.lambda-function-url.ts');
      expect(result).toBe('integ.lambda-function-url');
    });
  });

  describe('shouldSkipPermissionTracking', () => {
    it('returns true for dry-run mode', () => {
      expect(permissionTracking.shouldSkipPermissionTracking(true, false)).toBe(true);
    });

    it('returns true for snapshot-only mode', () => {
      expect(permissionTracking.shouldSkipPermissionTracking(false, true)).toBe(true);
    });

    it('returns false when not in special modes', () => {
      expect(permissionTracking.shouldSkipPermissionTracking(false, false)).toBe(false);
    });

    it('returns false with no arguments', () => {
      expect(permissionTracking.shouldSkipPermissionTracking()).toBe(false);
    });
  });
});
