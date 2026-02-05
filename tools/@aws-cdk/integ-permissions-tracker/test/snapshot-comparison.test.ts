/**
 * Unit tests for snapshot comparison utilities.
 */

import {
  compareSnapshots,
  formatSnapshotDiff,
  snapshotsAreEqual,
  SnapshotDiff,
} from '../lib/snapshot-comparison';
import { PermissionSnapshot } from '../lib/types';

describe('snapshot-comparison', () => {
  describe('compareSnapshots', () => {
    test('returns no changes for identical snapshots', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: {
          s3: ['GetObject', 'PutObject'],
          lambda: ['InvokeFunction'],
        },
      };

      const diff = compareSnapshots(snapshot, snapshot);

      expect(diff.hasChanges).toBe(false);
      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.addedServices).toEqual([]);
      expect(diff.removedServices).toEqual([]);
      expect(diff.addedActions).toEqual({});
      expect(diff.removedActions).toEqual({});
    });

    test('detects added roles', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/RoleA'],
        actions: {},
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/RoleA', 'arn:aws:iam::123456789012:role/RoleB'],
        actions: {},
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/RoleB']);
      expect(diff.removedRoles).toEqual([]);
    });

    test('detects removed roles', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/RoleA', 'arn:aws:iam::123456789012:role/RoleB'],
        actions: {},
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/RoleA'],
        actions: {},
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual([]);
      expect(diff.removedRoles).toEqual(['arn:aws:iam::123456789012:role/RoleB']);
    });

    test('detects added services', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
          lambda: ['InvokeFunction'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedServices).toEqual(['lambda']);
      expect(diff.removedServices).toEqual([]);
      expect(diff.addedActions).toEqual({ lambda: ['InvokeFunction'] });
    });

    test('detects removed services', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
          lambda: ['InvokeFunction'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedServices).toEqual([]);
      expect(diff.removedServices).toEqual(['lambda']);
      expect(diff.removedActions).toEqual({ lambda: ['InvokeFunction'] });
    });

    test('detects added actions in existing service', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject', 'PutObject'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedServices).toEqual([]);
      expect(diff.addedActions).toEqual({ s3: ['PutObject'] });
    });

    test('detects removed actions in existing service', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject', 'PutObject'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.removedServices).toEqual([]);
      expect(diff.removedActions).toEqual({ s3: ['PutObject'] });
    });

    test('handles undefined baseline (new test)', () => {
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: {
          s3: ['GetObject'],
          lambda: ['InvokeFunction'],
        },
      };

      const diff = compareSnapshots(undefined, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/TestRole']);
      expect(diff.removedRoles).toEqual([]);
      expect(diff.addedServices).toEqual(['lambda', 's3']);
      expect(diff.removedServices).toEqual([]);
      expect(diff.addedActions).toEqual({
        lambda: ['InvokeFunction'],
        s3: ['GetObject'],
      });
      expect(diff.removedActions).toEqual({});
    });

    test('handles empty baseline', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: {
          s3: ['GetObject'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['arn:aws:iam::123456789012:role/TestRole']);
      expect(diff.addedServices).toEqual(['s3']);
      expect(diff.addedActions).toEqual({ s3: ['GetObject'] });
    });

    test('handles empty current snapshot', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: ['arn:aws:iam::123456789012:role/TestRole'],
        actions: {
          s3: ['GetObject'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.removedRoles).toEqual(['arn:aws:iam::123456789012:role/TestRole']);
      expect(diff.removedServices).toEqual(['s3']);
      expect(diff.removedActions).toEqual({ s3: ['GetObject'] });
    });

    test('handles complex changes with multiple services', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a', 'role-b'],
        actions: {
          s3: ['GetObject', 'PutObject'],
          lambda: ['InvokeFunction'],
          iam: ['GetRole'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-b', 'role-c'],
        actions: {
          s3: ['GetObject', 'DeleteObject'],
          lambda: ['InvokeFunction'],
          ec2: ['DescribeInstances'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.hasChanges).toBe(true);
      expect(diff.addedRoles).toEqual(['role-c']);
      expect(diff.removedRoles).toEqual(['role-a']);
      expect(diff.addedServices).toEqual(['ec2']);
      expect(diff.removedServices).toEqual(['iam']);
      expect(diff.addedActions).toEqual({
        ec2: ['DescribeInstances'],
        s3: ['DeleteObject'],
      });
      expect(diff.removedActions).toEqual({
        iam: ['GetRole'],
        s3: ['PutObject'],
      });
    });

    test('sorts added actions alphabetically', () => {
      const baseline: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject'],
        },
      };
      const current: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {
          s3: ['GetObject', 'ZetaAction', 'AlphaAction'],
        },
      };

      const diff = compareSnapshots(baseline, current);

      expect(diff.addedActions.s3).toEqual(['AlphaAction', 'ZetaAction']);
    });
  });

  describe('formatSnapshotDiff', () => {
    test('returns message for no changes', () => {
      const diff: SnapshotDiff = {
        hasChanges: false,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toBe('No permission changes detected.');
    });

    test('formats added roles', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('Roles:');
      expect(result).toContain('+ arn:aws:iam::123456789012:role/NewRole');
    });

    test('formats removed roles', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('Roles:');
      expect(result).toContain('- arn:aws:iam::123456789012:role/OldRole');
    });

    test('formats new services', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: ['lambda'],
        removedServices: [],
        addedActions: { lambda: ['InvokeFunction'] },
        removedActions: {},
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('New services:');
      expect(result).toContain('+ lambda');
      expect(result).toContain('+ InvokeFunction');
    });

    test('formats removed services', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: ['lambda'],
        addedActions: {},
        removedActions: { lambda: ['InvokeFunction'] },
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('Removed services:');
      expect(result).toContain('- lambda');
      expect(result).toContain('- InvokeFunction');
    });

    test('formats changed services with action changes', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: { s3: ['PutObject'] },
        removedActions: { s3: ['GetObject'] },
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('Changed services:');
      expect(result).toContain('s3:');
      expect(result).toContain('+ PutObject');
      expect(result).toContain('- GetObject');
    });

    test('includes update instructions', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['role'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('--update-permissions-snapshot');
    });

    test('formats complex diff with multiple change types', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['new-role'],
        removedRoles: ['old-role'],
        addedServices: ['newservice'],
        removedServices: ['oldservice'],
        addedActions: {
          s3: ['PutObject'],
          newservice: ['Action1'],
        },
        removedActions: {
          s3: ['GetObject'],
          oldservice: ['Action2'],
        },
      };

      const result = formatSnapshotDiff(diff);

      expect(result).toContain('Permission snapshot has changed:');
      expect(result).toContain('Roles:');
      expect(result).toContain('- old-role');
      expect(result).toContain('+ new-role');
      expect(result).toContain('New services:');
      expect(result).toContain('Removed services:');
      expect(result).toContain('Changed services:');
    });
  });

  describe('snapshotsAreEqual', () => {
    test('returns true for identical snapshots', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a'],
        actions: { s3: ['GetObject'] },
      };

      expect(snapshotsAreEqual(snapshot, snapshot)).toBe(true);
    });

    test('returns true for equivalent snapshots', () => {
      const snapshot1: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a', 'role-b'],
        actions: { s3: ['GetObject', 'PutObject'] },
      };
      const snapshot2: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a', 'role-b'],
        actions: { s3: ['GetObject', 'PutObject'] },
      };

      expect(snapshotsAreEqual(snapshot1, snapshot2)).toBe(true);
    });

    test('returns false for different snapshots', () => {
      const snapshot1: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-a'],
        actions: { s3: ['GetObject'] },
      };
      const snapshot2: PermissionSnapshot = {
        version: '1.0',
        roles: ['role-b'],
        actions: { s3: ['GetObject'] },
      };

      expect(snapshotsAreEqual(snapshot1, snapshot2)).toBe(false);
    });

    test('returns true for both undefined', () => {
      expect(snapshotsAreEqual(undefined, undefined)).toBe(true);
    });

    test('returns false when one is undefined', () => {
      const snapshot: PermissionSnapshot = {
        version: '1.0',
        roles: [],
        actions: {},
      };

      expect(snapshotsAreEqual(undefined, snapshot)).toBe(false);
      expect(snapshotsAreEqual(snapshot, undefined)).toBe(false);
    });
  });
});
