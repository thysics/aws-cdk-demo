import {
  instrumentSdkClient,
  uninstrumentSdkClient,
  instrumentSdkClients,
  uninstrumentSdkClients,
  isGlobalInstrumentationEnabled,
  applyGlobalInstrumentation,
  createInstrumentedClientFactory,
  instrumentMultipleClients,
  SdkClientWithMiddleware,
} from '../lib/sdk-integration';
import { PermissionsRecorder } from '../lib/permissions-recorder';

describe('sdk-integration', () => {
  // Mock client factory
  function createMockClient(): SdkClientWithMiddleware & { usedPlugins: unknown[] } {
    const usedPlugins: unknown[] = [];
    return {
      usedPlugins,
      middlewareStack: {
        use: jest.fn((plugin: unknown) => usedPlugins.push(plugin)),
        remove: jest.fn((name: string) => {
          const index = usedPlugins.findIndex((p) => {
            // Try to identify the plugin by checking its structure
            if (typeof p === 'object' && p !== null && 'applyToStack' in p) {
              return true;
            }
            return false;
          });
          if (index >= 0) {
            usedPlugins.splice(index, 1);
            return true;
          }
          return false;
        }),
        clone: jest.fn(),
      },
    };
  }

  let recorder: PermissionsRecorder;

  beforeEach(() => {
    recorder = new PermissionsRecorder();
    uninstrumentSdkClients();
    PermissionsRecorder.resetGlobalInstance();
  });

  afterEach(() => {
    uninstrumentSdkClients();
    PermissionsRecorder.resetGlobalInstance();
  });

  describe('instrumentSdkClient', () => {
    it('should add middleware to client', () => {
      const client = createMockClient();

      instrumentSdkClient(client, recorder);

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
      expect(client.usedPlugins.length).toBe(1);
    });

    it('should return the same client instance', () => {
      const client = createMockClient();

      const result = instrumentSdkClient(client, recorder);

      expect(result).toBe(client);
    });

    it('should not instrument the same client twice', () => {
      const client = createMockClient();

      instrumentSdkClient(client, recorder);
      instrumentSdkClient(client, recorder);

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
    });

    it('should use global instance by default', () => {
      const client = createMockClient();

      instrumentSdkClient(client);

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
    });
  });

  describe('uninstrumentSdkClient', () => {
    it('should return false for non-instrumented client', () => {
      const client = createMockClient();

      const result = uninstrumentSdkClient(client);

      expect(result).toBe(false);
    });

    it('should return true after removing middleware', () => {
      const client = createMockClient();
      instrumentSdkClient(client, recorder);

      const result = uninstrumentSdkClient(client);

      expect(result).toBe(true);
      expect(client.middlewareStack.remove).toHaveBeenCalledWith('permissionsRecorderMiddleware');
    });

    it('should allow re-instrumentation after uninstrumentation', () => {
      const client = createMockClient();

      instrumentSdkClient(client, recorder);
      uninstrumentSdkClient(client);
      instrumentSdkClient(client, recorder);

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(2);
    });
  });

  describe('instrumentSdkClients / uninstrumentSdkClients', () => {
    it('should enable global instrumentation', () => {
      expect(isGlobalInstrumentationEnabled()).toBe(false);

      instrumentSdkClients(recorder);

      expect(isGlobalInstrumentationEnabled()).toBe(true);
    });

    it('should disable global instrumentation', () => {
      instrumentSdkClients(recorder);
      expect(isGlobalInstrumentationEnabled()).toBe(true);

      uninstrumentSdkClients();

      expect(isGlobalInstrumentationEnabled()).toBe(false);
    });

    it('should use global instance by default', () => {
      instrumentSdkClients();

      expect(isGlobalInstrumentationEnabled()).toBe(true);
    });
  });

  describe('applyGlobalInstrumentation', () => {
    it('should not modify client when global instrumentation is disabled', () => {
      const client = createMockClient();

      applyGlobalInstrumentation(client);

      expect(client.middlewareStack.use).not.toHaveBeenCalled();
    });

    it('should add middleware when global instrumentation is enabled', () => {
      const client = createMockClient();
      instrumentSdkClients(recorder);

      applyGlobalInstrumentation(client);

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
    });

    it('should return the same client instance', () => {
      const client = createMockClient();
      instrumentSdkClients(recorder);

      const result = applyGlobalInstrumentation(client);

      expect(result).toBe(client);
    });

    it('should not instrument same client twice via global', () => {
      const client = createMockClient();
      instrumentSdkClients(recorder);

      applyGlobalInstrumentation(client);
      applyGlobalInstrumentation(client);

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
    });
  });

  describe('createInstrumentedClientFactory', () => {
    it('should create a factory that instruments new clients', () => {
      const originalFactory = jest.fn(() => createMockClient());
      const instrumentedFactory = createInstrumentedClientFactory(originalFactory, recorder);

      const client = instrumentedFactory({ region: 'us-east-1' });

      expect(originalFactory).toHaveBeenCalledWith({ region: 'us-east-1' });
      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
    });

    it('should pass config to original factory', () => {
      const originalFactory = jest.fn(() => createMockClient());
      const instrumentedFactory = createInstrumentedClientFactory(originalFactory, recorder);

      const config = { region: 'eu-west-1', credentials: {} };
      instrumentedFactory(config);

      expect(originalFactory).toHaveBeenCalledWith(config);
    });

    it('should use global instance by default', () => {
      const originalFactory = jest.fn(() => createMockClient());
      const instrumentedFactory = createInstrumentedClientFactory(originalFactory);

      const client = instrumentedFactory({});

      expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
    });
  });

  describe('instrumentMultipleClients', () => {
    it('should instrument all clients in array', () => {
      const clients = [createMockClient(), createMockClient(), createMockClient()];

      instrumentMultipleClients(clients, recorder);

      clients.forEach((client) => {
        expect(client.middlewareStack.use).toHaveBeenCalledTimes(1);
      });
    });

    it('should return the same array', () => {
      const clients = [createMockClient(), createMockClient()];

      const result = instrumentMultipleClients(clients, recorder);

      expect(result).toBe(clients);
    });

    it('should handle empty array', () => {
      const clients: SdkClientWithMiddleware[] = [];

      const result = instrumentMultipleClients(clients, recorder);

      expect(result).toEqual([]);
    });

    it('should use global instance by default', () => {
      const clients = [createMockClient()];

      instrumentMultipleClients(clients);

      expect(clients[0].middlewareStack.use).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration with PermissionsRecorder', () => {
    it('should record actions from instrumented client', async () => {
      const client = createMockClient();
      instrumentSdkClient(client, recorder);

      // Get the middleware that was added
      const middleware = client.usedPlugins[0] as { applyToStack: (stack: { add: jest.Mock }) => void };
      const mockStack = { add: jest.fn() };
      middleware.applyToStack(mockStack);

      const [handler] = mockStack.add.mock.calls[0];
      const mockNext = jest.fn().mockResolvedValue({ response: {} });
      const middlewareHandler = handler(mockNext);

      await middlewareHandler({
        input: {},
        context: { clientName: 'S3Client', commandName: 'ListBucketsCommand' },
      });

      const snapshot = recorder.getSnapshot();
      expect(snapshot.actions['s3:ListBuckets']).toBe(1);
    });
  });
});
