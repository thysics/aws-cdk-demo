import { PermissionsRecorder } from '../../lib/assertions/permissions-snapshot/permissions-recorder';
import type { RecordedIamAction, RecordedRoleAssumption } from '../../lib/assertions/permissions-snapshot/types';

describe('PermissionsRecorder', () => {
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    recorder = new PermissionsRecorder();
  });

  describe('recording state', () => {
    test('should not record when not started', () => {
      const action: RecordedIamAction = {
        service: 's3',
        action: 'GetObject',
      };

      recorder.recordAction(action);

      expect(recorder.getActions()).toHaveLength(0);
    });

    test('should record after starting', () => {
      recorder.startRecording();

      const action: RecordedIamAction = {
        service: 's3',
        action: 'GetObject',
      };

      recorder.recordAction(action);

      expect(recorder.getActions()).toHaveLength(1);
    });

    test('should stop recording when stopped', () => {
      recorder.startRecording();
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.stopRecording();
      recorder.recordAction({ service: 's3', action: 'PutObject' });

      expect(recorder.getActions()).toHaveLength(1);
    });

    test('isCurrentlyRecording returns correct state', () => {
      expect(recorder.isCurrentlyRecording()).toBe(false);
      recorder.startRecording();
      expect(recorder.isCurrentlyRecording()).toBe(true);
      recorder.stopRecording();
      expect(recorder.isCurrentlyRecording()).toBe(false);
    });
  });

  describe('action recording', () => {
    beforeEach(() => {
      recorder.startRecording();
    });

    test('should record IAM actions', () => {
      const action: RecordedIamAction = {
        service: 's3',
        action: 'GetObject',
      };

      recorder.recordAction(action);

      const actions = recorder.getActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('s3');
      expect(actions[0].action).toBe('GetObject');
    });

    test('should deduplicate identical actions', () => {
      const action: RecordedIamAction = {
        service: 's3',
        action: 'GetObject',
      };

      recorder.recordAction(action);
      recorder.recordAction(action);
      recorder.recordAction(action);

      expect(recorder.getActions()).toHaveLength(1);
    });

    test('should normalize service names to lowercase', () => {
      recorder.recordAction({ service: 'S3', action: 'GetObject' });
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.recordAction({ service: 'S3', action: 'PutObject' });

      const actions = recorder.getActions();
      expect(actions).toHaveLength(2);
      expect(actions.every(a => a.service === 's3')).toBe(true);
    });

    test('should sort actions by service then action', () => {
      recorder.recordAction({ service: 'sts', action: 'AssumeRole' });
      recorder.recordAction({ service: 's3', action: 'PutObject' });
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.recordAction({ service: 'cloudformation', action: 'CreateStack' });

      const actions = recorder.getActions();
      expect(actions[0]).toMatchObject({ service: 'cloudformation', action: 'CreateStack' });
      expect(actions[1]).toMatchObject({ service: 's3', action: 'GetObject' });
      expect(actions[2]).toMatchObject({ service: 's3', action: 'PutObject' });
      expect(actions[3]).toMatchObject({ service: 'sts', action: 'AssumeRole' });
    });
  });

  describe('role assumption recording', () => {
    beforeEach(() => {
      recorder.startRecording();
    });

    test('should record role assumptions', () => {
      const assumption: RecordedRoleAssumption = {
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      };

      recorder.recordRoleAssumption(assumption);

      const assumptions = recorder.getRoleAssumptions();
      expect(assumptions).toHaveLength(1);
      expect(assumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
    });

    test('should deduplicate identical role assumptions', () => {
      const assumption: RecordedRoleAssumption = {
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      };

      recorder.recordRoleAssumption(assumption);
      recorder.recordRoleAssumption(assumption);

      expect(recorder.getRoleAssumptions()).toHaveLength(1);
    });

    test('should treat role ARNs case-insensitively for deduplication', () => {
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      });
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/testrole',
      });

      expect(recorder.getRoleAssumptions()).toHaveLength(1);
    });

    test('should sort role assumptions by ARN', () => {
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/ZRole',
      });
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/ARole',
      });

      const assumptions = recorder.getRoleAssumptions();
      expect(assumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/ARole');
      expect(assumptions[1].roleArn).toBe('arn:aws:iam::123456789012:role/ZRole');
    });

    test('should include session name if provided', () => {
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'TestSession',
      });

      const assumptions = recorder.getRoleAssumptions();
      expect(assumptions[0].sessionName).toBe('TestSession');
    });
  });

  describe('createSnapshot', () => {
    beforeEach(() => {
      recorder.startRecording();
    });

    test('should create a valid snapshot', () => {
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.recordAction({ service: 's3', action: 'PutObject' });
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      });

      const snapshot = recorder.createSnapshot({ testName: 'test-case' });

      expect(snapshot.version).toBe('1.0.0');
      expect(snapshot.testName).toBe('test-case');
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.actions).toHaveLength(2);
      expect(snapshot.roleAssumptions).toHaveLength(1);
      expect(snapshot.actionSummary).toEqual(['s3:GetObject', 's3:PutObject']);
    });

    test('should create action summary sorted alphabetically', () => {
      recorder.recordAction({ service: 'sts', action: 'AssumeRole' });
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.recordAction({ service: 'cloudformation', action: 'CreateStack' });

      const snapshot = recorder.createSnapshot({ testName: 'test-case' });

      expect(snapshot.actionSummary).toEqual([
        'cloudformation:CreateStack',
        's3:GetObject',
        'sts:AssumeRole',
      ]);
    });
  });

  describe('clear', () => {
    test('should clear all recorded data', () => {
      recorder.startRecording();
      recorder.recordAction({ service: 's3', action: 'GetObject' });
      recorder.recordRoleAssumption({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      });

      recorder.clear();

      expect(recorder.getActions()).toHaveLength(0);
      expect(recorder.getRoleAssumptions()).toHaveLength(0);
    });
  });
});
