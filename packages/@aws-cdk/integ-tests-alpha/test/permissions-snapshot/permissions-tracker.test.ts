import {
  PermissionsTracker,
} from '../../../lib/permissions-snapshot/permissions-tracker';

describe('PermissionsTracker', () => {
  beforeEach(() => {
    PermissionsTracker.resetInstance();
  });

  afterEach(() => {
    PermissionsTracker.resetInstance();
  });

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = PermissionsTracker.getInstance();
      const instance2 = PermissionsTracker.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should accept options on first call', () => {
      const instance = PermissionsTracker.getInstance({
        recordActions: false,
        recordRoleAssumptions: false,
      });
      const options = instance.getOptions();
      expect(options.recordActions).toBe(false);
      expect(options.recordRoleAssumptions).toBe(false);
    });
  });

  describe('resetInstance', () => {
    it('should create a new instance after reset', () => {
      const instance1 = PermissionsTracker.getInstance();
      instance1.startRecording();
      instance1.recordAction('s3', 'PutObject');
      
      PermissionsTracker.resetInstance();
      
      const instance2 = PermissionsTracker.getInstance();
      expect(instance2.getRecordedActions()).toHaveLength(0);
    });
  });

  describe('recording lifecycle', () => {
    it('should not record when not started', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.recordAction('s3', 'PutObject');
      expect(tracker.getRecordedActions()).toHaveLength(0);
    });

    it('should record after starting', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      expect(tracker.getRecordedActions()).toHaveLength(1);
    });

    it('should not record after stopping', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      tracker.stopRecording();
      tracker.recordAction('s3', 'GetObject');
      expect(tracker.getRecordedActions()).toHaveLength(1);
    });

    it('should report recording state', () => {
      const tracker = PermissionsTracker.getInstance();
      expect(tracker.recording).toBe(false);
      tracker.startRecording();
      expect(tracker.recording).toBe(true);
      tracker.stopRecording();
      expect(tracker.recording).toBe(false);
    });

    it('should clear previous recordings on start', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      tracker.stopRecording();
      
      tracker.startRecording();
      expect(tracker.getRecordedActions()).toHaveLength(0);
    });
  });

  describe('recordAction', () => {
    it('should record action with service and action name', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      
      const actions = tracker.getRecordedActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('s3');
      expect(actions[0].action).toBe('PutObject');
    });

    it('should record action with optional resource', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject', 'arn:aws:s3:::my-bucket/*');
      
      const actions = tracker.getRecordedActions();
      expect(actions[0].resource).toBe('arn:aws:s3:::my-bucket/*');
    });

    it('should include timestamp', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      
      const actions = tracker.getRecordedActions();
      expect(actions[0].timestamp).toBeDefined();
      expect(new Date(actions[0].timestamp).getTime()).not.toBeNaN();
    });

    it('should normalize service names', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('S3', 'PutObject');
      tracker.recordAction('@aws-sdk/client-s3', 'GetObject');
      
      const actions = tracker.getRecordedActions();
      expect(actions[0].service).toBe('s3');
      expect(actions[1].service).toBe('s3');
    });

    it('should respect ignoreActions option', () => {
      PermissionsTracker.resetInstance();
      const tracker = PermissionsTracker.getInstance({
        ignoreActions: ['sts:GetCallerIdentity'],
      });
      tracker.startRecording();
      tracker.recordAction('sts', 'GetCallerIdentity');
      tracker.recordAction('sts', 'AssumeRole');
      
      const actions = tracker.getRecordedActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('AssumeRole');
    });

    it('should not record when recordActions is false', () => {
      PermissionsTracker.resetInstance();
      const tracker = PermissionsTracker.getInstance({
        recordActions: false,
      });
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      
      expect(tracker.getRecordedActions()).toHaveLength(0);
    });
  });

  describe('recordRoleAssumption', () => {
    it('should record role assumption', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/MyRole');
      
      const assumptions = tracker.getRecordedRoleAssumptions();
      expect(assumptions).toHaveLength(1);
      expect(assumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/MyRole');
    });

    it('should record role session name and source identity', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordRoleAssumption(
        'arn:aws:iam::123456789012:role/MyRole',
        'test-session',
        'source-id',
      );
      
      const assumptions = tracker.getRecordedRoleAssumptions();
      expect(assumptions[0].roleSessionName).toBe('test-session');
      expect(assumptions[0].sourceIdentity).toBe('source-id');
    });

    it('should respect ignoreRoles option', () => {
      PermissionsTracker.resetInstance();
      const tracker = PermissionsTracker.getInstance({
        ignoreRoles: ['bootstrap'],
      });
      tracker.startRecording();
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/cdk-bootstrap-role');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/MyRole');
      
      const assumptions = tracker.getRecordedRoleAssumptions();
      expect(assumptions).toHaveLength(1);
      expect(assumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/MyRole');
    });

    it('should not record when recordRoleAssumptions is false', () => {
      PermissionsTracker.resetInstance();
      const tracker = PermissionsTracker.getInstance({
        recordRoleAssumptions: false,
      });
      tracker.startRecording();
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/MyRole');
      
      expect(tracker.getRecordedRoleAssumptions()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all recorded data', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      tracker.recordAction('s3', 'PutObject');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/MyRole');
      
      tracker.clear();
      
      expect(tracker.getRecordedActions()).toHaveLength(0);
      expect(tracker.getRecordedRoleAssumptions()).toHaveLength(0);
    });
  });
});
