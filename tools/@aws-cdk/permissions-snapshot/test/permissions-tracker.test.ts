import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { PermissionsTracker } from '../lib';

// Mock the AWS SDK clients
const s3Mock = mockClient(S3Client);
const stsMock = mockClient(STSClient);

describe('PermissionsTracker', () => {
  beforeEach(() => {
    // Reset the singleton before each test
    PermissionsTracker.resetInstance();
    s3Mock.reset();
    stsMock.reset();

    // Set up default mock responses
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined });
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: 'AKIA...',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
        Expiration: new Date(),
      },
    });
  });

  afterEach(() => {
    PermissionsTracker.resetInstance();
  });

  describe('singleton behavior', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = PermissionsTracker.getInstance();
      const instance2 = PermissionsTracker.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should reset the instance correctly', () => {
      const instance1 = PermissionsTracker.getInstance();
      PermissionsTracker.resetInstance();
      const instance2 = PermissionsTracker.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('createIsolated', () => {
    it('should create an independent instance', () => {
      const singleton = PermissionsTracker.getInstance();
      const isolated = PermissionsTracker.createIsolated();

      expect(singleton).not.toBe(isolated);
    });

    it('should not affect singleton state', async () => {
      const singleton = PermissionsTracker.getInstance();
      const isolated = PermissionsTracker.createIsolated();

      const s3Client = new S3Client({ region: 'us-east-1' });
      isolated.registerClient(s3Client);
      isolated.start();

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test',
      }));

      isolated.stop();

      // Isolated instance should have the recorded action
      expect(isolated.getRecordedPermissions().actions).toHaveLength(1);

      // Singleton should not be affected
      expect(singleton.getRecordedPermissions().actions).toHaveLength(0);
    });
  });

  describe('start/stop', () => {
    it('should track recording state correctly', () => {
      const tracker = PermissionsTracker.createIsolated();

      expect(tracker.isRecording()).toBe(false);

      tracker.start();
      expect(tracker.isRecording()).toBe(true);

      tracker.stop();
      expect(tracker.isRecording()).toBe(false);
    });

    it('should not record actions when stopped', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      tracker.registerClient(s3Client);

      // Don't start tracking
      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test',
      }));

      expect(tracker.getRecordedPermissions().actions).toHaveLength(0);
    });

    it('should record actions when started', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      tracker.registerClient(s3Client);

      tracker.start();
      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test',
      }));
      tracker.stop();

      expect(tracker.getRecordedPermissions().actions).toHaveLength(1);
    });
  });

  describe('registerClient/unregisterClient', () => {
    it('should track registered clients count', () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      const stsClient = new STSClient({ region: 'us-east-1' });

      expect(tracker.getRegisteredClientCount()).toBe(0);

      tracker.registerClient(s3Client);
      expect(tracker.getRegisteredClientCount()).toBe(1);

      tracker.registerClient(stsClient);
      expect(tracker.getRegisteredClientCount()).toBe(2);
    });

    it('should not register the same client twice', () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });

      tracker.registerClient(s3Client);
      tracker.registerClient(s3Client);

      expect(tracker.getRegisteredClientCount()).toBe(1);
    });

    it('should unregister clients correctly', () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });

      tracker.registerClient(s3Client);
      expect(tracker.getRegisteredClientCount()).toBe(1);

      const result = tracker.unregisterClient(s3Client);
      expect(result).toBe(true);
      expect(tracker.getRegisteredClientCount()).toBe(0);
    });

    it('should return false when unregistering non-registered client', () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });

      const result = tracker.unregisterClient(s3Client);
      expect(result).toBe(false);
    });
  });

  describe('getRecordedPermissions', () => {
    it('should return deduplicated actions', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      tracker.registerClient(s3Client);
      tracker.start();

      // Make the same call multiple times
      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key1',
        Body: 'test',
      }));
      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key2',
        Body: 'test',
      }));
      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key3',
        Body: 'test',
      }));

      const snapshot = tracker.getRecordedPermissions();

      // Should be deduplicated to just one action
      expect(snapshot.actions).toHaveLength(1);
      expect(snapshot.actions[0]).toEqual({
        service: 's3',
        action: 'PutObject',
      });
    });

    it('should return sorted actions', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      const stsClient = new STSClient({ region: 'us-east-1' });
      tracker.registerClient(s3Client);
      tracker.registerClient(stsClient);
      tracker.start();

      // Make calls in non-alphabetical order
      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
        Body: 'test',
      }));
      await s3Client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
      }));
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        RoleSessionName: 'test',
      }));

      const snapshot = tracker.getRecordedPermissions();

      // Should be sorted by service, then by action
      expect(snapshot.actions).toEqual([
        { service: 's3', action: 'GetObject' },
        { service: 's3', action: 'PutObject' },
        { service: 'sts', action: 'AssumeRole' },
      ]);
    });

    it('should return deduplicated and sorted assumed roles', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const stsClient = new STSClient({ region: 'us-east-1' });
      tracker.registerClient(stsClient);
      tracker.start();

      // Assume roles in non-alphabetical order, with duplicates
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/RoleB',
        RoleSessionName: 'test',
      }));
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/RoleA',
        RoleSessionName: 'test',
      }));
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/RoleB',
        RoleSessionName: 'test',
      }));

      const snapshot = tracker.getRecordedPermissions();

      // Should be deduplicated and sorted by ARN
      expect(snapshot.assumedRoles).toEqual([
        { roleArn: 'arn:aws:iam::123456789012:role/RoleA', assumedVia: 'AssumeRole' },
        { roleArn: 'arn:aws:iam::123456789012:role/RoleB', assumedVia: 'AssumeRole' },
      ]);
    });
  });

  describe('clear', () => {
    it('should clear all recorded data', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      tracker.registerClient(s3Client);
      tracker.start();

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
        Body: 'test',
      }));

      expect(tracker.getRecordedPermissions().actions).toHaveLength(1);

      tracker.clear();

      expect(tracker.getRecordedPermissions().actions).toHaveLength(0);
      expect(tracker.getRecordedPermissions().assumedRoles).toHaveLength(0);
    });

    it('should not affect tracking state', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      tracker.registerClient(s3Client);
      tracker.start();

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key1',
        Body: 'test',
      }));

      tracker.clear();

      // Should still be recording
      expect(tracker.isRecording()).toBe(true);

      await s3Client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key1',
      }));

      expect(tracker.getRecordedPermissions().actions).toHaveLength(1);
    });
  });

  describe('exclusions', () => {
    it('should exclude services when specified', async () => {
      const tracker = PermissionsTracker.createIsolated({
        excludeServices: ['s3'],
      });
      const s3Client = new S3Client({ region: 'us-east-1' });
      const stsClient = new STSClient({ region: 'us-east-1' });
      tracker.registerClient(s3Client);
      tracker.registerClient(stsClient);
      tracker.start();

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
        Body: 'test',
      }));
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        RoleSessionName: 'test',
      }));

      const snapshot = tracker.getRecordedPermissions();

      // S3 should be excluded, only STS recorded
      expect(snapshot.actions).toEqual([
        { service: 'sts', action: 'AssumeRole' },
      ]);
    });

    it('should exclude specific actions when specified', async () => {
      const tracker = PermissionsTracker.createIsolated({
        excludeActions: ['s3:PutObject'],
      });
      const s3Client = new S3Client({ region: 'us-east-1' });
      tracker.registerClient(s3Client);
      tracker.start();

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
        Body: 'test',
      }));
      await s3Client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
      }));

      const snapshot = tracker.getRecordedPermissions();

      // PutObject should be excluded, only GetObject recorded
      expect(snapshot.actions).toEqual([
        { service: 's3', action: 'GetObject' },
      ]);
    });
  });

  describe('multi-client tracking', () => {
    it('should track actions across multiple clients', async () => {
      const tracker = PermissionsTracker.createIsolated();
      const s3Client = new S3Client({ region: 'us-east-1' });
      const stsClient = new STSClient({ region: 'us-east-1' });

      tracker.registerClient(s3Client);
      tracker.registerClient(stsClient);
      tracker.start();

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'key',
        Body: 'test',
      }));
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        RoleSessionName: 'test',
      }));

      const snapshot = tracker.getRecordedPermissions();

      expect(snapshot.actions).toHaveLength(2);
      expect(snapshot.assumedRoles).toHaveLength(1);
    });
  });
});
