import {
  SnapshotComparator,
  SnapshotDiffResult,
} from '../lib/snapshot-comparator';
import {
  PermissionsSnapshot,
  SnapshotData,
  SNAPSHOT_VERSION,
} from '../lib/permissions-snapshot';
import { PermissionsCollector } from '../lib/permissions-collector';

describe('SnapshotComparator', () => {
  beforeEach(() => {
    PermissionsCollector.resetInstance();
  });

  const createSnapshot = (
    roles: Array<{ roleArn: string; sessionName?: string }>,
    actions: Array<{ service: string; action: string; region?: string }>,
    testName = 'test',
  ): PermissionsSnapshot => {
    const json: SnapshotData = {
      version: SNAPSHOT_VERSION,
      testName,
      timestamp: '2024-01-15T10:30:00.000Z',
      rolesAssumed: roles,
      actionsPerformed: actions,
    };
    return PermissionsSnapshot.fromJSON(json);
  };

  describe('compare', () => {
    it('should return identical for empty snapshots', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot([], []);

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(true);
      expect(diff.newRoles).toEqual([]);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.newActions).toEqual([]);
      expect(diff.removedActions).toEqual([]);
    });

    it('should return identical for same snapshots', () => {
      const expected = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/TestRole' }],
        [{ service: 's3', action: 'GetObject', region: 'us-east-1' }],
      );
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/TestRole' }],
        [{ service: 's3', action: 'GetObject', region: 'us-east-1' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(true);
    });

    it('should detect new roles', () => {
      const expected = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/ExistingRole' }],
        [],
      );
      const actual = createSnapshot(
        [
          { roleArn: 'arn:aws:iam::123456789012:role/ExistingRole' },
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole', sessionName: 'new-session' },
        ],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.newRoles).toHaveLength(1);
      expect(diff.newRoles[0].roleArn).toBe('arn:aws:iam::123456789012:role/NewRole');
      expect(diff.newRoles[0].sessionName).toBe('new-session');
      expect(diff.removedRoles).toEqual([]);
    });

    it('should detect removed roles', () => {
      const expected = createSnapshot(
        [
          { roleArn: 'arn:aws:iam::123456789012:role/RemainingRole' },
          { roleArn: 'arn:aws:iam::123456789012:role/RemovedRole' },
        ],
        [],
      );
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/RemainingRole' }],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.removedRoles).toHaveLength(1);
      expect(diff.removedRoles[0].roleArn).toBe('arn:aws:iam::123456789012:role/RemovedRole');
      expect(diff.newRoles).toEqual([]);
    });

    it('should detect new actions', () => {
      const expected = createSnapshot(
        [],
        [{ service: 's3', action: 'GetObject' }],
      );
      const actual = createSnapshot(
        [],
        [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject', region: 'us-east-1' },
        ],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.newActions).toHaveLength(1);
      expect(diff.newActions[0].service).toBe('s3');
      expect(diff.newActions[0].action).toBe('PutObject');
      expect(diff.newActions[0].region).toBe('us-east-1');
      expect(diff.removedActions).toEqual([]);
    });

    it('should detect removed actions', () => {
      const expected = createSnapshot(
        [],
        [
          { service: 's3', action: 'GetObject' },
          { service: 'cloudformation', action: 'CreateStack' },
        ],
      );
      const actual = createSnapshot(
        [],
        [{ service: 's3', action: 'GetObject' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.removedActions).toHaveLength(1);
      expect(diff.removedActions[0].service).toBe('cloudformation');
      expect(diff.removedActions[0].action).toBe('CreateStack');
      expect(diff.newActions).toEqual([]);
    });

    it('should detect both new and removed items', () => {
      const expected = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole' }],
        [{ service: 's3', action: 'GetObject' }],
      );
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
        [{ service: 'cloudformation', action: 'CreateStack' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.newRoles).toHaveLength(1);
      expect(diff.removedRoles).toHaveLength(1);
      expect(diff.newActions).toHaveLength(1);
      expect(diff.removedActions).toHaveLength(1);
    });

    it('should differentiate actions by region', () => {
      const expected = createSnapshot(
        [],
        [{ service: 's3', action: 'GetObject', region: 'us-east-1' }],
      );
      const actual = createSnapshot(
        [],
        [{ service: 's3', action: 'GetObject', region: 'us-west-2' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.newActions).toHaveLength(1);
      expect(diff.newActions[0].region).toBe('us-west-2');
      expect(diff.removedActions).toHaveLength(1);
      expect(diff.removedActions[0].region).toBe('us-east-1');
    });

    it('should cache diff result', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot([], []);

      const comparator = new SnapshotComparator(expected, actual);
      const diff1 = comparator.compare();
      const diff2 = comparator.compare();

      expect(diff1).toBe(diff2);
    });
  });

  describe('formatDiff', () => {
    it('should format identical snapshots', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot([], []);

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false });

      expect(output).toContain('✓ Permissions snapshot matches');
    });

    it('should format new roles', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole', sessionName: 'test-session' }],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false });

      expect(output).toContain('✗ Permissions snapshot mismatch');
      expect(output).toContain('New roles assumed (1):');
      expect(output).toContain('+ arn:aws:iam::123456789012:role/NewRole');
      expect(output).toContain('session: test-session');
      expect(output).toContain('Total changes: 1');
    });

    it('should format removed roles', () => {
      const expected = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/RemovedRole' }],
        [],
      );
      const actual = createSnapshot([], []);

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false });

      expect(output).toContain('Removed roles (1):');
      expect(output).toContain('- arn:aws:iam::123456789012:role/RemovedRole');
    });

    it('should format new actions', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [],
        [{ service: 's3', action: 'GetObject', region: 'us-east-1' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false });

      expect(output).toContain('New actions performed (1):');
      expect(output).toContain('+ s3:GetObject (us-east-1)');
    });

    it('should format removed actions', () => {
      const expected = createSnapshot(
        [],
        [{ service: 's3', action: 'GetObject' }],
      );
      const actual = createSnapshot([], []);

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false });

      expect(output).toContain('Removed actions (1):');
      expect(output).toContain('- s3:GetObject');
    });

    it('should format actions without region', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [],
        [{ service: 'cloudformation', action: 'CreateStack' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false });

      // Should not have region suffix
      expect(output).toContain('+ cloudformation:CreateStack');
      expect(output).not.toContain('+ cloudformation:CreateStack (');
    });

    it('should respect maxItemsPerSection option', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [
          { roleArn: 'arn:aws:iam::123456789012:role/Role1' },
          { roleArn: 'arn:aws:iam::123456789012:role/Role2' },
          { roleArn: 'arn:aws:iam::123456789012:role/Role3' },
        ],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false, maxItemsPerSection: 2 });

      expect(output).toContain('+ arn:aws:iam::123456789012:role/Role1');
      expect(output).toContain('+ arn:aws:iam::123456789012:role/Role2');
      expect(output).not.toContain('+ arn:aws:iam::123456789012:role/Role3');
      expect(output).toContain('... and 1 more');
    });

    it('should exclude header when option is false', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: false, includeHeader: false });

      expect(output).not.toContain('✗ Permissions snapshot mismatch');
      expect(output).toContain('New roles assumed');
    });

    it('should include colors when useColors is true', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const output = comparator.formatDiff({ useColors: true });

      // Should contain ANSI color codes
      expect(output).toContain('\x1b[');
    });
  });

  describe('getSummary', () => {
    it('should return message for identical snapshots', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot([], []);

      const comparator = new SnapshotComparator(expected, actual);
      expect(comparator.getSummary()).toBe('Snapshots are identical');
    });

    it('should summarize new roles', () => {
      const expected = createSnapshot([], []);
      const actual = createSnapshot(
        [
          { roleArn: 'arn:aws:iam::123456789012:role/Role1' },
          { roleArn: 'arn:aws:iam::123456789012:role/Role2' },
        ],
        [],
      );

      const comparator = new SnapshotComparator(expected, actual);
      expect(comparator.getSummary()).toBe('Snapshot mismatch: 2 new role(s)');
    });

    it('should summarize all changes', () => {
      const expected = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole' }],
        [{ service: 's3', action: 'GetObject' }],
      );
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole' }],
        [{ service: 'cloudformation', action: 'CreateStack' }],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const summary = comparator.getSummary();

      expect(summary).toContain('Snapshot mismatch:');
      expect(summary).toContain('1 new role(s)');
      expect(summary).toContain('1 removed role(s)');
      expect(summary).toContain('1 new action(s)');
      expect(summary).toContain('1 removed action(s)');
    });
  });

  describe('fromJSON', () => {
    it('should create comparator from JSON', () => {
      const expectedJson: SnapshotData = {
        version: SNAPSHOT_VERSION,
        testName: 'expected',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [{ service: 's3', action: 'GetObject' }],
      };
      const actualJson: SnapshotData = {
        version: SNAPSHOT_VERSION,
        testName: 'actual',
        timestamp: '2024-01-15T10:30:00.000Z',
        rolesAssumed: [],
        actionsPerformed: [{ service: 's3', action: 'PutObject' }],
      };

      const comparator = SnapshotComparator.fromJSON(expectedJson, actualJson);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.newActions).toHaveLength(1);
      expect(diff.removedActions).toHaveLength(1);
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple roles with overlapping actions', () => {
      const expected = createSnapshot(
        [
          { roleArn: 'arn:aws:iam::123456789012:role/SharedRole' },
          { roleArn: 'arn:aws:iam::123456789012:role/Role1' },
        ],
        [
          { service: 's3', action: 'GetObject', region: 'us-east-1' },
          { service: 's3', action: 'PutObject', region: 'us-east-1' },
        ],
      );
      const actual = createSnapshot(
        [
          { roleArn: 'arn:aws:iam::123456789012:role/SharedRole' },
          { roleArn: 'arn:aws:iam::123456789012:role/Role2' },
        ],
        [
          { service: 's3', action: 'GetObject', region: 'us-east-1' },
          { service: 's3', action: 'DeleteObject', region: 'us-east-1' },
        ],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      // Role1 removed, Role2 added, SharedRole unchanged
      expect(diff.newRoles).toHaveLength(1);
      expect(diff.newRoles[0].roleArn).toContain('Role2');
      expect(diff.removedRoles).toHaveLength(1);
      expect(diff.removedRoles[0].roleArn).toContain('Role1');
      // PutObject removed, DeleteObject added, GetObject unchanged
      expect(diff.newActions).toHaveLength(1);
      expect(diff.newActions[0].action).toBe('DeleteObject');
      expect(diff.removedActions).toHaveLength(1);
      expect(diff.removedActions[0].action).toBe('PutObject');
    });

    it('should handle complete replacement of all permissions', () => {
      const expected = createSnapshot(
        [{ roleArn: 'arn:aws:iam::111111111111:role/OldRole' }],
        [
          { service: 'lambda', action: 'InvokeFunction' },
          { service: 'dynamodb', action: 'GetItem' },
        ],
      );
      const actual = createSnapshot(
        [{ roleArn: 'arn:aws:iam::222222222222:role/NewRole' }],
        [
          { service: 'sqs', action: 'SendMessage' },
          { service: 'sns', action: 'Publish' },
        ],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.newRoles).toHaveLength(1);
      expect(diff.removedRoles).toHaveLength(1);
      expect(diff.newActions).toHaveLength(2);
      expect(diff.removedActions).toHaveLength(2);
    });

    it('should handle same actions in different regions', () => {
      const expected = createSnapshot(
        [],
        [
          { service: 's3', action: 'GetObject', region: 'us-east-1' },
          { service: 's3', action: 'GetObject', region: 'us-west-2' },
          { service: 's3', action: 'GetObject', region: 'eu-west-1' },
        ],
      );
      const actual = createSnapshot(
        [],
        [
          { service: 's3', action: 'GetObject', region: 'us-east-1' },
          { service: 's3', action: 'GetObject', region: 'ap-southeast-1' },
          { service: 's3', action: 'GetObject', region: 'eu-west-1' },
        ],
      );

      const comparator = new SnapshotComparator(expected, actual);
      const diff = comparator.compare();

      expect(diff.identical).toBe(false);
      expect(diff.newActions).toHaveLength(1);
      expect(diff.newActions[0].region).toBe('ap-southeast-1');
      expect(diff.removedActions).toHaveLength(1);
      expect(diff.removedActions[0].region).toBe('us-west-2');
    });
  });
});
