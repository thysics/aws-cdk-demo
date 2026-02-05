import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  IntegTestPermissionsHelper,
  createPermissionsHelper,
  withPermissionsRecording,
} from '../../lib/assertions/permissions-snapshot/integ-test-helper';

describe('IntegTestPermissionsHelper', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-test-permissions-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('when disabled', () => {
    test('should return passed without doing anything', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: false,
      });

      helper.startRecording();
      const result = helper.stopAndValidate();

      expect(result.passed).toBe(true);
      expect(result.snapshot.actions).toHaveLength(0);
    });

    test('isEnabled should return false', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: false,
      });

      expect(helper.isEnabled()).toBe(false);
    });
  });

  describe('when enabled', () => {
    test('isEnabled should return true', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      expect(helper.isEnabled()).toBe(true);
    });

    test('should record and create snapshot', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      helper.startRecording();

      // Manually record some actions for testing
      const recorder = helper.getRecorder();
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.recordAction({ service: 's3', action: 'PutObject' });
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      });

      const result = helper.stopAndValidate();

      expect(result.passed).toBe(true);
      expect(result.snapshot.actions).toHaveLength(2);
      expect(result.snapshot.roleAssumptions).toHaveLength(1);
      expect(result.isNewSnapshot).toBe(true);

      // Verify snapshot file was created
      expect(fs.existsSync(path.join(tempDir, 'permissions.snapshot.json'))).toBe(true);
    });

    test('should detect changes from baseline', () => {
      // Create baseline snapshot
      const baselineHelper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      baselineHelper.startRecording();
      baselineHelper.getRecorder().recordAction({ service: 's3', action: 'GetObject' });
      baselineHelper.stopAndValidate();

      // Now run with different actions
      const currentHelper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
        failOnChanges: true,
      });

      currentHelper.startRecording();
      currentHelper.getRecorder().recordAction({ service: 's3', action: 'GetObject' });
      currentHelper.getRecorder().recordAction({ service: 's3', action: 'PutObject' });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = currentHelper.stopAndValidate();
      consoleSpy.mockRestore();

      expect(result.passed).toBe(false);
      expect(result.summary).toContain('Added IAM Actions');
      expect(result.summary).toContain('s3:PutObject');
    });

    test('should update snapshot when updateSnapshot is true', () => {
      // Create baseline snapshot
      const baselineHelper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      baselineHelper.startRecording();
      baselineHelper.getRecorder().recordAction({ service: 's3', action: 'GetObject' });
      baselineHelper.stopAndValidate();

      // Now run with different actions and update enabled
      const currentHelper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
        updateSnapshot: true,
      });

      currentHelper.startRecording();
      currentHelper.getRecorder().recordAction({ service: 's3', action: 'GetObject' });
      currentHelper.getRecorder().recordAction({ service: 's3', action: 'PutObject' });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = currentHelper.stopAndValidate();
      consoleSpy.mockRestore();

      expect(result.passed).toBe(true);

      // Verify snapshot was updated
      const snapshotContent = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'permissions.snapshot.json'), 'utf-8'),
      );
      expect(snapshotContent.actions).toHaveLength(2);
    });
  });

  describe('clearRecordings', () => {
    test('should clear all recordings', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      helper.startRecording();
      helper.getRecorder().recordAction({ service: 's3', action: 'GetObject' });
      helper.clearRecordings();

      const recorder = helper.getRecorder();
      expect(recorder.getActions()).toHaveLength(0);
    });
  });

  describe('getInterceptorPlugin', () => {
    test('should return a valid plugin', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      const plugin = helper.getInterceptorPlugin();
      expect(plugin).toBeDefined();
      expect(plugin.applyToStack).toBeDefined();
    });
  });

  describe('applyInterceptorTo', () => {
    test('should apply interceptor to client', () => {
      const helper = new IntegTestPermissionsHelper({
        testName: 'test-case',
        snapshotDir: tempDir,
        enabled: true,
      });

      const mockUse = jest.fn();
      const mockClient = {
        middlewareStack: {
          use: mockUse,
        },
      };

      helper.applyInterceptorTo(mockClient);
      expect(mockUse).toHaveBeenCalled();
    });
  });
});

describe('createPermissionsHelper', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-permissions-helper-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT;
    delete process.env.CDK_INTEG_UPDATE_PERMISSIONS_SNAPSHOT;
  });

  test('should create helper with env vars', () => {
    process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT = 'true';

    const helper = createPermissionsHelper('test-case', tempDir);

    expect(helper.isEnabled()).toBe(true);
  });

  test('should create disabled helper when env var not set', () => {
    const helper = createPermissionsHelper('test-case', tempDir);

    expect(helper.isEnabled()).toBe(false);
  });
});

describe('withPermissionsRecording', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-permissions-recording-'));
    process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT = 'true';
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.CDK_INTEG_PERMISSIONS_SNAPSHOT;
  });

  test('should run test function and return validation result', async () => {
    let testExecuted = false;

    const result = await withPermissionsRecording('test-case', tempDir, async () => {
      testExecuted = true;
    });

    expect(testExecuted).toBe(true);
    expect(result.passed).toBe(true);
  });

  test('should still stop recording if test throws', async () => {
    const error = new Error('Test failed');

    await expect(
      withPermissionsRecording('test-case', tempDir, async () => {
        throw error;
      }),
    ).rejects.toThrow('Test failed');
  });
});
