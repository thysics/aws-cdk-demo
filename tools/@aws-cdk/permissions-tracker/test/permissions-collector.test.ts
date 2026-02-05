import { PermissionsCollector } from '../lib/permissions-collector';
import { CapturedApiCall, AssumedRole } from '../lib/types';

describe('PermissionsCollector', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    PermissionsCollector.resetInstance();
  });

  describe('getInstance', () => {
    test('returns the same instance on multiple calls', () => {
      const instance1 = PermissionsCollector.getInstance();
      const instance2 = PermissionsCollector.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('creates new instance after reset', () => {
      const instance1 = PermissionsCollector.getInstance();
      PermissionsCollector.resetInstance();
      const instance2 = PermissionsCollector.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('recordApiCall', () => {
    test('records a single API call', () => {
      const collector = PermissionsCollector.getInstance();
      const call: CapturedApiCall = {
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      };

      collector.recordApiCall(call);
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
      });
    });

    test('records multiple API calls', () => {
      const collector = PermissionsCollector.getInstance();
      const now = new Date();

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: now,
      });
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject',
        timestamp: now,
      });
      collector.recordApiCall({
        service: 'cloudformation',
        action: 'CreateStack',
        timestamp: now,
      });

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(3);
    });

    test('adds current principal to call if not set', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::123456789012:user/test' });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      const calls = collector.getApiCalls();
      expect(calls[0].principal).toBe('arn:aws:iam::123456789012:user/test');
    });

    test('preserves explicitly set principal', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::123456789012:user/test' });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
        principal: 'arn:aws:iam::123456789012:role/custom-role',
      });

      const calls = collector.getApiCalls();
      expect(calls[0].principal).toBe('arn:aws:iam::123456789012:role/custom-role');
    });
  });

  describe('recordAssumedRole', () => {
    test('records an assumed role', () => {
      const collector = PermissionsCollector.getInstance();
      const assumedRole: AssumedRole = {
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        sessionName: 'test-session',
        durationSeconds: 3600,
        timestamp: new Date(),
      };

      collector.recordAssumedRole(assumedRole);
      const roles = collector.getAssumedRoles();

      expect(roles).toHaveLength(1);
      expect(roles[0]).toMatchObject({
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        sessionName: 'test-session',
        durationSeconds: 3600,
      });
    });

    test('updates current principal after assuming role', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::123456789012:user/test' });

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        timestamp: new Date(),
      });

      expect(collector.getCurrentPrincipal()).toBe('arn:aws:iam::123456789012:role/test-role');
    });

    test('tracks assumedBy principal', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::123456789012:user/test' });

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        timestamp: new Date(),
      });

      const roles = collector.getAssumedRoles();
      expect(roles[0].assumedBy).toBe('arn:aws:iam::123456789012:user/test');
    });

    test('does not track when trackRoleChain is false', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ trackRoleChain: false });

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        timestamp: new Date(),
      });

      expect(collector.getAssumedRoles()).toHaveLength(0);
    });
  });

  describe('role chain', () => {
    test('builds role chain from multiple assume role calls', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::111111111111:user/original' });

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::222222222222:role/role-a',
        sessionName: 'session-a',
        timestamp: new Date(),
      });

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::333333333333:role/role-b',
        sessionName: 'session-b',
        timestamp: new Date(),
      });

      const chain = collector.getRoleChain();
      expect(chain.initialPrincipal).toBe('arn:aws:iam::111111111111:user/original');
      expect(chain.roles).toHaveLength(2);
      expect(chain.roles[0].roleArn).toBe('arn:aws:iam::222222222222:role/role-a');
      expect(chain.roles[0].assumedBy).toBe('arn:aws:iam::111111111111:user/original');
      expect(chain.roles[1].roleArn).toBe('arn:aws:iam::333333333333:role/role-b');
      expect(chain.roles[1].assumedBy).toBe('arn:aws:iam::222222222222:role/role-a');
    });
  });

  describe('filtering', () => {
    test('excludes services in excludeServices list', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ excludeServices: ['sts'] });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'sts',
        action: 'AssumeRole',
        timestamp: new Date(),
      });

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('s3');
    });

    test('only includes services in includeServices list', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ includeServices: ['s3', 'cloudformation'] });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'sts',
        action: 'AssumeRole',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'cloudformation',
        action: 'CreateStack',
        timestamp: new Date(),
      });

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(2);
      expect(calls.map(c => c.service)).toEqual(['s3', 'cloudformation']);
    });

    test('excludes specific actions', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ excludeActions: ['s3:GetObject'] });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject',
        timestamp: new Date(),
      });

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('PutObject');
    });

    test('only includes specific actions', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ includeActions: ['s3:GetObject', 'cloudformation:CreateStack'] });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'cloudformation',
        action: 'CreateStack',
        timestamp: new Date(),
      });

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(2);
    });

    test('exclude takes precedence over include', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({
        includeServices: ['s3', 'sts'],
        excludeServices: ['sts'],
      });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'sts',
        action: 'AssumeRole',
        timestamp: new Date(),
      });

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('s3');
    });
  });

  describe('getUniquePermissions', () => {
    test('returns deduplicated sorted permissions', () => {
      const collector = PermissionsCollector.getInstance();
      const now = new Date();

      collector.recordApiCall({ service: 's3', action: 'GetObject', timestamp: now });
      collector.recordApiCall({ service: 's3', action: 'GetObject', timestamp: now }); // duplicate
      collector.recordApiCall({ service: 's3', action: 'PutObject', timestamp: now });
      collector.recordApiCall({ service: 'cloudformation', action: 'CreateStack', timestamp: now });

      const permissions = collector.getUniquePermissions();
      expect(permissions).toEqual([
        'cloudformation:CreateStack',
        's3:GetObject',
        's3:PutObject',
      ]);
    });
  });

  describe('reset', () => {
    test('clears all collected data', () => {
      const collector = PermissionsCollector.getInstance();

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        timestamp: new Date(),
      });

      collector.reset();

      expect(collector.getApiCalls()).toHaveLength(0);
      expect(collector.getAssumedRoles()).toHaveLength(0);
      expect(collector.getRoleChain().roles).toHaveLength(0);
    });

    test('preserves initialPrincipal after reset', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::123456789012:user/test' });

      collector.reset();

      expect(collector.getCurrentPrincipal()).toBe('arn:aws:iam::123456789012:user/test');
      expect(collector.getRoleChain().initialPrincipal).toBe('arn:aws:iam::123456789012:user/test');
    });
  });

  describe('getCollectedPermissions', () => {
    test('returns complete permissions snapshot', () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::123456789012:user/test' });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        timestamp: new Date(),
      });

      const permissions = collector.getCollectedPermissions();

      expect(permissions.apiCalls).toHaveLength(1);
      expect(permissions.assumedRoles).toHaveLength(1);
      expect(permissions.roleChain.initialPrincipal).toBe('arn:aws:iam::123456789012:user/test');
      expect(permissions.roleChain.roles).toHaveLength(1);
    });
  });
});
