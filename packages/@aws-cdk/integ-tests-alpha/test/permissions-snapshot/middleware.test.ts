import { PermissionsTracker } from '../../lib/permissions-snapshot/tracker';
import {
  permissionsTrackingMiddleware,
  PERMISSIONS_TRACKING_MIDDLEWARE_NAME,
  applyPermissionsTracking,
  removePermissionsTracking,
} from '../../lib/permissions-snapshot/middleware';

// Mock middleware context
const createMockContext = (clientName?: string, commandName?: string) => ({
  clientName,
  commandName,
});

// Mock arguments
const createMockArgs = (input: Record<string, unknown> = {}) => ({
  input,
  request: { headers: {} },
});

describe('permissionsTrackingMiddleware', () => {
  let tracker: PermissionsTracker;

  beforeEach(() => {
    PermissionsTracker.clear();
    tracker = PermissionsTracker.initialize({ testName: 'middleware-test' });
  });

  afterEach(() => {
    PermissionsTracker.clear();
  });

  test('records action when tracker is available', async () => {
    const middleware = permissionsTrackingMiddleware();
    const next = jest.fn().mockResolvedValue({ $metadata: {} });

    const context = createMockContext('S3Client', 'GetObjectCommand');
    const args = createMockArgs();

    await middleware(next, context)(args);

    const actions = tracker.getRawActions();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ service: 'S3', action: 'GetObject' });
  });

  test('does not record when tracker is not available', async () => {
    PermissionsTracker.clear();

    const middleware = permissionsTrackingMiddleware();
    const next = jest.fn().mockResolvedValue({ $metadata: {} });

    const context = createMockContext('S3Client', 'GetObjectCommand');
    const args = createMockArgs();

    await middleware(next, context)(args);

    // No tracker, so nothing should be recorded
    expect(PermissionsTracker.getInstance()).toBeUndefined();
  });

  test('continues to next middleware on success', async () => {
    const middleware = permissionsTrackingMiddleware();
    const expectedOutput = { $metadata: {}, Body: 'test' };
    const next = jest.fn().mockResolvedValue(expectedOutput);

    const context = createMockContext('S3Client', 'GetObjectCommand');
    const args = createMockArgs();

    const result = await middleware(next, context)(args);

    expect(next).toHaveBeenCalledWith(args);
    expect(result).toBe(expectedOutput);
  });

  test('propagates errors from next middleware', async () => {
    const middleware = permissionsTrackingMiddleware();
    const error = new Error('API Error');
    const next = jest.fn().mockRejectedValue(error);

    const context = createMockContext('S3Client', 'GetObjectCommand');
    const args = createMockArgs();

    await expect(middleware(next, context)(args)).rejects.toThrow('API Error');
  });

  test('records role assumption for STS AssumeRole', async () => {
    const middleware = permissionsTrackingMiddleware();
    const next = jest.fn().mockResolvedValue({ $metadata: {}, Credentials: {} });

    const context = createMockContext('STSClient', 'AssumeRoleCommand');
    const args = createMockArgs({
      RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
      RoleSessionName: 'test-session',
      ExternalId: 'external-123',
    });

    await middleware(next, context)(args);

    const roles = tracker.getRoles();
    expect(roles).toHaveLength(1);
    expect(roles[0]).toEqual({
      roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      sessionName: 'test-session',
      externalId: 'external-123',
    });
  });

  test('handles missing context properties gracefully', async () => {
    const middleware = permissionsTrackingMiddleware();
    const next = jest.fn().mockResolvedValue({ $metadata: {} });

    const context = createMockContext(); // No clientName or commandName
    const args = createMockArgs();

    await middleware(next, context)(args);

    // Should not throw, and should not record anything
    const actions = tracker.getRawActions();
    expect(actions).toHaveLength(0);
  });

  test('removes Client suffix from client name', async () => {
    const middleware = permissionsTrackingMiddleware();
    const next = jest.fn().mockResolvedValue({ $metadata: {} });

    const context = createMockContext('CloudFormationClient', 'CreateStackCommand');
    const args = createMockArgs();

    await middleware(next, context)(args);

    const actions = tracker.getRawActions();
    expect(actions[0].service).toBe('CloudFormation');
  });

  test('removes Command suffix from command name', async () => {
    const middleware = permissionsTrackingMiddleware();
    const next = jest.fn().mockResolvedValue({ $metadata: {} });

    const context = createMockContext('S3Client', 'ListBucketsCommand');
    const args = createMockArgs();

    await middleware(next, context)(args);

    const actions = tracker.getRawActions();
    expect(actions[0].action).toBe('ListBuckets');
  });
});

describe('applyPermissionsTracking', () => {
  test('adds middleware to client middleware stack', () => {
    const mockAdd = jest.fn();
    const mockClient = {
      middlewareStack: { add: mockAdd },
    };

    applyPermissionsTracking(mockClient);

    expect(mockAdd).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        step: 'finalizeRequest',
        name: PERMISSIONS_TRACKING_MIDDLEWARE_NAME,
      }),
    );
  });
});

describe('removePermissionsTracking', () => {
  test('removes middleware from client middleware stack', () => {
    const mockRemove = jest.fn();
    const mockClient = {
      middlewareStack: { remove: mockRemove },
    };

    removePermissionsTracking(mockClient);

    expect(mockRemove).toHaveBeenCalledWith(PERMISSIONS_TRACKING_MIDDLEWARE_NAME);
  });

  test('does not throw if middleware is not present', () => {
    const mockRemove = jest.fn().mockImplementation(() => {
      throw new Error('Middleware not found');
    });
    const mockClient = {
      middlewareStack: { remove: mockRemove },
    };

    // Should not throw
    expect(() => removePermissionsTracking(mockClient)).not.toThrow();
  });
});
