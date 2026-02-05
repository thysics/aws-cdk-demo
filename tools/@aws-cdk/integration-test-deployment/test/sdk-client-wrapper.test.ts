import { mockClient } from 'aws-sdk-client-mock';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { PermissionsCollector } from '@aws-cdk/permissions-tracker';
import {
  createTrackedSTSClient,
  attachPermissionsMiddleware,
  getPermissionsCollector,
  resetPermissionsCollector,
  initializePermissionsTracking,
} from '../lib/sdk-client-wrapper';

// Mock STS client
const stsMock = mockClient(STSClient);

describe('sdk-client-wrapper', () => {
  beforeEach(() => {
    stsMock.reset();
    PermissionsCollector.resetInstance();
  });

  afterAll(() => {
    stsMock.restore();
  });

  describe('createTrackedSTSClient', () => {
    test('creates STS client with tracking enabled by default', async () => {
      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:sts::123456789012:assumed-role/TestRole/session',
        UserId: 'AROAEXAMPLE:session',
      });

      const client = createTrackedSTSClient({});
      await client.send(new GetCallerIdentityCommand({}));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('sts');
      expect(calls[0].action).toBe('GetCallerIdentity');
    });

    test('creates STS client with tracking disabled', async () => {
      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:sts::123456789012:assumed-role/TestRole/session',
        UserId: 'AROAEXAMPLE:session',
      });

      const client = createTrackedSTSClient({}, { trackingEnabled: false });
      await client.send(new GetCallerIdentityCommand({}));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(0);
    });
  });

  describe('attachPermissionsMiddleware', () => {
    test('attaches middleware to existing client', async () => {
      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:sts::123456789012:assumed-role/TestRole/session',
        UserId: 'AROAEXAMPLE:session',
      });

      const client = new STSClient({});
      attachPermissionsMiddleware(client);
      await client.send(new GetCallerIdentityCommand({}));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('sts');
    });
  });

  describe('getPermissionsCollector', () => {
    test('returns singleton instance', () => {
      const collector1 = getPermissionsCollector();
      const collector2 = getPermissionsCollector();

      expect(collector1).toBe(collector2);
    });
  });

  describe('resetPermissionsCollector', () => {
    test('resets collector instance', () => {
      const collector1 = getPermissionsCollector();
      collector1.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      resetPermissionsCollector();

      const collector2 = getPermissionsCollector();
      expect(collector2.getApiCalls()).toHaveLength(0);
    });
  });

  describe('initializePermissionsTracking', () => {
    test('resets and configures collector', () => {
      const collector1 = getPermissionsCollector();
      collector1.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      initializePermissionsTracking({
        initialPrincipal: 'arn:aws:iam::123456789012:user/testuser',
      });

      const collector2 = getPermissionsCollector();
      expect(collector2.getApiCalls()).toHaveLength(0);
      expect(collector2.getCurrentPrincipal()).toBe('arn:aws:iam::123456789012:user/testuser');
    });
  });
});
