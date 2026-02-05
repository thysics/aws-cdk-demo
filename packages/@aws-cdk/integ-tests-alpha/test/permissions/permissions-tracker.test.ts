import type { InitializeHandlerArguments, InitializeHandler, InitializeHandlerOutput, MetadataBearer } from '@smithy/types';
import { PermissionsTracker, PERMISSIONS_SNAPSHOT_VERSION } from '../../lib/permissions/permissions-tracker';

describe('PermissionsTracker', () => {
  beforeEach(() => {
    PermissionsTracker.resetInstance();
  });

  describe('singleton pattern', () => {
    test('getInstance returns the same instance', () => {
      const instance1 = PermissionsTracker.getInstance();
      const instance2 = PermissionsTracker.getInstance();

      expect(instance1).toBe(instance2);
    });

    test('resetInstance creates a new instance', () => {
      const instance1 = PermissionsTracker.getInstance();
      instance1.startTracking('test-1');

      PermissionsTracker.resetInstance();
      const instance2 = PermissionsTracker.getInstance();

      expect(instance2.isCurrentlyTracking()).toBe(false);
      expect(instance2.getTestName()).toBe('');
    });
  });

  describe('tracking lifecycle', () => {
    test('startTracking enables tracking and sets test name', () => {
      const tracker = PermissionsTracker.getInstance();

      tracker.startTracking('my-test-case');

      expect(tracker.isCurrentlyTracking()).toBe(true);
      expect(tracker.getTestName()).toBe('my-test-case');
    });

    test('stopTracking disables tracking', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('my-test-case');

      tracker.stopTracking();

      expect(tracker.isCurrentlyTracking()).toBe(false);
    });

    test('reset clears all state', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('my-test-case');

      tracker.reset();

      expect(tracker.isCurrentlyTracking()).toBe(false);
      expect(tracker.getTestName()).toBe('');
      expect(tracker.getAssumedRoles()).toEqual([]);
      expect(tracker.getIamActions()).toEqual([]);
    });

    test('startTracking clears previous tracking data', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test-1');

      // Simulate some tracked data by getting a snapshot
      const snapshot1 = tracker.getSnapshot();
      expect(snapshot1.testName).toBe('test-1');

      // Start a new tracking session
      tracker.startTracking('test-2');

      expect(tracker.getTestName()).toBe('test-2');
      expect(tracker.getAssumedRoles()).toEqual([]);
      expect(tracker.getIamActions()).toEqual([]);
    });
  });

  describe('middleware creation', () => {
    test('createMiddleware returns a function', () => {
      const tracker = PermissionsTracker.getInstance();
      const middleware = tracker.createMiddleware();

      expect(typeof middleware).toBe('function');
    });

    test('createMiddlewarePlugin returns a pluggable object', () => {
      const tracker = PermissionsTracker.getInstance();
      const plugin = tracker.createMiddlewarePlugin();

      expect(plugin).toHaveProperty('applyToStack');
      expect(typeof plugin.applyToStack).toBe('function');
    });

    test('middleware calls next handler', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: {},
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      expect(mockNext).toHaveBeenCalledWith(args);
    });

    test('middleware does not capture when not tracking', async () => {
      const tracker = PermissionsTracker.getInstance();
      // Not calling startTracking

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockGetObjectCommand(),
        request: { serviceName: 'S3', hostname: 's3.us-east-1.amazonaws.com' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      expect(tracker.getIamActions()).toEqual([]);
    });

    test('middleware captures action when tracking', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockGetObjectCommand(),
        request: { serviceName: 'S3', hostname: 's3.us-east-1.amazonaws.com' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const actions = tracker.getIamActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('s3');
      expect(actions[0].action).toBe('GetObject');
      expect(actions[0].timestamp).toBeDefined();
    });
  });

  describe('IAM action extraction', () => {
    test('extracts action name from command constructor', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockPutObjectCommand(),
        request: { serviceName: 'S3' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const actions = tracker.getIamActions();
      expect(actions[0].action).toBe('PutObject');
    });

    test('extracts service name from serviceName property', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockCreateFunctionCommand(),
        request: { serviceName: 'Lambda' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const actions = tracker.getIamActions();
      expect(actions[0].service).toBe('lambda');
    });

    test('extracts service name from hostname', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockCreateBucketCommand(),
        request: { hostname: 'ec2.us-west-2.amazonaws.com' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const actions = tracker.getIamActions();
      expect(actions[0].service).toBe('ec2');
    });

    test('captures multiple actions in sequence', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockGetObjectCommand(),
        request: { serviceName: 'S3' },
      });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockPutObjectCommand(),
        request: { serviceName: 'S3' },
      });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockCreateFunctionCommand(),
        request: { serviceName: 'Lambda' },
      });

      const actions = tracker.getIamActions();
      expect(actions).toHaveLength(3);
      expect(actions.map(a => `${a.service}:${a.action}`)).toEqual([
        's3:GetObject',
        's3:PutObject',
        'lambda:CreateFunction',
      ]);
    });
  });

  describe('STS role assumption tracking', () => {
    test('captures AssumeRole operation with role ARN', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockAssumeRoleCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
          RoleSessionName: 'test-session',
        }),
        request: { serviceName: 'STS' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const roles = tracker.getAssumedRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
      expect(roles[0].sessionName).toBe('test-session');
      expect(roles[0].timestamp).toBeDefined();
    });

    test('captures AssumeRoleWithWebIdentity operation', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockAssumeRoleWithWebIdentityCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/WebIdentityRole',
          RoleSessionName: 'web-session',
        }),
        request: { serviceName: 'STS' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const roles = tracker.getAssumedRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0].roleArn).toBe('arn:aws:iam::123456789012:role/WebIdentityRole');
    });

    test('captures AssumeRoleWithSAML operation', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockAssumeRoleWithSAMLCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/SAMLRole',
          PrincipalArn: 'arn:aws:iam::123456789012:saml-provider/TestProvider',
        }),
        request: { serviceName: 'STS' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const roles = tracker.getAssumedRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0].roleArn).toBe('arn:aws:iam::123456789012:role/SAMLRole');
    });

    test('also records STS operations as IAM actions', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      const args: InitializeHandlerArguments<object> = {
        input: new MockAssumeRoleCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        }),
        request: { serviceName: 'STS' },
      };

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)(args);

      const actions = tracker.getIamActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('sts');
      expect(actions[0].action).toBe('AssumeRole');
    });

    test('captures multiple role assumptions', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockAssumeRoleCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/Role1',
        }),
        request: { serviceName: 'STS' },
      });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockAssumeRoleCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/Role2',
        }),
        request: { serviceName: 'STS' },
      });

      const roles = tracker.getAssumedRoles();
      expect(roles).toHaveLength(2);
      expect(roles[0].roleArn).toBe('arn:aws:iam::123456789012:role/Role1');
      expect(roles[1].roleArn).toBe('arn:aws:iam::123456789012:role/Role2');
    });
  });

  describe('getSnapshot', () => {
    test('returns snapshot with correct version', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const snapshot = tracker.getSnapshot();

      expect(snapshot.version).toBe(PERMISSIONS_SNAPSHOT_VERSION);
    });

    test('returns snapshot with test name', () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('my-integration-test');

      const snapshot = tracker.getSnapshot();

      expect(snapshot.testName).toBe('my-integration-test');
    });

    test('returns snapshot with capturedAt timestamp', () => {
      const tracker = PermissionsTracker.getInstance();
      const beforeStart = new Date().toISOString();
      tracker.startTracking('test');
      const afterStart = new Date().toISOString();

      const snapshot = tracker.getSnapshot();

      expect(snapshot.capturedAt).toBeDefined();
      expect(snapshot.capturedAt >= beforeStart).toBe(true);
      expect(snapshot.capturedAt <= afterStart).toBe(true);
    });

    test('returns snapshot with all captured data', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('full-test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      // Simulate some SDK calls
      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockAssumeRoleCommand({
          RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        }),
        request: { serviceName: 'STS' },
      });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockGetObjectCommand(),
        request: { serviceName: 'S3' },
      });

      const snapshot = tracker.getSnapshot();

      expect(snapshot.testName).toBe('full-test');
      expect(snapshot.assumedRoles).toHaveLength(1);
      expect(snapshot.assumedRoles[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
      expect(snapshot.iamActions).toHaveLength(2);
      expect(snapshot.iamActions[0].service).toBe('sts');
      expect(snapshot.iamActions[1].service).toBe('s3');
    });

    test('returns independent copy of data', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startTracking('test');

      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockGetObjectCommand(),
        request: { serviceName: 'S3' },
      });

      const snapshot1 = tracker.getSnapshot();
      const snapshot2 = tracker.getSnapshot();

      // Ensure snapshots are independent copies
      expect(snapshot1.iamActions).not.toBe(snapshot2.iamActions);
      expect(snapshot1.assumedRoles).not.toBe(snapshot2.assumedRoles);
    });
  });

  describe('permissions organized by test case', () => {
    test('separate test sessions have separate data', async () => {
      const tracker = PermissionsTracker.getInstance();
      const middleware = tracker.createMiddleware();
      const mockNext = jest.fn().mockResolvedValue({ output: {}, response: {} });

      // First test session
      tracker.startTracking('test-1');
      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockGetObjectCommand(),
        request: { serviceName: 'S3' },
      });
      const snapshot1 = tracker.getSnapshot();

      // Second test session
      tracker.startTracking('test-2');
      await middleware(mockNext as InitializeHandler<object, MetadataBearer>)({
        input: new MockCreateFunctionCommand(),
        request: { serviceName: 'Lambda' },
      });
      const snapshot2 = tracker.getSnapshot();

      // Verify each snapshot has its own data
      expect(snapshot1.testName).toBe('test-1');
      expect(snapshot1.iamActions).toHaveLength(1);
      expect(snapshot1.iamActions[0].service).toBe('s3');

      expect(snapshot2.testName).toBe('test-2');
      expect(snapshot2.iamActions).toHaveLength(1);
      expect(snapshot2.iamActions[0].service).toBe('lambda');
    });
  });
});

// Mock command classes for testing
class MockGetObjectCommand {
  constructor(public readonly input?: object) {}
}

class MockPutObjectCommand {
  constructor(public readonly input?: object) {}
}

class MockCreateBucketCommand {
  constructor(public readonly input?: object) {}
}

class MockCreateFunctionCommand {
  constructor(public readonly input?: object) {}
}

class MockAssumeRoleCommand {
  public readonly RoleArn?: string;
  public readonly RoleSessionName?: string;

  constructor(params: { RoleArn?: string; RoleSessionName?: string }) {
    this.RoleArn = params.RoleArn;
    this.RoleSessionName = params.RoleSessionName;
  }
}

class MockAssumeRoleWithWebIdentityCommand {
  public readonly RoleArn?: string;
  public readonly RoleSessionName?: string;

  constructor(params: { RoleArn?: string; RoleSessionName?: string }) {
    this.RoleArn = params.RoleArn;
    this.RoleSessionName = params.RoleSessionName;
  }
}

class MockAssumeRoleWithSAMLCommand {
  public readonly RoleArn?: string;
  public readonly PrincipalArn?: string;

  constructor(params: { RoleArn?: string; PrincipalArn?: string }) {
    this.RoleArn = params.RoleArn;
    this.PrincipalArn = params.PrincipalArn;
  }
}
