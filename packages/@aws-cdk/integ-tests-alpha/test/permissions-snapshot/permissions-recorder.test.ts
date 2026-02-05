import { PermissionsRecorder, SNAPSHOT_VERSION, getGlobalRecorder, resetGlobalRecorder } from '../../lib/permissions-snapshot/permissions-recorder';

describe('PermissionsRecorder', () => {
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    recorder = new PermissionsRecorder();
    resetGlobalRecorder();
  });

  describe('recording lifecycle', () => {
    test('should start and stop recording', () => {
      expect(recorder.recording).toBe(false);

      recorder.startRecording('test-name');
      expect(recorder.recording).toBe(true);

      const snapshot = recorder.stopRecording();
      expect(recorder.recording).toBe(false);
      expect(snapshot.testName).toBe('test-name');
    });

    test('should throw if starting recording when already recording', () => {
      recorder.startRecording();
      expect(() => recorder.startRecording()).toThrow('Recording is already in progress');
    });

    test('should throw if stopping recording when not recording', () => {
      expect(() => recorder.stopRecording()).toThrow('Recording is not in progress');
    });
  });

  describe('action recording', () => {
    test('should record IAM actions', () => {
      recorder.startRecording();

      recorder.recordAction('s3', 'PutObject');
      recorder.recordAction('s3', 'GetObject');
      recorder.recordAction('lambda', 'Invoke');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(3);
      expect(snapshot.iamActions).toEqual(
        expect.arrayContaining([
          { service: 's3', action: 'PutObject' },
          { service: 's3', action: 'GetObject' },
          { service: 'lambda', action: 'Invoke' },
        ]),
      );
    });

    test('should normalize service names to lowercase', () => {
      recorder.startRecording();

      recorder.recordAction('S3', 'PutObject');
      recorder.recordAction('Lambda', 'Invoke');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions[0].service).toBe('lambda');
      expect(snapshot.iamActions[1].service).toBe('s3');
    });

    test('should deduplicate actions', () => {
      recorder.startRecording();

      recorder.recordAction('s3', 'PutObject');
      recorder.recordAction('s3', 'PutObject');
      recorder.recordAction('s3', 'PutObject');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(1);
    });

    test('should not record actions when not recording', () => {
      recorder.recordAction('s3', 'PutObject');

      recorder.startRecording();
      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(0);
    });

    test('should sort actions by service and action name', () => {
      recorder.startRecording();

      recorder.recordAction('lambda', 'Invoke');
      recorder.recordAction('s3', 'GetObject');
      recorder.recordAction('ec2', 'DescribeInstances');
      recorder.recordAction('s3', 'PutObject');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions.map(a => `${a.service}:${a.action}`)).toEqual([
        'ec2:DescribeInstances',
        'lambda:Invoke',
        's3:GetObject',
        's3:PutObject',
      ]);
    });
  });

  describe('excluded services and actions', () => {
    test('should exclude default cloudwatch service', () => {
      recorder.startRecording();

      recorder.recordAction('cloudwatch', 'PutMetricData');
      recorder.recordAction('s3', 'PutObject');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0].service).toBe('s3');
    });

    test('should exclude default logs actions', () => {
      recorder.startRecording();

      recorder.recordAction('logs', 'CreateLogGroup');
      recorder.recordAction('logs', 'CreateLogStream');
      recorder.recordAction('logs', 'PutLogEvents');
      recorder.recordAction('s3', 'PutObject');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0].service).toBe('s3');
    });

    test('should respect custom excluded services', () => {
      recorder = new PermissionsRecorder({
        excludeServices: ['s3'],
      });

      recorder.startRecording();

      recorder.recordAction('s3', 'PutObject');
      recorder.recordAction('lambda', 'Invoke');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0].service).toBe('lambda');
    });

    test('should respect custom excluded actions', () => {
      recorder = new PermissionsRecorder({
        excludeActions: ['s3:PutObject'],
      });

      recorder.startRecording();

      recorder.recordAction('s3', 'PutObject');
      recorder.recordAction('s3', 'GetObject');

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0].action).toBe('GetObject');
    });
  });

  describe('role assumption recording', () => {
    test('should record role assumptions', () => {
      recorder.startRecording();

      recorder.recordRoleAssumption(
        'arn:aws:iam::123456789012:role/TestRole',
        'test-session',
      );

      const snapshot = recorder.stopRecording();

      expect(snapshot.assumedRoles).toHaveLength(1);
      expect(snapshot.assumedRoles[0]).toEqual({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'test-session',
      });
    });

    test('should deduplicate role assumptions by ARN', () => {
      recorder.startRecording();

      recorder.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');
      recorder.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');

      const snapshot = recorder.stopRecording();

      expect(snapshot.assumedRoles).toHaveLength(1);
    });

    test('should sort role assumptions by ARN', () => {
      recorder.startRecording();

      recorder.recordRoleAssumption('arn:aws:iam::123456789012:role/ZRole');
      recorder.recordRoleAssumption('arn:aws:iam::123456789012:role/ARole');

      const snapshot = recorder.stopRecording();

      expect(snapshot.assumedRoles[0].roleArn).toContain('ARole');
      expect(snapshot.assumedRoles[1].roleArn).toContain('ZRole');
    });

    test('should record external ID when provided', () => {
      recorder.startRecording();

      recorder.recordRoleAssumption(
        'arn:aws:iam::123456789012:role/TestRole',
        'test-session',
        'external-id-123',
      );

      const snapshot = recorder.stopRecording();

      expect(snapshot.assumedRoles[0].externalId).toBe('external-id-123');
    });
  });

  describe('resource ARNs', () => {
    test('should include resource ARNs when enabled', () => {
      recorder = new PermissionsRecorder({
        includeResourceArns: true,
      });

      recorder.startRecording();

      recorder.recordAction('s3', 'PutObject', ['arn:aws:s3:::my-bucket/*']);

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions[0].resources).toEqual(['arn:aws:s3:::my-bucket/*']);
    });

    test('should not include resource ARNs by default', () => {
      recorder.startRecording();

      recorder.recordAction('s3', 'PutObject', ['arn:aws:s3:::my-bucket/*']);

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions[0].resources).toBeUndefined();
    });
  });

  describe('snapshot format', () => {
    test('should include version in snapshot', () => {
      recorder.startRecording();
      const snapshot = recorder.stopRecording();

      expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    });

    test('should not include timestamp by default', () => {
      recorder.startRecording();
      const snapshot = recorder.stopRecording();

      expect(snapshot.timestamp).toBeUndefined();
    });

    test('should include timestamp when enabled', () => {
      recorder = new PermissionsRecorder({
        includeTimestamps: true,
      });

      recorder.startRecording();
      const snapshot = recorder.stopRecording();

      expect(snapshot.timestamp).toBeDefined();
      expect(new Date(snapshot.timestamp!).getTime()).not.toBeNaN();
    });
  });

  describe('global recorder', () => {
    test('should return singleton global recorder', () => {
      const recorder1 = getGlobalRecorder();
      const recorder2 = getGlobalRecorder();

      expect(recorder1).toBe(recorder2);
    });

    test('should reset global recorder', () => {
      const recorder1 = getGlobalRecorder();
      recorder1.startRecording();
      recorder1.recordAction('s3', 'PutObject');

      resetGlobalRecorder();

      const recorder2 = getGlobalRecorder();
      expect(recorder2).not.toBe(recorder1);
      expect(recorder2.recording).toBe(false);
    });
  });

  describe('clear', () => {
    test('should clear all recorded data', () => {
      recorder.startRecording('test');
      recorder.recordAction('s3', 'PutObject');
      recorder.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');
      recorder.stopRecording();

      recorder.clear();

      recorder.startRecording();
      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(0);
      expect(snapshot.assumedRoles).toHaveLength(0);
      expect(snapshot.testName).toBeUndefined();
    });
  });
});
