import {
  PermissionsSnapshot,
  SnapshotData,
  SnapshotValidationError,
  SNAPSHOT_VERSION,
} from '../lib/permissions-snapshot';
import { PermissionsCollector } from '../lib/permissions-collector';

describe('PermissionsSnapshot', () => {
  beforeEach(() => {
    PermissionsCollector.resetInstance();
  });

  describe('fromCollector', () => {
    it('should create snapshot from empty collector', () => {
      const collector = PermissionsCollector.getInstance();
      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'empty-test',
      });

      const json = snapshot.toJSON();
      expect(json.version).toBe(SNAPSHOT_VERSION);
      expect(json.testName).toBe('empty-test');
      expect(json.rolesAssumed).toEqual([]);
      expect(json.actionsPerformed).toEqual([]);
      expect(json.timestamp).toBeDefined();
    });

    it('should create snapshot with single role', () => {
      const collector = PermissionsCollector.getInstance();
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'test-session',
        durationSeconds: 3600,
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'single-role-test',
      });

      const json = snapshot.toJSON();
      expect(json.rolesAssumed).toHaveLength(1);
      expect(json.rolesAssumed[0].roleArn).toBe('arn:aws:iam::123456789012:role/TestRole');
      expect(json.rolesAssumed[0].sessionName).toBe('test-session');
      expect(json.rolesAssumed[0].durationSeconds).toBe(3600);
    });

    it('should create snapshot with multiple roles', () => {
      const collector = PermissionsCollector.getInstance();
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/RoleB',
        sessionName: 'session-b',
        timestamp: new Date(),
      });
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/RoleA',
        sessionName: 'session-a',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'multi-role-test',
      });

      const json = snapshot.toJSON();
      expect(json.rolesAssumed).toHaveLength(2);
      // Roles should be sorted by roleArn
      expect(json.rolesAssumed[0].roleArn).toBe('arn:aws:iam::123456789012:role/RoleA');
      expect(json.rolesAssumed[1].roleArn).toBe('arn:aws:iam::123456789012:role/RoleB');
    });

    it('should deduplicate roles with same ARN', () => {
      const collector = PermissionsCollector.getInstance();
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'session-1',
        timestamp: new Date(),
      });
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'session-2',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'dedup-role-test',
      });

      const json = snapshot.toJSON();
      expect(json.rolesAssumed).toHaveLength(1);
      // First occurrence should be kept
      expect(json.rolesAssumed[0].sessionName).toBe('session-1');
    });

    it('should create snapshot with actions', () => {
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'cloudformation',
        action: 'CreateStack',
        region: 'us-east-1',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'actions-test',
      });

      const json = snapshot.toJSON();
      expect(json.actionsPerformed).toHaveLength(2);
      // Actions should be sorted by service
      expect(json.actionsPerformed[0].service).toBe('cloudformation');
      expect(json.actionsPerformed[1].service).toBe('s3');
    });

    it('should deduplicate actions', () => {
      const collector = PermissionsCollector.getInstance();
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'dedup-actions-test',
      });

      const json = snapshot.toJSON();
      expect(json.actionsPerformed).toHaveLength(1);
    });

    it('should use provided timestamp', () => {
      const collector = PermissionsCollector.getInstance();
      const timestamp = new Date('2024-01-15T10:30:00Z');

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'timestamp-test',
        timestamp,
      });

      expect(snapshot.getTimestamp()).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('toJSON', () => {
    it('should produce deterministic output', () => {
      const collector = PermissionsCollector.getInstance();

      // Add in unsorted order
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject',
        region: 'us-west-2',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'cloudformation',
        action: 'DescribeStacks',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/RoleZ',
        timestamp: new Date(),
      });
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/RoleA',
        timestamp: new Date(),
      });

      const timestamp = new Date('2024-01-15T10:30:00Z');
      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'deterministic-test',
        timestamp,
      });

      const json1 = JSON.stringify(snapshot.toJSON(), null, 2);
      const json2 = JSON.stringify(snapshot.toJSON(), null, 2);

      expect(json1).toBe(json2);

      // Verify sorting
      const parsed = snapshot.toJSON();
      expect(parsed.rolesAssumed[0].roleArn).toContain('RoleA');
      expect(parsed.rolesAssumed[1].roleArn).toContain('RoleZ');
      expect(parsed.actionsPerformed[0].service).toBe('cloudformation');
      expect(parsed.actionsPerformed[1].service).toBe('s3');
      expect(parsed.actionsPerformed[1].action).toBe('GetObject');
      expect(parsed.actionsPerformed[2].service).toBe('s3');
      expect(parsed.actionsPerformed[2].action).toBe('PutObject');
    });

    it('should sort actions by service, then action, then region', () => {
      const collector = PermissionsCollector.getInstance();

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-west-2',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(), // No region
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'sort-test',
      });

      const json = snapshot.toJSON();
      expect(json.actionsPerformed).toHaveLength(3);
      // Empty region should sort first
      expect(json.actionsPerformed[0].region).toBeUndefined();
      expect(json.actionsPerformed[1].region).toBe('us-east-1');
      expect(json.actionsPerformed[2].region).toBe('us-west-2');
    });
  });

  describe('fromJSON', () => {
    it('should parse valid JSON', () => {
      const json: SnapshotData = {
        version: SNAPSHOT_VERSION,
        testName: 'parse-test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [
          { roleArn: 'arn:aws:iam::123456789012:role/TestRole' },
        ],
        actionsPerformed: [
          { service: 's3', action: 'GetObject', region: 'us-east-1' },
        ],
      };

      const snapshot = PermissionsSnapshot.fromJSON(json);

      expect(snapshot.getTestName()).toBe('parse-test');
      expect(snapshot.getTimestamp()).toBe('2024-01-15T10:30:00.000Z');
      expect(snapshot.getRolesAssumed()).toHaveLength(1);
      expect(snapshot.getActionsPerformed()).toHaveLength(1);
    });

    it('should sort data when parsing', () => {
      const json: SnapshotData = {
        version: SNAPSHOT_VERSION,
        testName: 'sort-parse-test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [
          { roleArn: 'arn:aws:iam::123456789012:role/RoleZ' },
          { roleArn: 'arn:aws:iam::123456789012:role/RoleA' },
        ],
        actionsPerformed: [
          { service: 's3', action: 'PutObject' },
          { service: 'cloudformation', action: 'CreateStack' },
        ],
      };

      const snapshot = PermissionsSnapshot.fromJSON(json);
      const output = snapshot.toJSON();

      expect(output.rolesAssumed[0].roleArn).toContain('RoleA');
      expect(output.actionsPerformed[0].service).toBe('cloudformation');
    });

    it('should throw on missing version', () => {
      const json = {
        testName: 'test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('snapshot.version must be a string');
    });

    it('should throw on missing testName', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('snapshot.testName must be a string');
    });

    it('should throw on missing timestamp', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        testName: 'test',
        rolesAssumed: [],
        actionsPerformed: [],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('snapshot.timestamp must be a string');
    });

    it('should throw on non-array rolesAssumed', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        testName: 'test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: 'not-an-array',
        actionsPerformed: [],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('snapshot.rolesAssumed must be an array');
    });

    it('should throw on non-array actionsPerformed', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        testName: 'test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: 'not-an-array',
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('snapshot.actionsPerformed must be an array');
    });

    it('should throw on invalid role object', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        testName: 'test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [{ invalidField: 'value' }],
        actionsPerformed: [],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('rolesAssumed[0].roleArn must be a string');
    });

    it('should throw on invalid action object - missing service', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        testName: 'test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [{ action: 'GetObject' }],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('actionsPerformed[0].service must be a string');
    });

    it('should throw on invalid action object - missing action', () => {
      const json = {
        version: SNAPSHOT_VERSION,
        testName: 'test',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [{ service: 's3' }],
      };

      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(json)).toThrow('actionsPerformed[0].action must be a string');
    });

    it('should throw on null input', () => {
      expect(() => PermissionsSnapshot.fromJSON(null)).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(null)).toThrow('snapshot must be an object');
    });

    it('should throw on primitive input', () => {
      expect(() => PermissionsSnapshot.fromJSON('string')).toThrow(SnapshotValidationError);
      expect(() => PermissionsSnapshot.fromJSON(123)).toThrow(SnapshotValidationError);
    });
  });

  describe('serialization round-trip', () => {
    it('should preserve data through round-trip', () => {
      const collector = PermissionsCollector.getInstance();

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'test-session',
        durationSeconds: 3600,
        assumedBy: 'arn:aws:iam::123456789012:user/TestUser',
        timestamp: new Date(),
      });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        account: '123456789012',
        timestamp: new Date(),
      });

      const timestamp = new Date('2024-01-15T10:30:00Z');
      const original = PermissionsSnapshot.fromCollector(collector, {
        testName: 'round-trip-test',
        timestamp,
      });

      const json = original.toJSON();
      const restored = PermissionsSnapshot.fromJSON(json);

      expect(restored.getTestName()).toBe(original.getTestName());
      expect(restored.getTimestamp()).toBe(original.getTimestamp());
      expect(restored.getVersion()).toBe(original.getVersion());
      expect(restored.getRolesAssumed()).toEqual(original.getRolesAssumed());
      expect(restored.getActionsPerformed()).toEqual(original.getActionsPerformed());
    });

    it('should produce identical JSON after round-trip', () => {
      const collector = PermissionsCollector.getInstance();

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/Role1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        timestamp: new Date(),
      });

      const timestamp = new Date('2024-01-15T10:30:00Z');
      const original = PermissionsSnapshot.fromCollector(collector, {
        testName: 'json-round-trip',
        timestamp,
      });

      const json1 = JSON.stringify(original.toJSON(), null, 2);
      const restored = PermissionsSnapshot.fromJSON(original.toJSON());
      const json2 = JSON.stringify(restored.toJSON(), null, 2);

      expect(json1).toBe(json2);
    });
  });

  describe('multiple roles with overlapping actions', () => {
    it('should handle multiple roles with same actions', () => {
      const collector = PermissionsCollector.getInstance();

      // First role assumes and makes calls
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/Role1',
        sessionName: 'session1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        principal: 'arn:aws:iam::123456789012:role/Role1',
        timestamp: new Date(),
      });

      // Second role assumes and makes same calls
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/Role2',
        sessionName: 'session2',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        principal: 'arn:aws:iam::123456789012:role/Role2',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'overlapping-test',
      });

      const json = snapshot.toJSON();
      // Should have both roles
      expect(json.rolesAssumed).toHaveLength(2);
      // Should deduplicate actions (same service:action:region)
      expect(json.actionsPerformed).toHaveLength(1);
    });

    it('should keep different actions from same role', () => {
      const collector = PermissionsCollector.getInstance();

      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/MultiActionRole',
        timestamp: new Date(),
      });

      collector.recordApiCall({
        service: 's3',
        action: 'GetObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 's3',
        action: 'PutObject',
        region: 'us-east-1',
        timestamp: new Date(),
      });
      collector.recordApiCall({
        service: 'cloudformation',
        action: 'CreateStack',
        region: 'us-east-1',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'multi-action-test',
      });

      const json = snapshot.toJSON();
      expect(json.rolesAssumed).toHaveLength(1);
      expect(json.actionsPerformed).toHaveLength(3);
    });
  });

  describe('getters', () => {
    it('should return copies of internal data', () => {
      const collector = PermissionsCollector.getInstance();
      collector.recordAssumedRole({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        timestamp: new Date(),
      });

      const snapshot = PermissionsSnapshot.fromCollector(collector, {
        testName: 'getter-test',
      });

      const roles1 = snapshot.getRolesAssumed();
      const roles2 = snapshot.getRolesAssumed();

      // Should return copies, not same array instance
      expect(roles1).not.toBe(roles2);
      expect(roles1).toEqual(roles2);

      // Modifying returned array should not affect snapshot
      roles1.push({ roleArn: 'arn:aws:iam::123456789012:role/NewRole' });
      expect(snapshot.getRolesAssumed()).toHaveLength(1);
    });
  });
});
