import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PermissionsCollector,
  getGlobalCollector,
  resetGlobalCollector,
  createPermissionsInterceptorPlugin,
  instrumentClient,
} from '../lib/permissions-snapshot/sdk-interceptor';

describe('PermissionsCollector', () => {
  let collector: PermissionsCollector;

  beforeEach(() => {
    collector = new PermissionsCollector();
  });

  test('records unique actions', () => {
    collector.recordAction('s3', 'PutObject');
    collector.recordAction('s3', 'GetObject');
    collector.recordAction('s3', 'PutObject'); // duplicate

    const actions = collector.getActions();
    expect(actions).toHaveLength(2);
    expect(actions.map(a => `${a.service}:${a.action}`).sort()).toEqual([
      's3:GetObject',
      's3:PutObject',
    ]);
  });

  test('records role assumptions', () => {
    collector.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole', 'test-session');
    collector.recordRoleAssumption('arn:aws:iam::123456789012:role/OtherRole', 'other-session');

    const roleAssumptions = collector.getRoleAssumptions();
    expect(roleAssumptions).toHaveLength(2);
    expect(roleAssumptions[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
    expect(roleAssumptions[0].sessionName).toBe('test-session');
  });

  test('returns sorted permissions list', () => {
    collector.recordAction('cloudformation', 'CreateStack');
    collector.recordAction('s3', 'PutObject');
    collector.recordAction('iam', 'CreateRole');

    const permissions = collector.getPermissions();
    expect(permissions).toEqual([
      'cloudformation:CreateStack',
      'iam:CreateRole',
      's3:PutObject',
    ]);
  });

  test('clear removes all data', () => {
    collector.recordAction('s3', 'PutObject');
    collector.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole', 'session');

    collector.clear();

    expect(collector.getActions()).toHaveLength(0);
    expect(collector.getRoleAssumptions()).toHaveLength(0);
    expect(collector.getPermissions()).toHaveLength(0);
  });
});

describe('Global Collector', () => {
  beforeEach(() => {
    resetGlobalCollector();
  });

  afterEach(() => {
    resetGlobalCollector();
  });

  test('returns same instance', () => {
    const collector1 = getGlobalCollector();
    const collector2 = getGlobalCollector();
    expect(collector1).toBe(collector2);
  });

  test('reset clears and recreates collector', () => {
    const collector1 = getGlobalCollector();
    collector1.recordAction('s3', 'PutObject');

    resetGlobalCollector();

    const collector2 = getGlobalCollector();
    expect(collector2).not.toBe(collector1);
    expect(collector2.getActions()).toHaveLength(0);
  });
});

describe('createPermissionsInterceptorPlugin', () => {
  let collector: PermissionsCollector;

  beforeEach(() => {
    collector = new PermissionsCollector();
  });

  test('creates a plugin with correct structure', () => {
    const plugin = createPermissionsInterceptorPlugin(collector);
    expect(plugin).toHaveProperty('applyToStack');
    expect(typeof plugin.applyToStack).toBe('function');
  });
});

describe('instrumentClient', () => {
  test('returns the same client instance', () => {
    const mockMiddlewareStack = {
      add: jest.fn(),
      addRelativeTo: jest.fn(),
      clone: jest.fn(),
      use: jest.fn(),
      remove: jest.fn(),
      removeByTag: jest.fn(),
      concat: jest.fn(),
      applyToStack: jest.fn(),
      identify: jest.fn(),
      resolve: jest.fn(),
    };

    const mockClient = {
      middlewareStack: mockMiddlewareStack,
    };

    const result = instrumentClient(mockClient);
    expect(result).toBe(mockClient);
    expect(mockMiddlewareStack.use).toHaveBeenCalledTimes(1);
  });
});
