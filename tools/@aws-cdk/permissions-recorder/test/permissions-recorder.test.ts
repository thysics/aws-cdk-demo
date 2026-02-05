import { PermissionsRecorder, createPermissionsMiddleware } from '../lib';

describe('PermissionsRecorder', () => {
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    // Create a fresh recorder for each test
    recorder = new PermissionsRecorder();
  });

  describe('constructor', () => {
    it('should create an instance with empty recorded data', () => {
      expect(recorder.recordedRoles.size).toBe(0);
      expect(recorder.recordedActions.size).toBe(0);
    });

    it('should start recording by default', () => {
      expect(recorder.isRecording).toBe(true);
    });
  });

  describe('globalInstance', () => {
    afterEach(() => {
      PermissionsRecorder.resetGlobalInstance();
    });

    it('should return a singleton instance', () => {
      const instance1 = PermissionsRecorder.globalInstance;
      const instance2 = PermissionsRecorder.globalInstance;
      expect(instance1).toBe(instance2);
    });

    it('should reset the global instance', () => {
      const instance1 = PermissionsRecorder.globalInstance;
      PermissionsRecorder.resetGlobalInstance();
      const instance2 = PermissionsRecorder.globalInstance;
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('start/stop', () => {
    it('should stop and start recording', () => {
      expect(recorder.isRecording).toBe(true);
      recorder.stop();
      expect(recorder.isRecording).toBe(false);
      recorder.start();
      expect(recorder.isRecording).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all recorded data', () => {
      // Simulate recorded data by directly manipulating internal state
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/TestRole');
      recorder.recordedActions.set('s3:ListBuckets', 5);

      expect(recorder.recordedRoles.size).toBe(1);
      expect(recorder.recordedActions.size).toBe(1);

      recorder.reset();

      expect(recorder.recordedRoles.size).toBe(0);
      expect(recorder.recordedActions.size).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('should return empty snapshot when no data recorded', () => {
      const snapshot = recorder.getSnapshot();
      expect(snapshot).toEqual({
        version: '1.0',
        roles: [],
        actions: {},
      });
    });

    it('should include version in snapshot', () => {
      const snapshot = recorder.getSnapshot();
      expect(snapshot.version).toBe('1.0');
    });

    it('should sort roles alphabetically', () => {
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/ZRole');
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/ARole');
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/MRole');

      const snapshot = recorder.getSnapshot();
      expect(snapshot.roles).toEqual([
        'arn:aws:iam::123456789012:role/ARole',
        'arn:aws:iam::123456789012:role/MRole',
        'arn:aws:iam::123456789012:role/ZRole',
      ]);
    });

    it('should sort actions alphabetically by key', () => {
      recorder.recordedActions.set('sts:AssumeRole', 1);
      recorder.recordedActions.set('cloudformation:DescribeStacks', 5);
      recorder.recordedActions.set('s3:PutObject', 2);

      const snapshot = recorder.getSnapshot();
      expect(Object.keys(snapshot.actions)).toEqual([
        'cloudformation:DescribeStacks',
        's3:PutObject',
        'sts:AssumeRole',
      ]);
      expect(snapshot.actions).toEqual({
        'cloudformation:DescribeStacks': 5,
        's3:PutObject': 2,
        'sts:AssumeRole': 1,
      });
    });

    it('should be JSON serializable', () => {
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/TestRole');
      recorder.recordedActions.set('s3:PutObject', 3);

      const snapshot = recorder.getSnapshot();
      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(snapshot);
    });
  });

  describe('getRecordedPermissions', () => {
    it('should be an alias for getSnapshot', () => {
      recorder.recordedRoles.add('arn:aws:iam::123456789012:role/TestRole');
      recorder.recordedActions.set('s3:PutObject', 3);

      expect(recorder.getRecordedPermissions()).toEqual(recorder.getSnapshot());
    });
  });

  describe('createMiddleware', () => {
    it('should return a pluggable middleware', () => {
      const middleware = recorder.createMiddleware();
      expect(middleware).toBeDefined();
      expect(typeof middleware.applyToStack).toBe('function');
    });
  });

  describe('applyToClient', () => {
    it('should apply middleware to a mock client', () => {
      const mockUse = jest.fn();
      const mockClient = {
        middlewareStack: {
          use: mockUse,
        },
      };

      const result = recorder.applyToClient(mockClient);

      expect(mockUse).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockClient);
    });
  });
});

describe('createPermissionsMiddleware', () => {
  it('should call onAction callback when middleware executes', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    // Create a mock middleware stack
    const mockStack = {
      add: jest.fn(),
    };

    middleware.applyToStack(mockStack as any);

    // Verify middleware was added to stack
    expect(mockStack.add).toHaveBeenCalledTimes(1);
    const [handler, options] = mockStack.add.mock.calls[0];

    // Verify middleware options
    expect(options.step).toBe('initialize');
    expect(options.name).toBe('permissionsRecorderMiddleware');

    // Create mock next handler
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    // Execute middleware
    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: {},
      context: {
        clientName: 'S3Client',
        commandName: 'ListBucketsCommand',
      },
    });

    expect(onAction).toHaveBeenCalledWith('s3', 'ListBuckets');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle STS AssumeRole and extract role ARN', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = {
      add: jest.fn(),
    };

    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: {
        RoleArn: 'arn:aws:iam::123456789012:role/MyTestRole',
        RoleSessionName: 'test-session',
      },
      context: {
        clientName: 'STSClient',
        commandName: 'AssumeRoleCommand',
      },
    });

    expect(onAction).toHaveBeenCalledWith('sts', 'AssumeRole');
    expect(onAssumeRole).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/MyTestRole');
  });

  it('should handle AssumeRoleWithSAML', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: {
        RoleArn: 'arn:aws:iam::123456789012:role/SAMLRole',
        PrincipalArn: 'arn:aws:iam::123456789012:saml-provider/MyProvider',
      },
      context: {
        clientName: 'STSClient',
        commandName: 'AssumeRoleWithSAMLCommand',
      },
    });

    expect(onAction).toHaveBeenCalledWith('sts', 'AssumeRoleWithSAML');
    expect(onAssumeRole).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/SAMLRole');
  });

  it('should handle AssumeRoleWithWebIdentity', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: {
        RoleArn: 'arn:aws:iam::123456789012:role/WebIdentityRole',
        WebIdentityToken: 'token',
      },
      context: {
        clientName: 'STSClient',
        commandName: 'AssumeRoleWithWebIdentityCommand',
      },
    });

    expect(onAction).toHaveBeenCalledWith('sts', 'AssumeRoleWithWebIdentity');
    expect(onAssumeRole).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/WebIdentityRole');
  });

  it('should not call onAssumeRole for non-STS operations', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: { Bucket: 'my-bucket' },
      context: {
        clientName: 'S3Client',
        commandName: 'CreateBucketCommand',
      },
    });

    expect(onAction).toHaveBeenCalledWith('s3', 'CreateBucket');
    expect(onAssumeRole).not.toHaveBeenCalled();
  });

  it('should handle missing RoleArn in AssumeRole input', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: {}, // Missing RoleArn
      context: {
        clientName: 'STSClient',
        commandName: 'AssumeRoleCommand',
      },
    });

    expect(onAction).toHaveBeenCalledWith('sts', 'AssumeRole');
    expect(onAssumeRole).not.toHaveBeenCalled();
  });

  it('should handle missing context gracefully', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);
    await middlewareHandler({
      input: {},
      context: {},
    });

    expect(onAction).toHaveBeenCalledWith('unknown', 'Unknown');
    expect(onAssumeRole).not.toHaveBeenCalled();
  });

  it('should pass through to next handler without modification', async () => {
    const onAction = jest.fn();
    const onAssumeRole = jest.fn();

    const middleware = createPermissionsMiddleware({
      onAction,
      onAssumeRole,
    });

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const expectedResponse = { response: { data: 'test' }, output: {} };
    const mockNext = jest.fn().mockResolvedValue(expectedResponse);

    const middlewareHandler = handler(mockNext);
    const result = await middlewareHandler({
      input: { key: 'value' },
      context: {
        clientName: 'S3Client',
        commandName: 'GetObjectCommand',
      },
    });

    // Verify the result is passed through unchanged
    expect(result).toBe(expectedResponse);

    // Verify the input was passed to next handler
    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { key: 'value' },
      }),
    );
  });
});

describe('PermissionsRecorder integration with middleware', () => {
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    recorder = new PermissionsRecorder();
  });

  it('should record actions when middleware is triggered', async () => {
    const middleware = recorder.createMiddleware();

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);

    // Simulate multiple API calls
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'ListBucketsCommand' },
    });
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'PutObjectCommand' },
    });
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'PutObjectCommand' },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.actions).toEqual({
      's3:ListBuckets': 1,
      's3:PutObject': 2,
    });
  });

  it('should record roles when AssumeRole is called', async () => {
    const middleware = recorder.createMiddleware();

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);

    await middlewareHandler({
      input: { RoleArn: 'arn:aws:iam::123456789012:role/Role1' },
      context: { clientName: 'STSClient', commandName: 'AssumeRoleCommand' },
    });
    await middlewareHandler({
      input: { RoleArn: 'arn:aws:iam::123456789012:role/Role2' },
      context: { clientName: 'STSClient', commandName: 'AssumeRoleCommand' },
    });
    // Duplicate role should not add twice
    await middlewareHandler({
      input: { RoleArn: 'arn:aws:iam::123456789012:role/Role1' },
      context: { clientName: 'STSClient', commandName: 'AssumeRoleCommand' },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.roles).toEqual([
      'arn:aws:iam::123456789012:role/Role1',
      'arn:aws:iam::123456789012:role/Role2',
    ]);
    expect(snapshot.actions['sts:AssumeRole']).toBe(3);
  });

  it('should not record when stopped', async () => {
    const middleware = recorder.createMiddleware();

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);

    // Record one action
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'ListBucketsCommand' },
    });

    // Stop recording
    recorder.stop();

    // This should not be recorded
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'PutObjectCommand' },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.actions).toEqual({
      's3:ListBuckets': 1,
    });
    expect(snapshot.actions['s3:PutObject']).toBeUndefined();
  });

  it('should resume recording after start', async () => {
    const middleware = recorder.createMiddleware();

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);

    recorder.stop();
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'ListBucketsCommand' },
    });

    recorder.start();
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'PutObjectCommand' },
    });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.actions).toEqual({
      's3:PutObject': 1,
    });
  });

  it('should produce deterministic snapshot format', async () => {
    const middleware = recorder.createMiddleware();

    const mockStack = { add: jest.fn() };
    middleware.applyToStack(mockStack as any);

    const [handler] = mockStack.add.mock.calls[0];
    const mockNext = jest.fn().mockResolvedValue({ response: {} });

    const middlewareHandler = handler(mockNext);

    // Add data in non-sorted order
    await middlewareHandler({
      input: { RoleArn: 'arn:aws:iam::123456789012:role/ZRole' },
      context: { clientName: 'STSClient', commandName: 'AssumeRoleCommand' },
    });
    await middlewareHandler({
      input: { RoleArn: 'arn:aws:iam::123456789012:role/ARole' },
      context: { clientName: 'STSClient', commandName: 'AssumeRoleCommand' },
    });
    await middlewareHandler({
      input: {},
      context: { clientName: 'CloudFormationClient', commandName: 'DescribeStacksCommand' },
    });
    await middlewareHandler({
      input: {},
      context: { clientName: 'S3Client', commandName: 'PutObjectCommand' },
    });

    const snapshot = recorder.getSnapshot();

    // Verify deterministic JSON output
    const json = JSON.stringify(snapshot, null, 2);
    expect(json).toBe(`{
  "version": "1.0",
  "roles": [
    "arn:aws:iam::123456789012:role/ARole",
    "arn:aws:iam::123456789012:role/ZRole"
  ],
  "actions": {
    "cloudformation:DescribeStacks": 1,
    "s3:PutObject": 1,
    "sts:AssumeRole": 2
  }
}`);
  });
});
