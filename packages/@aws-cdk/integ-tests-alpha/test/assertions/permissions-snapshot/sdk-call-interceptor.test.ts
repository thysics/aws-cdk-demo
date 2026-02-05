import {
  createSdkCallInterceptorPlugin,
  SdkCallInterceptorManager,
  setupGlobalInterceptor,
  getGlobalInterceptor,
  clearGlobalInterceptor,
} from '../../lib/assertions/permissions-snapshot/sdk-call-interceptor';
import type { RecordedIamAction, RecordedRoleAssumption } from '../../lib/assertions/permissions-snapshot/types';

describe('SdkCallInterceptorManager', () => {
  let recordedActions: RecordedIamAction[];
  let recordedAssumptions: RecordedRoleAssumption[];
  let manager: SdkCallInterceptorManager;

  beforeEach(() => {
    recordedActions = [];
    recordedAssumptions = [];
    manager = new SdkCallInterceptorManager({
      onSdkCall: (action) => recordedActions.push(action),
      onRoleAssumption: (assumption) => recordedAssumptions.push(assumption),
      includeTimestamp: false,
    });
  });

  describe('plugin creation', () => {
    test('should create a valid plugin', () => {
      const plugin = manager.getPlugin();
      expect(plugin).toBeDefined();
      expect(plugin.applyToStack).toBeDefined();
    });
  });

  describe('applyTo', () => {
    test('should add middleware to client stack', () => {
      const mockUse = jest.fn();
      const mockClient = {
        middlewareStack: {
          use: mockUse,
        },
      };

      manager.applyTo(mockClient);

      expect(mockUse).toHaveBeenCalledWith(expect.any(Object));
    });
  });
});

describe('createSdkCallInterceptorPlugin', () => {
  test('should create plugin without options', () => {
    const plugin = createSdkCallInterceptorPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.applyToStack).toBeDefined();
  });

  test('should create plugin with callbacks', () => {
    const onSdkCall = jest.fn();
    const onRoleAssumption = jest.fn();

    const plugin = createSdkCallInterceptorPlugin({
      onSdkCall,
      onRoleAssumption,
    });

    expect(plugin).toBeDefined();
  });
});

describe('global interceptor', () => {
  afterEach(() => {
    clearGlobalInterceptor();
  });

  test('setupGlobalInterceptor creates a global instance', () => {
    expect(getGlobalInterceptor()).toBeUndefined();

    const manager = setupGlobalInterceptor({
      onSdkCall: () => {},
    });

    expect(manager).toBeDefined();
    expect(getGlobalInterceptor()).toBe(manager);
  });

  test('clearGlobalInterceptor removes the global instance', () => {
    setupGlobalInterceptor({});
    expect(getGlobalInterceptor()).toBeDefined();

    clearGlobalInterceptor();
    expect(getGlobalInterceptor()).toBeUndefined();
  });
});

describe('middleware behavior', () => {
  // Mock types for testing middleware behavior
  interface MockContext {
    clientName?: string;
    commandName?: string;
    serviceId?: string;
  }

  interface MockArgs {
    input?: any;
  }

  test('should invoke onSdkCall callback with action details', async () => {
    const recordedActions: RecordedIamAction[] = [];

    const plugin = createSdkCallInterceptorPlugin({
      onSdkCall: (action) => recordedActions.push(action),
      includeTimestamp: false,
    });

    // Create a mock middleware stack
    const mockAdd = jest.fn();
    const mockStack = { add: mockAdd };

    plugin.applyToStack(mockStack as any);

    // Verify the middleware was added
    expect(mockAdd).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        step: 'finalizeRequest',
        name: 'permissionsSnapshotInterceptor',
      }),
    );

    // Get the middleware function
    const middlewareFn = mockAdd.mock.calls[0][0];

    // Create mock next handler
    const mockNext = jest.fn().mockResolvedValue({ output: {} });

    // Create mock context with client info
    const mockContext: MockContext = {
      clientName: 'S3Client',
      commandName: 'GetObjectCommand',
    };

    // Execute the middleware
    const handler = middlewareFn(mockNext, mockContext);
    await handler({ input: {} });

    // Verify the callback was invoked
    expect(recordedActions).toHaveLength(1);
    expect(recordedActions[0].service).toBe('s3');
    expect(recordedActions[0].action).toBe('GetObject');
  });

  test('should detect and record STS AssumeRole calls', async () => {
    const recordedActions: RecordedIamAction[] = [];
    const recordedAssumptions: RecordedRoleAssumption[] = [];

    const plugin = createSdkCallInterceptorPlugin({
      onSdkCall: (action) => recordedActions.push(action),
      onRoleAssumption: (assumption) => recordedAssumptions.push(assumption),
      includeTimestamp: false,
    });

    const mockAdd = jest.fn();
    const mockStack = { add: mockAdd };

    plugin.applyToStack(mockStack as any);

    const middlewareFn = mockAdd.mock.calls[0][0];
    const mockNext = jest.fn().mockResolvedValue({ output: {} });

    const mockContext: MockContext = {
      clientName: 'STSClient',
      commandName: 'AssumeRoleCommand',
    };

    const mockArgs: MockArgs = {
      input: {
        RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
        RoleSessionName: 'TestSession',
      },
    };

    const handler = middlewareFn(mockNext, mockContext);
    await handler(mockArgs);

    expect(recordedActions).toHaveLength(1);
    expect(recordedActions[0].service).toBe('sts');
    expect(recordedActions[0].action).toBe('AssumeRole');

    expect(recordedAssumptions).toHaveLength(1);
    expect(recordedAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
    expect(recordedAssumptions[0].sessionName).toBe('TestSession');
  });

  test('should continue with request after interception', async () => {
    const plugin = createSdkCallInterceptorPlugin({});

    const mockAdd = jest.fn();
    const mockStack = { add: mockAdd };

    plugin.applyToStack(mockStack as any);

    const middlewareFn = mockAdd.mock.calls[0][0];
    const mockNext = jest.fn().mockResolvedValue({ output: { result: 'success' } });

    const mockContext: MockContext = {
      clientName: 'S3Client',
      commandName: 'GetObjectCommand',
    };

    const handler = middlewareFn(mockNext, mockContext);
    const result = await handler({ input: {} });

    expect(mockNext).toHaveBeenCalled();
    expect(result).toEqual({ output: { result: 'success' } });
  });

  test('should handle missing context gracefully', async () => {
    const recordedActions: RecordedIamAction[] = [];

    const plugin = createSdkCallInterceptorPlugin({
      onSdkCall: (action) => recordedActions.push(action),
    });

    const mockAdd = jest.fn();
    const mockStack = { add: mockAdd };

    plugin.applyToStack(mockStack as any);

    const middlewareFn = mockAdd.mock.calls[0][0];
    const mockNext = jest.fn().mockResolvedValue({ output: {} });

    // Empty context - no client name or command name
    const mockContext: MockContext = {};

    const handler = middlewareFn(mockNext, mockContext);
    await handler({ input: {} });

    // Should not record anything without proper context
    expect(recordedActions).toHaveLength(0);
  });

  test('should normalize client names correctly', async () => {
    const recordedActions: RecordedIamAction[] = [];

    const plugin = createSdkCallInterceptorPlugin({
      onSdkCall: (action) => recordedActions.push(action),
      includeTimestamp: false,
    });

    const mockAdd = jest.fn();
    const mockStack = { add: mockAdd };

    plugin.applyToStack(mockStack as any);

    const middlewareFn = mockAdd.mock.calls[0][0];
    const mockNext = jest.fn().mockResolvedValue({ output: {} });

    // Test CloudFormation client name normalization
    const mockContext: MockContext = {
      clientName: 'CloudFormationClient',
      commandName: 'CreateStackCommand',
    };

    const handler = middlewareFn(mockNext, mockContext);
    await handler({ input: {} });

    expect(recordedActions[0].service).toBe('cloud-formation');
    expect(recordedActions[0].action).toBe('CreateStack');
  });

  test('should include timestamp when configured', async () => {
    const recordedActions: RecordedIamAction[] = [];

    const plugin = createSdkCallInterceptorPlugin({
      onSdkCall: (action) => recordedActions.push(action),
      includeTimestamp: true,
    });

    const mockAdd = jest.fn();
    const mockStack = { add: mockAdd };

    plugin.applyToStack(mockStack as any);

    const middlewareFn = mockAdd.mock.calls[0][0];
    const mockNext = jest.fn().mockResolvedValue({ output: {} });

    const mockContext: MockContext = {
      clientName: 'S3Client',
      commandName: 'GetObjectCommand',
    };

    const handler = middlewareFn(mockNext, mockContext);
    await handler({ input: {} });

    expect(recordedActions[0].timestamp).toBeDefined();
    expect(recordedActions[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
