/**
 * Unit tests for middleware.
 */

import {
  createPermissionTrackerMiddleware,
  createPermissionTrackerPlugin,
  extractServiceName,
  extractActionName,
  extractRoleArn,
  formatIamAction,
} from '../lib/middleware';
import { PermissionTracker } from '../lib/permission-tracker';

describe('middleware', () => {
  beforeEach(() => {
    PermissionTracker.resetInstance();
  });

  afterEach(() => {
    PermissionTracker.resetInstance();
  });

  describe('extractServiceName', () => {
    it('should extract service name from client name', () => {
      expect(extractServiceName('S3Client')).toBe('s3');
      expect(extractServiceName('LambdaClient')).toBe('lambda');
      expect(extractServiceName('DynamoDBClient')).toBe('dynamodb');
    });

    it('should handle lowercase client names', () => {
      expect(extractServiceName('s3Client')).toBe('s3');
    });

    it('should handle missing client suffix', () => {
      expect(extractServiceName('S3')).toBe('s3');
    });

    it('should return unknown for undefined', () => {
      expect(extractServiceName(undefined)).toBe('unknown');
    });

    it('should handle empty string', () => {
      expect(extractServiceName('')).toBe('unknown');
    });
  });

  describe('extractActionName', () => {
    it('should extract action name from command name', () => {
      expect(extractActionName('GetObjectCommand')).toBe('GetObject');
      expect(extractActionName('InvokeFunctionCommand')).toBe('InvokeFunction');
      expect(extractActionName('DescribeInstancesCommand')).toBe('DescribeInstances');
    });

    it('should handle lowercase command suffix', () => {
      expect(extractActionName('GetObjectcommand')).toBe('GetObject');
    });

    it('should handle missing command suffix', () => {
      expect(extractActionName('GetObject')).toBe('GetObject');
    });

    it('should return Unknown for undefined', () => {
      expect(extractActionName(undefined)).toBe('Unknown');
    });
  });

  describe('extractRoleArn', () => {
    it('should extract RoleArn from input', () => {
      const input = { RoleArn: 'arn:aws:iam::123456789012:role/TestRole' };
      expect(extractRoleArn(input)).toBe('arn:aws:iam::123456789012:role/TestRole');
    });

    it('should return undefined when RoleArn is missing', () => {
      const input = { Bucket: 'my-bucket' };
      expect(extractRoleArn(input)).toBeUndefined();
    });

    it('should return undefined when RoleArn is not a string', () => {
      const input = { RoleArn: 12345 };
      expect(extractRoleArn(input)).toBeUndefined();
    });
  });

  describe('formatIamAction', () => {
    it('should format IAM action string', () => {
      expect(formatIamAction('s3', 'GetObject')).toBe('s3:GetObject');
      expect(formatIamAction('lambda', 'InvokeFunction')).toBe('lambda:InvokeFunction');
    });
  });

  describe('createPermissionTrackerMiddleware', () => {
    it('should record service calls', async () => {
      const tracker = PermissionTracker.getInstance();
      const middleware = createPermissionTrackerMiddleware(tracker);

      const mockNext = jest.fn().mockResolvedValue({ output: {} });
      const context = { clientName: 'S3Client', commandName: 'GetObjectCommand' };
      const args = { input: { Bucket: 'test-bucket', Key: 'test-key' } };

      const handler = middleware(mockNext, context);
      await handler(args);

      expect(mockNext).toHaveBeenCalledWith(args);
      expect(tracker.recordCount).toBe(1);

      const snapshot = tracker.getSnapshot();
      expect(snapshot.actions.s3).toContain('GetObject');
    });

    it('should handle AssumeRole calls specially', async () => {
      const tracker = PermissionTracker.getInstance();
      const middleware = createPermissionTrackerMiddleware(tracker);

      const mockNext = jest.fn().mockResolvedValue({ output: {} });
      const context = { clientName: 'STSClient', commandName: 'AssumeRoleCommand' };
      const roleArn = 'arn:aws:iam::123456789012:role/TestRole';
      const args = { input: { RoleArn: roleArn } };

      const handler = middleware(mockNext, context);
      await handler(args);

      expect(tracker.getAssumedRoles()).toContain(roleArn);
    });

    it('should handle AssumeRoleWithSAML calls', async () => {
      const tracker = PermissionTracker.getInstance();
      const middleware = createPermissionTrackerMiddleware(tracker);

      const mockNext = jest.fn().mockResolvedValue({ output: {} });
      const context = { clientName: 'STSClient', commandName: 'AssumeRoleWithSAMLCommand' };
      const roleArn = 'arn:aws:iam::123456789012:role/TestRole';
      const args = { input: { RoleArn: roleArn } };

      const handler = middleware(mockNext, context);
      await handler(args);

      expect(tracker.getAssumedRoles()).toContain(roleArn);
    });

    it('should use singleton tracker by default', async () => {
      const middleware = createPermissionTrackerMiddleware();

      const mockNext = jest.fn().mockResolvedValue({ output: {} });
      const context = { clientName: 'S3Client', commandName: 'GetObjectCommand' };
      const args = { input: {} };

      const handler = middleware(mockNext, context);
      await handler(args);

      const tracker = PermissionTracker.getInstance();
      expect(tracker.recordCount).toBe(1);
    });

    it('should pass through to next handler', async () => {
      const middleware = createPermissionTrackerMiddleware();

      const expectedOutput = { Body: 'test-body' };
      const mockNext = jest.fn().mockResolvedValue({ output: expectedOutput });
      const context = { clientName: 'S3Client', commandName: 'GetObjectCommand' };
      const args = { input: {} };

      const handler = middleware(mockNext, context);
      const result = await handler(args);

      expect(result.output).toBe(expectedOutput);
    });

    it('should handle multiple SDK clients sharing same tracker', async () => {
      const tracker = PermissionTracker.getInstance();
      const middleware = createPermissionTrackerMiddleware(tracker);

      const mockNext = jest.fn().mockResolvedValue({ output: {} });

      // simulate S3 client call
      const s3Handler = middleware(mockNext, { clientName: 'S3Client', commandName: 'GetObjectCommand' });
      await s3Handler({ input: {} });

      // simulate Lambda client call
      const lambdaHandler = middleware(mockNext, { clientName: 'LambdaClient', commandName: 'InvokeFunctionCommand' });
      await lambdaHandler({ input: {} });

      // simulate DynamoDB client call
      const dynamoHandler = middleware(mockNext, { clientName: 'DynamoDBClient', commandName: 'GetItemCommand' });
      await dynamoHandler({ input: {} });

      expect(tracker.recordCount).toBe(3);

      const snapshot = tracker.getSnapshot();
      expect(Object.keys(snapshot.actions)).toEqual(['dynamodb', 'lambda', 's3']);
    });
  });

  describe('createPermissionTrackerPlugin', () => {
    it('should create a valid plugin object', () => {
      const plugin = createPermissionTrackerPlugin();
      expect(plugin).toHaveProperty('applyToStack');
      expect(typeof plugin.applyToStack).toBe('function');
    });

    it('should add middleware to client stack', () => {
      const plugin = createPermissionTrackerPlugin();
      const mockStack = {
        add: jest.fn(),
      };

      plugin.applyToStack(mockStack);

      expect(mockStack.add).toHaveBeenCalledWith(
        expect.any(Function),
        { step: 'initialize', name: 'permissionTracker' }
      );
    });

    it('should accept custom tracker', () => {
      const tracker = PermissionTracker.getInstance();
      const plugin = createPermissionTrackerPlugin(tracker);

      expect(plugin).toHaveProperty('applyToStack');
    });
  });
});
