import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import {
  createPermissionsMiddlewarePlugin,
  removePermissionsMiddleware,
  RecordedAction,
  RecordedRole,
} from '../lib';

// Mock the AWS SDK clients
const s3Mock = mockClient(S3Client);
const stsMock = mockClient(STSClient);

describe('SDK Middleware', () => {
  let recordedActions: RecordedAction[];
  let recordedRoles: RecordedRole[];

  beforeEach(() => {
    recordedActions = [];
    recordedRoles = [];
    s3Mock.reset();
    stsMock.reset();
  });

  describe('createPermissionsMiddlewarePlugin', () => {
    it('should intercept S3 API calls and record actions', async () => {
      const plugin = createPermissionsMiddlewarePlugin({
        onAction: (action) => recordedActions.push(action),
        onRole: (role) => recordedRoles.push(role),
      });

      const client = new S3Client({ region: 'us-east-1' });
      client.middlewareStack.use(plugin);

      s3Mock.on(PutObjectCommand).resolves({});

      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test-body',
      }));

      expect(recordedActions).toHaveLength(1);
      expect(recordedActions[0]).toEqual({
        service: 's3',
        action: 'PutObject',
      });
      expect(recordedRoles).toHaveLength(0);
    });

    it('should record multiple different actions from the same client', async () => {
      const plugin = createPermissionsMiddlewarePlugin({
        onAction: (action) => recordedActions.push(action),
        onRole: (role) => recordedRoles.push(role),
      });

      const client = new S3Client({ region: 'us-east-1' });
      client.middlewareStack.use(plugin);

      s3Mock.on(PutObjectCommand).resolves({});
      s3Mock.on(GetObjectCommand).resolves({
        Body: undefined,
      });

      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test-body',
      }));

      await client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
      }));

      expect(recordedActions).toHaveLength(2);
      expect(recordedActions).toContainEqual({ service: 's3', action: 'PutObject' });
      expect(recordedActions).toContainEqual({ service: 's3', action: 'GetObject' });
    });

    it('should intercept STS AssumeRole and record role ARN', async () => {
      const plugin = createPermissionsMiddlewarePlugin({
        onAction: (action) => recordedActions.push(action),
        onRole: (role) => recordedRoles.push(role),
      });

      const client = new STSClient({ region: 'us-east-1' });
      client.middlewareStack.use(plugin);

      stsMock.on(AssumeRoleCommand).resolves({
        Credentials: {
          AccessKeyId: 'AKIA...',
          SecretAccessKey: 'secret',
          SessionToken: 'token',
          Expiration: new Date(),
        },
      });

      await client.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        RoleSessionName: 'test-session',
      }));

      expect(recordedActions).toHaveLength(1);
      expect(recordedActions[0]).toEqual({
        service: 'sts',
        action: 'AssumeRole',
      });
      expect(recordedRoles).toHaveLength(1);
      expect(recordedRoles[0]).toEqual({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        assumedVia: 'AssumeRole',
      });
    });

    it('should not record role for non-AssumeRole STS operations', async () => {
      const plugin = createPermissionsMiddlewarePlugin({
        onAction: (action) => recordedActions.push(action),
        onRole: (role) => recordedRoles.push(role),
      });

      const client = new STSClient({ region: 'us-east-1' });
      client.middlewareStack.use(plugin);

      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:sts::123456789012:assumed-role/TestRole/test-session',
        UserId: 'AROA...',
      });

      await client.send(new GetCallerIdentityCommand({}));

      expect(recordedActions).toHaveLength(1);
      expect(recordedActions[0]).toEqual({
        service: 'sts',
        action: 'GetCallerIdentity',
      });
      expect(recordedRoles).toHaveLength(0);
    });

    it('should not interfere with normal API call execution', async () => {
      const plugin = createPermissionsMiddlewarePlugin({
        onAction: (action) => recordedActions.push(action),
        onRole: (role) => recordedRoles.push(role),
      });

      const client = new STSClient({ region: 'us-east-1' });
      client.middlewareStack.use(plugin);

      const expectedCredentials = {
        AccessKeyId: 'AKIA...',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
        Expiration: new Date(),
      };

      stsMock.on(AssumeRoleCommand).resolves({
        Credentials: expectedCredentials,
      });

      const result = await client.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        RoleSessionName: 'test-session',
      }));

      // The API call should still return the expected result
      expect(result.Credentials).toEqual(expectedCredentials);
    });
  });

  describe('removePermissionsMiddleware', () => {
    it('should remove the middleware from the stack', async () => {
      const plugin = createPermissionsMiddlewarePlugin({
        onAction: (action) => recordedActions.push(action),
        onRole: (role) => recordedRoles.push(role),
      });

      const client = new S3Client({ region: 'us-east-1' });
      client.middlewareStack.use(plugin);

      s3Mock.on(PutObjectCommand).resolves({});

      // First call should be recorded
      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: 'test-body',
      }));

      expect(recordedActions).toHaveLength(1);

      // Remove middleware
      const removed = removePermissionsMiddleware(client.middlewareStack);
      expect(removed).toBe(true);

      // Second call should not be recorded
      await client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'test-key-2',
        Body: 'test-body-2',
      }));

      expect(recordedActions).toHaveLength(1); // Still 1, not 2
    });

    it('should return false when middleware is not present', () => {
      const client = new S3Client({ region: 'us-east-1' });

      const removed = removePermissionsMiddleware(client.middlewareStack);
      expect(removed).toBe(false);
    });
  });
});
