import {
  createSdkCallRecorderMiddleware,
  createSdkCallRecorderPlugin,
  installSdkCallRecorder,
} from '../../../lib/permissions-snapshot/sdk-call-recorder';
import {
  PermissionsTracker,
} from '../../../lib/permissions-snapshot/permissions-tracker';

describe('SDK Call Recorder', () => {
  beforeEach(() => {
    PermissionsTracker.resetInstance();
  });

  afterEach(() => {
    PermissionsTracker.resetInstance();
  });

  describe('createSdkCallRecorderMiddleware', () => {
    it('should create a middleware function', () => {
      const middleware = createSdkCallRecorderMiddleware();
      expect(typeof middleware).toBe('function');
    });

    it('should record actions when context has clientName and commandName', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = {
        clientName: 'S3Client',
        commandName: 'PutObjectCommand',
      };
      const mockArgs = {};
      
      const handler = middleware(mockNext, mockContext);
      await handler(mockArgs);
      
      const actions = tracker.getRecordedActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('s3');
      expect(actions[0].action).toBe('PutObject');
    });

    it('should record role assumptions for STS AssumeRole', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = {
        clientName: 'STSClient',
        commandName: 'AssumeRoleCommand',
      };
      const mockArgs = {
        input: {
          RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
          RoleSessionName: 'test-session',
        },
      };
      
      const handler = middleware(mockNext, mockContext);
      await handler(mockArgs);
      
      const roleAssumptions = tracker.getRecordedRoleAssumptions();
      expect(roleAssumptions).toHaveLength(1);
      expect(roleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
      expect(roleAssumptions[0].roleSessionName).toBe('test-session');
    });

    it('should call next middleware in the chain', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = { clientName: 'S3Client', commandName: 'PutObjectCommand' };
      const mockArgs = { input: { Bucket: 'test-bucket' } };
      
      const handler = middleware(mockNext, mockContext);
      const result = await handler(mockArgs);
      
      expect(mockNext).toHaveBeenCalledWith(mockArgs);
      expect(result).toEqual({ result: 'success' });
    });

    it('should handle missing context information gracefully', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = {}; // No clientName or commandName
      const mockArgs = {};
      
      const handler = middleware(mockNext, mockContext);
      await handler(mockArgs);
      
      // Should not record anything without proper context
      const actions = tracker.getRecordedActions();
      expect(actions).toHaveLength(0);
    });

    it('should record AssumeRoleWithSAML', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = {
        clientName: 'STSClient',
        commandName: 'AssumeRoleWithSAMLCommand',
      };
      const mockArgs = {
        input: {
          RoleArn: 'arn:aws:iam::123456789012:role/SAMLRole',
        },
      };
      
      const handler = middleware(mockNext, mockContext);
      await handler(mockArgs);
      
      const roleAssumptions = tracker.getRecordedRoleAssumptions();
      expect(roleAssumptions).toHaveLength(1);
      expect(roleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/SAMLRole');
    });

    it('should record AssumeRoleWithWebIdentity', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = {
        clientName: 'STSClient',
        commandName: 'AssumeRoleWithWebIdentityCommand',
      };
      const mockArgs = {
        input: {
          RoleArn: 'arn:aws:iam::123456789012:role/WebIdentityRole',
        },
      };
      
      const handler = middleware(mockNext, mockContext);
      await handler(mockArgs);
      
      const roleAssumptions = tracker.getRecordedRoleAssumptions();
      expect(roleAssumptions).toHaveLength(1);
      expect(roleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/WebIdentityRole');
    });

    it('should record GetFederationToken', async () => {
      const tracker = PermissionsTracker.getInstance();
      tracker.startRecording();
      
      const middleware = createSdkCallRecorderMiddleware(tracker);
      
      const mockNext = jest.fn().mockResolvedValue({ result: 'success' });
      const mockContext = {
        clientName: 'STSClient',
        commandName: 'GetFederationTokenCommand',
      };
      const mockArgs = {
        input: {
          Name: 'federation-user',
        },
      };
      
      const handler = middleware(mockNext, mockContext);
      await handler(mockArgs);
      
      const roleAssumptions = tracker.getRecordedRoleAssumptions();
      expect(roleAssumptions).toHaveLength(1);
      expect(roleAssumptions[0].roleArn).toBe('federation-token');
      expect(roleAssumptions[0].roleSessionName).toBe('federation-user');
    });
  });

  describe('createSdkCallRecorderPlugin', () => {
    it('should create a plugin with applyToStack method', () => {
      const plugin = createSdkCallRecorderPlugin();
      expect(plugin.applyToStack).toBeDefined();
      expect(typeof plugin.applyToStack).toBe('function');
    });

    it('should add middleware to the stack when applied', () => {
      const plugin = createSdkCallRecorderPlugin();
      
      const mockStack = {
        add: jest.fn(),
      };
      
      plugin.applyToStack(mockStack);
      
      expect(mockStack.add).toHaveBeenCalledTimes(1);
      expect(mockStack.add).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          step: 'initialize',
          name: 'permissionsSnapshotRecorder',
        }),
      );
    });
  });

  describe('installSdkCallRecorder', () => {
    it('should install plugin on client with middleware stack', () => {
      const mockClient = {
        middlewareStack: {
          use: jest.fn(),
        },
      };
      
      installSdkCallRecorder(mockClient);
      
      expect(mockClient.middlewareStack.use).toHaveBeenCalledTimes(1);
      expect(mockClient.middlewareStack.use).toHaveBeenCalledWith(
        expect.objectContaining({
          applyToStack: expect.any(Function),
        }),
      );
    });

    it('should warn when client has no middleware stack', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const mockClient = {};
      installSdkCallRecorder(mockClient);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot install SDK call recorder'),
      );
      
      consoleSpy.mockRestore();
    });

    it('should accept custom tracker', () => {
      const customTracker = PermissionsTracker.getInstance();
      customTracker.startRecording();
      
      const mockClient = {
        middlewareStack: {
          use: jest.fn((plugin: any) => {
            // Simulate applying the plugin
            const mockStack = {
              add: jest.fn((middleware: any) => {
                // Call the middleware with test data
                const handler = middleware(
                  jest.fn().mockResolvedValue({}),
                  { clientName: 'TestClient', commandName: 'TestCommand' },
                );
                handler({});
              }),
            };
            plugin.applyToStack(mockStack);
          }),
        },
      };
      
      installSdkCallRecorder(mockClient, customTracker);
      
      // The action should be recorded in the custom tracker
      // Note: This is async, so we check after a small delay
      setTimeout(() => {
        const actions = customTracker.getRecordedActions();
        expect(actions.some(a => a.service === 'test')).toBe(true);
      }, 10);
    });
  });
});
