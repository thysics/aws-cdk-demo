import { PermissionsTracker, SNAPSHOT_VERSION } from '../../lib/permissions-snapshot/tracker';

describe('PermissionsTracker', () => {
  let tracker: PermissionsTracker;

  beforeEach(() => {
    PermissionsTracker.clear();
    tracker = PermissionsTracker.initialize({ testName: 'test-tracker' });
  });

  afterEach(() => {
    PermissionsTracker.clear();
  });

  describe('singleton pattern', () => {
    test('getInstance returns the initialized tracker', () => {
      expect(PermissionsTracker.getInstance()).toBe(tracker);
    });

    test('getInstance returns undefined when not initialized', () => {
      PermissionsTracker.clear();
      expect(PermissionsTracker.getInstance()).toBeUndefined();
    });

    test('initialize creates a new tracker', () => {
      const newTracker = PermissionsTracker.initialize({ testName: 'new-test' });
      expect(PermissionsTracker.getInstance()).toBe(newTracker);
    });
  });

  describe('recordAction', () => {
    test('records a basic action', () => {
      tracker.recordAction('s3', 'GetObject');
      const actions = tracker.getRawActions();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ service: 's3', action: 'GetObject' });
    });

    test('normalizes service names', () => {
      tracker.recordAction('@aws-sdk/client-s3', 'GetObject');
      tracker.recordAction('S3', 'PutObject');
      tracker.recordAction('client-s3', 'DeleteObject');

      const actions = tracker.getRawActions();
      expect(actions).toHaveLength(3);
      expect(actions.every(a => a.service === 's3')).toBe(true);
    });

    test('normalizes action names', () => {
      tracker.recordAction('s3', 'getObject');
      tracker.recordAction('s3', 'GetObjectCommand');
      tracker.recordAction('s3', 'GetObject');

      const actions = tracker.getRawActions();
      expect(actions).toHaveLength(3);
      expect(actions.every(a => a.action === 'GetObject')).toBe(true);
    });

    test('excludes actions from specified services', () => {
      PermissionsTracker.clear();
      const trackerWithExclusions = PermissionsTracker.initialize({
        testName: 'test',
        excludeServices: ['cloudwatch'],
      });

      trackerWithExclusions.recordAction('s3', 'GetObject');
      trackerWithExclusions.recordAction('cloudwatch', 'PutMetricData');

      const actions = trackerWithExclusions.getRawActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].service).toBe('s3');
    });

    test('excludes specific actions', () => {
      PermissionsTracker.clear();
      const trackerWithExclusions = PermissionsTracker.initialize({
        testName: 'test',
        excludeActions: ['s3:ListBuckets'],
      });

      trackerWithExclusions.recordAction('s3', 'GetObject');
      trackerWithExclusions.recordAction('s3', 'ListBuckets');

      const actions = trackerWithExclusions.getRawActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('GetObject');
    });
  });

  describe('recordRoleAssumption', () => {
    test('records a role assumption', () => {
      tracker.recordRoleAssumption(
        'arn:aws:iam::123456789012:role/TestRole',
        'session-name',
        'external-id',
      );

      const roles = tracker.getRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0]).toEqual({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'session-name',
        externalId: 'external-id',
      });
    });

    test('does not duplicate role assumptions', () => {
      const roleArn = 'arn:aws:iam::123456789012:role/TestRole';
      tracker.recordRoleAssumption(roleArn, 'session-1');
      tracker.recordRoleAssumption(roleArn, 'session-2');

      const roles = tracker.getRoles();
      expect(roles).toHaveLength(1);
    });

    test('records multiple different roles', () => {
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/Role1');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/Role2');

      const roles = tracker.getRoles();
      expect(roles).toHaveLength(2);
    });
  });

  describe('getAggregatedActions', () => {
    test('aggregates actions with counts', () => {
      tracker.recordAction('s3', 'GetObject');
      tracker.recordAction('s3', 'GetObject');
      tracker.recordAction('s3', 'PutObject');

      const aggregated = tracker.getAggregatedActions();
      expect(aggregated).toHaveLength(2);

      const getObject = aggregated.find(a => a.action === 'GetObject');
      const putObject = aggregated.find(a => a.action === 'PutObject');

      expect(getObject?.count).toBe(2);
      expect(putObject?.count).toBe(1);
    });

    test('sorts actions by service and action name', () => {
      tracker.recordAction('sts', 'AssumeRole');
      tracker.recordAction('s3', 'PutObject');
      tracker.recordAction('s3', 'GetObject');

      const aggregated = tracker.getAggregatedActions();
      expect(aggregated[0]).toMatchObject({ service: 's3', action: 'GetObject' });
      expect(aggregated[1]).toMatchObject({ service: 's3', action: 'PutObject' });
      expect(aggregated[2]).toMatchObject({ service: 'sts', action: 'AssumeRole' });
    });
  });

  describe('generateSnapshot', () => {
    test('generates a valid snapshot', () => {
      tracker.recordAction('s3', 'GetObject');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');

      const snapshot = tracker.generateSnapshot();

      expect(snapshot.version).toBe(SNAPSHOT_VERSION);
      expect(snapshot.testName).toBe('test-tracker');
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.roles).toHaveLength(1);
      expect(snapshot.actions).toHaveLength(1);
    });

    test('generates consistent timestamps', () => {
      const snapshot1 = tracker.generateSnapshot();
      const snapshot2 = tracker.generateSnapshot();

      expect(snapshot1.timestamp).toBe(snapshot2.timestamp);
    });
  });

  describe('reset', () => {
    test('clears all recorded data', () => {
      tracker.recordAction('s3', 'GetObject');
      tracker.recordRoleAssumption('arn:aws:iam::123456789012:role/TestRole');

      tracker.reset();

      expect(tracker.getRawActions()).toHaveLength(0);
      expect(tracker.getRoles()).toHaveLength(0);
    });
  });
});
