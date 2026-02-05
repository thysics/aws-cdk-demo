import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  IntegTestPermissionsContext,
  createPermissionsTrackingContext,
  withPermissionsTracking,
} from '../../lib/permissions-snapshot/integ-test-integration';
import { PermissionsTracker } from '../../lib/permissions-snapshot/tracker';
import { SnapshotManager } from '../../lib/permissions-snapshot/snapshot';
import { PermissionsSnapshotError } from '../../lib/permissions-snapshot/snapshot';

describe('IntegTestPermissionsContext', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-test-permissions-'));
    testFilePath = path.join(tempDir, 'integ.my-test.ts');
    // Create an empty test file
    fs.writeFileSync(testFilePath, '');
    PermissionsTracker.clear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    PermissionsTracker.clear();
  });

  describe('start', () => {
    test('initializes the tracker', () => {
      const context = new IntegTestPermissionsContext({ testFilePath });
      context.start();

      expect(PermissionsTracker.getInstance()).toBeDefined();
    });

    test('configures tracker with options', () => {
      const context = new IntegTestPermissionsContext({
        testFilePath,
        excludeServices: ['cloudwatch'],
        excludeActions: ['s3:ListBuckets'],
      });
      context.start();

      const tracker = context.getTracker();
      expect(tracker).toBeDefined();

      // Record some actions to verify exclusions work
      tracker!.recordAction('s3', 'GetObject');
      tracker!.recordAction('cloudwatch', 'PutMetricData');
      tracker!.recordAction('s3', 'ListBuckets');

      const actions = tracker!.getRawActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('s3');
      expect(actions[0].action).toBe('GetObject');
    });
  });

  describe('finish', () => {
    test('throws if tracking was not started', () => {
      const context = new IntegTestPermissionsContext({ testFilePath });

      expect(() => context.finish()).toThrow('Permissions tracking was not started');
    });

    test('generates and saves snapshot when no existing snapshot', () => {
      const context = new IntegTestPermissionsContext({ testFilePath });
      context.start();

      const tracker = context.getTracker()!;
      tracker.recordAction('s3', 'GetObject');

      const result = context.finish();

      expect(result.matched).toBe(true);
      expect(result.updated).toBe(true);
      expect(fs.existsSync(result.snapshotPath)).toBe(true);
    });

    test('returns matched=true when snapshot matches', () => {
      // Create initial snapshot
      const context1 = new IntegTestPermissionsContext({ testFilePath });
      context1.start();
      context1.getTracker()!.recordAction('s3', 'GetObject');
      context1.finish();

      // Run again with same actions
      const context2 = new IntegTestPermissionsContext({ testFilePath });
      context2.start();
      context2.getTracker()!.recordAction('s3', 'GetObject');
      const result = context2.finish();

      expect(result.matched).toBe(true);
      expect(result.updated).toBe(false);
    });

    test('returns matched=false when snapshot differs', () => {
      // Create initial snapshot
      const context1 = new IntegTestPermissionsContext({ testFilePath });
      context1.start();
      context1.getTracker()!.recordAction('s3', 'GetObject');
      context1.finish();

      // Run again with different actions
      const context2 = new IntegTestPermissionsContext({
        testFilePath,
        failOnChange: false,
      });
      context2.start();
      context2.getTracker()!.recordAction('s3', 'PutObject');
      const result = context2.finish();

      expect(result.matched).toBe(false);
      expect(result.changeSummary).toBeDefined();
    });

    test('throws PermissionsSnapshotError when snapshot differs and failOnChange=true', () => {
      // Create initial snapshot
      const context1 = new IntegTestPermissionsContext({ testFilePath });
      context1.start();
      context1.getTracker()!.recordAction('s3', 'GetObject');
      context1.finish();

      // Run again with different actions
      const context2 = new IntegTestPermissionsContext({
        testFilePath,
        failOnChange: true,
      });
      context2.start();
      context2.getTracker()!.recordAction('s3', 'PutObject');

      expect(() => context2.finish()).toThrow(PermissionsSnapshotError);
    });

    test('updates snapshot when updateSnapshot=true and snapshot differs', () => {
      // Create initial snapshot
      const context1 = new IntegTestPermissionsContext({ testFilePath });
      context1.start();
      context1.getTracker()!.recordAction('s3', 'GetObject');
      const result1 = context1.finish();

      // Run again with different actions and update
      const context2 = new IntegTestPermissionsContext({
        testFilePath,
        updateSnapshot: true,
      });
      context2.start();
      context2.getTracker()!.recordAction('s3', 'PutObject');
      const result2 = context2.finish();

      expect(result2.matched).toBe(false);
      expect(result2.updated).toBe(true);

      // Verify the snapshot was updated
      const savedSnapshot = SnapshotManager.load({ filePath: result1.snapshotPath });
      expect(savedSnapshot?.actions.some(a => a.action === 'PutObject')).toBe(true);
    });

    test('uses custom snapshot directory', () => {
      const customDir = path.join(tempDir, 'custom-snapshots');
      fs.mkdirSync(customDir, { recursive: true });

      const context = new IntegTestPermissionsContext({
        testFilePath,
        snapshotDirectory: customDir,
      });
      context.start();
      context.getTracker()!.recordAction('s3', 'GetObject');
      const result = context.finish();

      expect(result.snapshotPath).toContain('custom-snapshots');
      expect(fs.existsSync(result.snapshotPath)).toBe(true);
    });

    test('cleans up tracker after finish', () => {
      const context = new IntegTestPermissionsContext({ testFilePath });
      context.start();
      context.finish();

      expect(PermissionsTracker.getInstance()).toBeUndefined();
    });
  });

  describe('getSnapshotPath', () => {
    test('returns the expected snapshot path', () => {
      const context = new IntegTestPermissionsContext({ testFilePath });
      const snapshotPath = context.getSnapshotPath();

      expect(snapshotPath).toContain('integ.my-test');
      expect(snapshotPath).toContain('.permissions-snapshot.json');
    });
  });
});

describe('createPermissionsTrackingContext', () => {
  test('creates a context with the given options', () => {
    const context = createPermissionsTrackingContext({
      testFilePath: '/test/integ.example.ts',
    });

    expect(context).toBeInstanceOf(IntegTestPermissionsContext);
  });
});

describe('withPermissionsTracking', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-permissions-'));
    testFilePath = path.join(tempDir, 'integ.async-test.ts');
    fs.writeFileSync(testFilePath, '');
    PermissionsTracker.clear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    PermissionsTracker.clear();
  });

  test('runs the function and returns tracking result', async () => {
    const { result, tracking } = await withPermissionsTracking(
      { testFilePath },
      async () => {
        // Simulate some SDK calls
        const tracker = PermissionsTracker.getInstance()!;
        tracker.recordAction('s3', 'GetObject');
        tracker.recordAction('s3', 'PutObject');
        return 'test-result';
      },
    );

    expect(result).toBe('test-result');
    expect(tracking.snapshot.actions).toHaveLength(2);
    expect(tracking.updated).toBe(true);
  });

  test('propagates errors from the function', async () => {
    await expect(
      withPermissionsTracking(
        { testFilePath },
        async () => {
          throw new Error('Test error');
        },
      ),
    ).rejects.toThrow('Test error');
  });

  test('cleans up tracker even on error', async () => {
    try {
      await withPermissionsTracking(
        { testFilePath },
        async () => {
          throw new Error('Test error');
        },
      );
    } catch {
      // Expected
    }

    expect(PermissionsTracker.getInstance()).toBeUndefined();
  });
});
