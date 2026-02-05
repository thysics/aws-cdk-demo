/**
 * Unit tests for PermissionTracker.
 */

import { PermissionTracker } from '../lib/permission-tracker';

describe('PermissionTracker', () => {
  beforeEach(() => {
    // reset singleton before each test
    PermissionTracker.resetInstance();
  });

  afterEach(() => {
    PermissionTracker.resetInstance();
  });

  describe('getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = PermissionTracker.getInstance();
      const instance2 = PermissionTracker.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create a new instance after reset', () => {
      const instance1 = PermissionTracker.getInstance();
      PermissionTracker.resetInstance();
      const instance2 = PermissionTracker.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('recordCall', () => {
    it('should record a simple service call', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');

      const records = tracker.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].service).toBe('s3');
      expect(records[0].action).toBe('GetObject');
    });

    it('should normalize service name to lowercase', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('S3', 'GetObject');
      tracker.recordCall('LAMBDA', 'InvokeFunction');

      const records = tracker.getRecords();
      expect(records[0].service).toBe('s3');
      expect(records[1].service).toBe('lambda');
    });

    it('should include region when provided', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject', { region: 'us-east-1' });

      const records = tracker.getRecords();
      expect(records[0].region).toBe('us-east-1');
    });

    it('should include roleArn when provided', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject', { roleArn: 'arn:aws:iam::123456789012:role/TestRole' });

      const records = tracker.getRecords();
      expect(records[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
    });

    it('should include timestamp', () => {
      const tracker = PermissionTracker.getInstance();
      const beforeTime = new Date().toISOString();
      tracker.recordCall('s3', 'GetObject');
      const afterTime = new Date().toISOString();

      const records = tracker.getRecords();
      expect(records[0].timestamp).toBeDefined();
      expect(records[0].timestamp >= beforeTime).toBe(true);
      expect(records[0].timestamp <= afterTime).toBe(true);
    });

    it('should record multiple calls', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('s3', 'PutObject');
      tracker.recordCall('lambda', 'InvokeFunction');

      expect(tracker.recordCount).toBe(3);
    });
  });

  describe('recordRoleAssumption', () => {
    it('should record a role assumption', () => {
      const tracker = PermissionTracker.getInstance();
      const roleArn = 'arn:aws:iam::123456789012:role/TestRole';
      tracker.recordRoleAssumption(roleArn);

      const roles = tracker.getAssumedRoles();
      expect(roles).toContain(roleArn);
    });

    it('should also record as an STS call', () => {
      const tracker = PermissionTracker.getInstance();
      const roleArn = 'arn:aws:iam::123456789012:role/TestRole';
      tracker.recordRoleAssumption(roleArn);

      const records = tracker.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].service).toBe('sts');
      expect(records[0].action).toBe('AssumeRole');
      expect(records[0].roleArn).toBe(roleArn);
    });

    it('should deduplicate role assumptions', () => {
      const tracker = PermissionTracker.getInstance();
      const roleArn = 'arn:aws:iam::123456789012:role/TestRole';
      tracker.recordRoleAssumption(roleArn);
      tracker.recordRoleAssumption(roleArn);
      tracker.recordRoleAssumption(roleArn);

      const roles = tracker.getAssumedRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0]).toBe(roleArn);
    });

    it('should track multiple different roles', () => {
      const tracker = PermissionTracker.getInstance();
      const roleArn1 = 'arn:aws:iam::123456789012:role/TestRole1';
      const roleArn2 = 'arn:aws:iam::123456789012:role/TestRole2';
      tracker.recordRoleAssumption(roleArn1);
      tracker.recordRoleAssumption(roleArn2);

      const roles = tracker.getAssumedRoles();
      expect(roles).toHaveLength(2);
      expect(roles).toContain(roleArn1);
      expect(roles).toContain(roleArn2);
    });
  });

  describe('getSnapshot', () => {
    it('should return empty snapshot when no calls recorded', () => {
      const tracker = PermissionTracker.getInstance();
      const snapshot = tracker.getSnapshot();

      expect(snapshot.version).toBe('1.0');
      expect(snapshot.roles).toEqual([]);
      expect(snapshot.actions).toEqual({});
    });

    it('should deduplicate actions in snapshot', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('s3', 'GetObject');

      const snapshot = tracker.getSnapshot();
      expect(snapshot.actions.s3).toHaveLength(1);
      expect(snapshot.actions.s3[0]).toBe('GetObject');
    });

    it('should sort services alphabetically', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('lambda', 'InvokeFunction');
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('ec2', 'DescribeInstances');

      const snapshot = tracker.getSnapshot();
      const services = Object.keys(snapshot.actions);
      expect(services).toEqual(['ec2', 'lambda', 's3']);
    });

    it('should sort actions alphabetically within each service', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'PutObject');
      tracker.recordCall('s3', 'DeleteObject');
      tracker.recordCall('s3', 'GetObject');

      const snapshot = tracker.getSnapshot();
      expect(snapshot.actions.s3).toEqual(['DeleteObject', 'GetObject', 'PutObject']);
    });

    it('should sort roles alphabetically', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/ZRole');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/ARole');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/MRole');

      const snapshot = tracker.getSnapshot();
      expect(snapshot.roles).toEqual([
        'arn:aws:iam::123456789012:role/ARole',
        'arn:aws:iam::123456789012:role/MRole',
        'arn:aws:iam::123456789012:role/ZRole',
      ]);
    });

    it('should produce deterministic output', () => {
      const tracker = PermissionTracker.getInstance();

      // record in random order
      tracker.recordCall('lambda', 'InvokeFunction');
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('ec2', 'DescribeInstances');
      tracker.recordCall('s3', 'PutObject');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/Role2');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/Role1');

      const snapshot1 = tracker.getSnapshot();

      // record again in different order
      tracker.clear();
      tracker.recordCall('ec2', 'DescribeInstances');
      tracker.recordCall('s3', 'PutObject');
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('lambda', 'InvokeFunction');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/Role1');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/Role2');

      const snapshot2 = tracker.getSnapshot();

      // snapshots should be identical
      expect(JSON.stringify(snapshot1)).toBe(JSON.stringify(snapshot2));
    });

    it('should allow custom version', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');

      const snapshot = tracker.getSnapshot({ version: '2.0' });
      expect(snapshot.version).toBe('2.0');
    });
  });

  describe('clear', () => {
    it('should clear all records', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');
      tracker.recordCall('lambda', 'InvokeFunction');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');

      tracker.clear();

      expect(tracker.recordCount).toBe(0);
      expect(tracker.getAssumedRoles()).toEqual([]);
      expect(tracker.isEmpty).toBe(true);
    });
  });

  describe('isEmpty', () => {
    it('should return true when empty', () => {
      const tracker = PermissionTracker.getInstance();
      expect(tracker.isEmpty).toBe(true);
    });

    it('should return false when records exist', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');
      expect(tracker.isEmpty).toBe(false);
    });

    it('should return false when only roles exist', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');
      expect(tracker.isEmpty).toBe(false);
    });
  });

  describe('getRecords', () => {
    it('should return a copy of records', () => {
      const tracker = PermissionTracker.getInstance();
      tracker.recordCall('s3', 'GetObject');

      const records1 = tracker.getRecords();
      const records2 = tracker.getRecords();

      expect(records1).not.toBe(records2);
      expect(records1).toEqual(records2);
    });
  });
});
