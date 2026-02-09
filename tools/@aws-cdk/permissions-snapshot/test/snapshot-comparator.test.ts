import {
  compareSnapshots,
  compareSnapshotFiles,
  formatDiff,
  snapshotsMatch,
  SnapshotDiff,
} from '../lib/snapshot-comparator';
import { PermissionsSnapshot } from '../lib/types';
import { SnapshotFile } from '../lib/snapshot-format';

describe('snapshot-comparator', () => {
  describe('compareSnapshots', () => {
    it('should detect no differences for identical snapshots', () => {
      const snapshot: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/MyRole', assumedVia: 'AssumeRole' },
        ],
      };

      const diff = compareSnapshots(snapshot, snapshot);

      expect(diff.hasDifferences).toBe(false);
      expect(diff.totalChanges).toBe(0);
      expect(diff.actions.added).toHaveLength(0);
      expect(diff.actions.removed).toHaveLength(0);
      expect(diff.roles.added).toHaveLength(0);
      expect(diff.roles.removed).toHaveLength(0);
    });

    it('should detect added actions', () => {
      const baseline: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      const current: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        assumedRoles: [],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.actions.added).toHaveLength(1);
      expect(diff.actions.added[0]).toEqual({ service: 's3', action: 'PutObject' });
      expect(diff.actions.removed).toHaveLength(0);
    });

    it('should detect removed actions', () => {
      const baseline: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        assumedRoles: [],
      };

      const current: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.actions.added).toHaveLength(0);
      expect(diff.actions.removed).toHaveLength(1);
      expect(diff.actions.removed[0]).toEqual({ service: 's3', action: 'PutObject' });
    });

    it('should detect added roles', () => {
      const baseline: PermissionsSnapshot = {
        actions: [],
        assumedRoles: [],
      };

      const current: PermissionsSnapshot = {
        actions: [],
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole', assumedVia: 'AssumeRole' },
        ],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.roles.added).toHaveLength(1);
      expect(diff.roles.added[0].roleArn).toBe('arn:aws:iam::123456789012:role/NewRole');
    });

    it('should detect removed roles', () => {
      const baseline: PermissionsSnapshot = {
        actions: [],
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole', assumedVia: 'AssumeRole' },
        ],
      };

      const current: PermissionsSnapshot = {
        actions: [],
        assumedRoles: [],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.roles.removed).toHaveLength(1);
      expect(diff.roles.removed[0].roleArn).toBe('arn:aws:iam::123456789012:role/OldRole');
    });

    it('should detect multiple changes', () => {
      const baseline: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'DeleteObject' },
        ],
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/OldRole', assumedVia: 'AssumeRole' },
        ],
      };

      const current: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        assumedRoles: [
          { roleArn: 'arn:aws:iam::123456789012:role/NewRole', assumedVia: 'AssumeRole' },
        ],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.totalChanges).toBe(4); // 1 action added, 1 removed, 1 role added, 1 removed
      expect(diff.actions.added).toHaveLength(1);
      expect(diff.actions.removed).toHaveLength(1);
      expect(diff.roles.added).toHaveLength(1);
      expect(diff.roles.removed).toHaveLength(1);
    });

    it('should handle duplicates in input by deduplicating', () => {
      const baseline: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'GetObject' },
        ],
        assumedRoles: [],
      };

      const current: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(false);
    });

    it('should handle different ordering', () => {
      const baseline: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'GetObject' },
          { service: 's3', action: 'PutObject' },
        ],
        assumedRoles: [],
      };

      const current: PermissionsSnapshot = {
        actions: [
          { service: 's3', action: 'PutObject' },
          { service: 's3', action: 'GetObject' },
        ],
        assumedRoles: [],
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasDifferences).toBe(false);
    });
  });

  describe('compareSnapshotFiles', () => {
    const createSnapshotFile = (snapshot: PermissionsSnapshot): SnapshotFile => ({
      metadata: {
        version: '1.0',
        testName: 'test',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
      ...snapshot,
    });

    it('should handle null baseline (new snapshot)', () => {
      const current = createSnapshotFile({
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      });

      const diff = compareSnapshotFiles(null, current);

      expect(diff.hasDifferences).toBe(true);
      expect(diff.actions.added).toHaveLength(1);
    });

    it('should compare two snapshot files', () => {
      const baseline = createSnapshotFile({
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      });

      const current = createSnapshotFile({
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      });

      const diff = compareSnapshotFiles(baseline, current);

      expect(diff.hasDifferences).toBe(false);
    });
  });

  describe('formatDiff', () => {
    it('should format no differences message', () => {
      const diff: SnapshotDiff = {
        hasDifferences: false,
        totalChanges: 0,
        actions: { added: [], removed: [] },
        roles: { added: [], removed: [] },
      };

      const output = formatDiff(diff);

      expect(output).toBe('No differences detected.');
    });

    it('should format added actions', () => {
      const diff: SnapshotDiff = {
        hasDifferences: true,
        totalChanges: 1,
        actions: {
          added: [{ service: 's3', action: 'PutObject' }],
          removed: [],
        },
        roles: { added: [], removed: [] },
      };

      const output = formatDiff(diff);

      expect(output).toContain('+ s3:PutObject');
      expect(output).toContain('Actions:');
    });

    it('should format removed actions', () => {
      const diff: SnapshotDiff = {
        hasDifferences: true,
        totalChanges: 1,
        actions: {
          added: [],
          removed: [{ service: 's3', action: 'DeleteObject' }],
        },
        roles: { added: [], removed: [] },
      };

      const output = formatDiff(diff);

      expect(output).toContain('- s3:DeleteObject');
    });

    it('should format role changes', () => {
      const diff: SnapshotDiff = {
        hasDifferences: true,
        totalChanges: 2,
        actions: { added: [], removed: [] },
        roles: {
          added: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole', assumedVia: 'AssumeRole' }],
          removed: [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole', assumedVia: 'AssumeRole' }],
        },
      };

      const output = formatDiff(diff);

      expect(output).toContain('Assumed Roles:');
      expect(output).toContain('+ arn:aws:iam::123456789012:role/NewRole');
      expect(output).toContain('- arn:aws:iam::123456789012:role/OldRole');
    });

    it('should include total changes count', () => {
      const diff: SnapshotDiff = {
        hasDifferences: true,
        totalChanges: 3,
        actions: {
          added: [{ service: 's3', action: 'PutObject' }],
          removed: [],
        },
        roles: {
          added: [{ roleArn: 'arn:aws:iam::123456789012:role/NewRole', assumedVia: 'AssumeRole' }],
          removed: [{ roleArn: 'arn:aws:iam::123456789012:role/OldRole', assumedVia: 'AssumeRole' }],
        },
      };

      const output = formatDiff(diff);

      expect(output).toContain('3 changes');
    });
  });

  describe('snapshotsMatch', () => {
    it('should return true for matching snapshots', () => {
      const snapshot: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      expect(snapshotsMatch(snapshot, snapshot)).toBe(true);
    });

    it('should return false for different snapshots', () => {
      const baseline: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      const current: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'PutObject' }],
        assumedRoles: [],
      };

      expect(snapshotsMatch(baseline, current)).toBe(false);
    });

    it('should handle null baseline', () => {
      const current: PermissionsSnapshot = {
        actions: [{ service: 's3', action: 'GetObject' }],
        assumedRoles: [],
      };

      expect(snapshotsMatch(null, current)).toBe(false);
    });

    it('should return true for empty snapshots with null baseline', () => {
      const current: PermissionsSnapshot = {
        actions: [],
        assumedRoles: [],
      };

      expect(snapshotsMatch(null, current)).toBe(true);
    });
  });
});
