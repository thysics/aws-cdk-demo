/**
 * Tests for cli-helpers module.
 */

import {
  printPermissionDiff,
  printPermissionSummary,
  formatChangelogEntry,
  getPlainTextDiff,
  PermissionTestResult,
} from '../lib/cli-helpers';
import { SnapshotDiff } from '../lib/snapshot-comparison';

describe('cli-helpers', () => {
  // capture console output for testing
  let consoleOutput: string[];
  const originalLog = console.log;

  beforeEach(() => {
    consoleOutput = [];
    console.log = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe('printPermissionDiff', () => {
    it('prints no changes message when diff has no changes', () => {
      const diff: SnapshotDiff = {
        hasChanges: false,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      printPermissionDiff('integ.my-test', diff);

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('integ.my-test');
      expect(consoleOutput[0]).toContain('No permission changes');
    });

    it('prints added roles', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      printPermissionDiff('integ.my-test', diff);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Roles:');
      expect(output).toContain('arn:aws:iam::123456789012:role/NewRole');
      expect(output).toContain('+');
    });

    it('prints removed roles', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      printPermissionDiff('integ.my-test', diff);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Roles:');
      expect(output).toContain('arn:aws:iam::123456789012:role/OldRole');
      expect(output).toContain('-');
    });

    it('prints new services', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: ['lambda'],
        removedServices: [],
        addedActions: { lambda: ['InvokeFunction', 'GetFunction'] },
        removedActions: {},
      };

      printPermissionDiff('integ.my-test', diff);

      const output = consoleOutput.join('\n');
      expect(output).toContain('New services:');
      expect(output).toContain('lambda');
    });

    it('prints verbose actions when verbose option is true', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: ['s3'],
        removedServices: [],
        addedActions: { s3: ['GetObject', 'PutObject'] },
        removedActions: {},
      };

      printPermissionDiff('integ.my-test', diff, { verbose: true });

      const output = consoleOutput.join('\n');
      expect(output).toContain('GetObject');
      expect(output).toContain('PutObject');
    });

    it('prints removed services', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: ['ec2'],
        addedActions: {},
        removedActions: { ec2: ['DescribeInstances'] },
      };

      printPermissionDiff('integ.my-test', diff);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Removed services:');
      expect(output).toContain('ec2');
    });

    it('prints changed services (action changes in existing services)', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: { s3: ['PutObject'] },
        removedActions: { s3: ['DeleteObject'] },
      };

      printPermissionDiff('integ.my-test', diff);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Changed services:');
      expect(output).toContain('s3');
      expect(output).toContain('PutObject');
      expect(output).toContain('DeleteObject');
    });

    it('includes update instructions', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/Role'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      printPermissionDiff('integ.my-test', diff);

      const output = consoleOutput.join('\n');
      expect(output).toContain('--update-permissions-snapshot');
    });
  });

  describe('printPermissionSummary', () => {
    it('prints summary with all passed tests', () => {
      const results: PermissionTestResult[] = [
        { testName: 'integ.test1', passed: true },
        { testName: 'integ.test2', passed: true },
      ];

      printPermissionSummary(results);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Permission Snapshot Summary');
      expect(output).toContain('2 test(s) passed');
      expect(output).not.toContain('failed');
    });

    it('prints summary with failed tests', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['role1'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const results: PermissionTestResult[] = [
        { testName: 'integ.test1', passed: true },
        { testName: 'integ.test2', passed: false, diff },
      ];

      printPermissionSummary(results);

      const output = consoleOutput.join('\n');
      expect(output).toContain('1 test(s) passed');
      expect(output).toContain('1 test(s) failed');
      expect(output).toContain('Failed tests:');
      expect(output).toContain('integ.test2');
    });

    it('shows change count for failed tests', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['role1', 'role2'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: { s3: ['GetObject'] },
        removedActions: {},
      };

      const results: PermissionTestResult[] = [
        { testName: 'integ.test1', passed: false, diff },
      ];

      printPermissionSummary(results);

      const output = consoleOutput.join('\n');
      expect(output).toContain('3 change(s)'); // 2 roles + 1 action
    });
  });

  describe('formatChangelogEntry', () => {
    it('formats added roles correctly', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const entry = formatChangelogEntry('integ.my-test', diff);

      expect(entry).toContain('### Permission changes in integ.my-test');
      expect(entry).toContain('**Added roles:**');
      expect(entry).toContain('arn:aws:iam::123456789012:role/NewRole');
    });

    it('formats removed roles correctly', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: ['arn:aws:iam::123456789012:role/OldRole'],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const entry = formatChangelogEntry('integ.my-test', diff);

      expect(entry).toContain('**Removed roles:**');
      expect(entry).toContain('arn:aws:iam::123456789012:role/OldRole');
    });

    it('formats added permissions with service prefix', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: { s3: ['GetObject', 'PutObject'], lambda: ['InvokeFunction'] },
        removedActions: {},
      };

      const entry = formatChangelogEntry('integ.my-test', diff);

      expect(entry).toContain('**Added permissions:**');
      expect(entry).toContain('lambda:InvokeFunction');
      expect(entry).toContain('s3:GetObject');
      expect(entry).toContain('s3:PutObject');
    });

    it('formats removed permissions with service prefix', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: { ec2: ['DescribeInstances'] },
      };

      const entry = formatChangelogEntry('integ.my-test', diff);

      expect(entry).toContain('**Removed permissions:**');
      expect(entry).toContain('ec2:DescribeInstances');
    });

    it('sorts permissions alphabetically', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: { s3: ['PutObject'], lambda: ['InvokeFunction'], ec2: ['RunInstances'] },
        removedActions: {},
      };

      const entry = formatChangelogEntry('integ.my-test', diff);
      const lines = entry.split('\n');

      const permissionLines = lines.filter(line => line.startsWith('- ') && line.includes(':'));
      const permissions = permissionLines.map(line => line.substring(2));

      // check they are sorted
      expect(permissions).toEqual([...permissions].sort());
    });
  });

  describe('getPlainTextDiff', () => {
    it('returns no changes message when diff has no changes', () => {
      const diff: SnapshotDiff = {
        hasChanges: false,
        addedRoles: [],
        removedRoles: [],
        addedServices: [],
        removedServices: [],
        addedActions: {},
        removedActions: {},
      };

      const text = getPlainTextDiff('integ.my-test', diff);

      expect(text).toContain('✓ integ.my-test: No permission changes');
    });

    it('returns formatted diff without ANSI codes', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['arn:aws:iam::123456789012:role/Role'],
        removedRoles: [],
        addedServices: ['s3'],
        removedServices: [],
        addedActions: { s3: ['GetObject'] },
        removedActions: {},
      };

      const text = getPlainTextDiff('integ.my-test', diff);

      // should not contain ANSI escape codes
      expect(text).not.toContain('\x1b[');

      // should contain diff content
      expect(text).toContain('✗ integ.my-test');
      expect(text).toContain('Roles:');
      expect(text).toContain('New services:');
      expect(text).toContain('--update-permissions-snapshot');
    });

    it('includes all change types in output', () => {
      const diff: SnapshotDiff = {
        hasChanges: true,
        addedRoles: ['role1'],
        removedRoles: ['role2'],
        addedServices: ['s3'],
        removedServices: ['ec2'],
        addedActions: { lambda: ['InvokeFunction'] },
        removedActions: { iam: ['CreateRole'] },
      };

      const text = getPlainTextDiff('integ.my-test', diff);

      expect(text).toContain('Roles:');
      expect(text).toContain('+ role1');
      expect(text).toContain('- role2');
      expect(text).toContain('New services:');
      expect(text).toContain('+ s3');
      expect(text).toContain('Removed services:');
      expect(text).toContain('- ec2');
      expect(text).toContain('Changed services:');
    });
  });
});
