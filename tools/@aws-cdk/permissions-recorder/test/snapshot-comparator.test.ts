import {
  compareSnapshots,
  hasDifferences,
  formatDiff,
  formatDiffForGitHub,
  summarizeDiff,
  SnapshotDiff,
} from '../lib/snapshot-comparator';
import { PermissionsSnapshot } from '../lib/types';

describe('snapshot-comparator', () => {
  const emptySnapshot: PermissionsSnapshot = {
    version: '1.0',
    roles: [],
    actions: {},
  };

  describe('compareSnapshots', () => {
    it('should return empty diff for identical snapshots', () => {
      const snapshot1: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/Role1'],
        actions: { 's3:ListBuckets': 1 },
      };

      const snapshot2: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/Role1'],
        actions: { 's3:ListBuckets': 1 },
      };

      const diff = compareSnapshots(snapshot1, snapshot2);

      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.addedActions).toEqual([]);
      expect(diff.removedActions).toEqual([]);
      expect(diff.changedActionCounts).toEqual([]);
    });

    it('should detect added roles', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/NewRole'],
        actions: {},
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/NewRole']);
      expect(diff.removedRoles).toEqual([]);
    });

    it('should detect removed roles', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/OldRole'],
        actions: {},
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual(['arn:aws:iam::123456789012:role/OldRole']);
    });

    it('should detect added actions', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: { 's3:DeleteBucket': 1 },
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedActions).toEqual(['s3:DeleteBucket']);
      expect(diff.removedActions).toEqual([]);
    });

    it('should detect removed actions', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: { 's3:PutObject': 2 },
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedActions).toEqual([]);
      expect(diff.removedActions).toEqual(['s3:PutObject']);
    });

    it('should detect changed action counts', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: { 'cloudformation:DescribeStacks': 5 },
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: [],
        actions: { 'cloudformation:DescribeStacks': 8 },
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedActions).toEqual([]);
      expect(diff.removedActions).toEqual([]);
      expect(diff.changedActionCounts).toEqual([
        { action: 'cloudformation:DescribeStacks', oldCount: 5, newCount: 8 },
      ]);
    });

    it('should detect multiple differences', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/OldRole'],
        actions: {
          's3:PutObject': 3,
          'cloudformation:DescribeStacks': 5,
        },
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/NewRole'],
        actions: {
          's3:DeleteBucket': 1,
          'cloudformation:DescribeStacks': 8,
        },
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/NewRole']);
      expect(diff.removedRoles).toEqual(['arn:aws:iam::123456789012:role/OldRole']);
      expect(diff.addedActions).toEqual(['s3:DeleteBucket']);
      expect(diff.removedActions).toEqual(['s3:PutObject']);
      expect(diff.changedActionCounts).toEqual([
        { action: 'cloudformation:DescribeStacks', oldCount: 5, newCount: 8 },
      ]);
    });

    it('should sort results alphabetically', () => {
      const expected: PermissionsSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/ZRole'],
        actions: { 'zzz:Action': 1 },
      };

      const actual: PermissionsSnapshot = {
        version: '1.0',
        roles: [
          'arn:aws:iam::123456789012:role/MRole',
          'arn:aws:iam::123456789012:role/ARole',
        ],
        actions: {
          'bbb:Action': 1,
          'aaa:Action': 2,
        },
      };

      const diff = compareSnapshots(expected, actual);

      expect(diff.addedRoles).toEqual([
        'arn:aws:iam::123456789012:role/ARole',
        'arn:aws:iam::123456789012:role/MRole',
      ]);
      expect(diff.addedActions).toEqual(['aaa:Action', 'bbb:Action']);
    });

    it('should handle empty snapshots', () => {
      const diff = compareSnapshots(emptySnapshot, emptySnapshot);

      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.addedActions).toEqual([]);
      expect(diff.removedActions).toEqual([]);
      expect(diff.changedActionCounts).toEqual([]);
    });
  });

  describe('hasDifferences', () => {
    it('should return false for empty diff', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(hasDifferences(diff)).toBe(false);
    });

    it('should return true if roles were added', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['role1'],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(hasDifferences(diff)).toBe(true);
    });

    it('should return true if roles were removed', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: ['role1'],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(hasDifferences(diff)).toBe(true);
    });

    it('should return true if actions were added', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:ListBuckets'],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(hasDifferences(diff)).toBe(true);
    });

    it('should return true if actions were removed', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: ['s3:ListBuckets'],
        changedActionCounts: [],
      };

      expect(hasDifferences(diff)).toBe(true);
    });

    it('should return true if action counts changed', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [{ action: 's3:ListBuckets', oldCount: 1, newCount: 2 }],
      };

      expect(hasDifferences(diff)).toBe(true);
    });
  });

  describe('formatDiff', () => {
    it('should return "No differences found" for empty diff', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(formatDiff(diff)).toBe('No differences found.');
    });

    it('should include test name when provided', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiff(diff, 'integ.lambda.ts');

      expect(output).toContain('Permissions snapshot mismatch for test: integ.lambda.ts');
    });

    it('should format added roles correctly', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiff(diff);

      expect(output).toContain('ADDED ROLES:');
      expect(output).toContain('  + arn:aws:iam::123456789012:role/NewRole');
    });

    it('should format removed roles correctly', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiff(diff);

      expect(output).toContain('REMOVED ROLES:');
      expect(output).toContain('  - arn:aws:iam::123456789012:role/OldRole');
    });

    it('should format added actions correctly', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:DeleteBucket'],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiff(diff);

      expect(output).toContain('ADDED ACTIONS:');
      expect(output).toContain('  + s3:DeleteBucket');
    });

    it('should format removed actions correctly', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: ['s3:PutObject'],
        changedActionCounts: [],
      };

      const output = formatDiff(diff);

      expect(output).toContain('REMOVED ACTIONS:');
      expect(output).toContain('  - s3:PutObject');
    });

    it('should format changed action counts correctly', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [
          { action: 'cloudformation:DescribeStacks', oldCount: 5, newCount: 8 },
        ],
      };

      const output = formatDiff(diff);

      expect(output).toContain('CHANGED ACTION COUNTS:');
      expect(output).toContain('  ~ cloudformation:DescribeStacks: 5 -> 8');
    });

    it('should include update hint', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['role1'],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiff(diff);

      expect(output).toContain('To update the snapshot, run with CDK_INTEG_UPDATE_PERMISSIONS=true');
    });

    it('should format complete diff correctly', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedActions: ['s3:DeleteBucket'],
        removedActions: ['s3:PutObject'],
        changedActionCounts: [
          { action: 'cloudformation:DescribeStacks', oldCount: 5, newCount: 8 },
        ],
      };

      const output = formatDiff(diff, 'integ.lambda.ts');

      expect(output).toMatchSnapshot();
    });
  });

  describe('formatDiffForGitHub', () => {
    it('should return empty string for empty diff', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(formatDiffForGitHub(diff)).toBe('');
    });

    it('should format with ::warning:: syntax', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:DeleteBucket'],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiffForGitHub(diff);

      expect(output).toContain('::warning::Permissions changed:');
      expect(output).toContain('Added actions: s3:DeleteBucket');
    });

    it('should include file annotation when testFile provided', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:DeleteBucket'],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiffForGitHub(diff, 'test/integ.lambda.ts');

      expect(output).toContain('::warning file=test/integ.lambda.ts::');
    });

    it('should generate warnings for all change types', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['role1'],
        removedRoles: ['role2'],
        addedActions: ['action1'],
        removedActions: ['action2'],
        changedActionCounts: [{ action: 'action3', oldCount: 1, newCount: 2 }],
      };

      const output = formatDiffForGitHub(diff);

      expect(output).toContain('Added roles:');
      expect(output).toContain('Removed roles:');
      expect(output).toContain('Added actions:');
      expect(output).toContain('Removed actions:');
      expect(output).toContain('Changed counts:');
    });

    it('should join multiple values with commas', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: ['s3:Action1', 's3:Action2'],
        removedActions: [],
        changedActionCounts: [],
      };

      const output = formatDiffForGitHub(diff);

      expect(output).toContain('s3:Action1, s3:Action2');
    });
  });

  describe('summarizeDiff', () => {
    it('should return "No changes" for empty diff', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(summarizeDiff(diff)).toBe('No changes');
    });

    it('should count added roles', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['role1', 'role2'],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(summarizeDiff(diff)).toContain('2 role(s) added');
    });

    it('should count removed roles', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: ['role1'],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(summarizeDiff(diff)).toContain('1 role(s) removed');
    });

    it('should count added actions', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: ['action1', 'action2', 'action3'],
        removedActions: [],
        changedActionCounts: [],
      };

      expect(summarizeDiff(diff)).toContain('3 action(s) added');
    });

    it('should count removed actions', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: ['action1'],
        changedActionCounts: [],
      };

      expect(summarizeDiff(diff)).toContain('1 action(s) removed');
    });

    it('should count changed action counts', () => {
      const diff: SnapshotDiff = {
        addedRoles: [],
        removedRoles: [],
        addedActions: [],
        removedActions: [],
        changedActionCounts: [
          { action: 'a', oldCount: 1, newCount: 2 },
          { action: 'b', oldCount: 3, newCount: 4 },
        ],
      };

      expect(summarizeDiff(diff)).toContain('2 action count(s) changed');
    });

    it('should join multiple parts with commas', () => {
      const diff: SnapshotDiff = {
        addedRoles: ['role1'],
        removedRoles: [],
        addedActions: ['action1'],
        removedActions: [],
        changedActionCounts: [],
      };

      const summary = summarizeDiff(diff);
      expect(summary).toBe('1 role(s) added, 1 action(s) added');
    });
  });
});
