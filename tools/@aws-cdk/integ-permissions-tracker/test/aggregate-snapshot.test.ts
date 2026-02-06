/**
 * Tests for aggregate-snapshot module.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  aggregateSnapshots,
  writeAggregateSnapshot,
  readAggregateSnapshot,
  formatAggregateAsMarkdown,
  getAggregateStats,
  getDefaultAggregateSnapshotPath,
  AGGREGATE_SNAPSHOT_FILENAME,
  SnapshotInput,
  AggregateSnapshot,
} from '../lib/aggregate-snapshot';
import { PermissionSnapshot } from '../lib/types';

describe('aggregate-snapshot', () => {
  describe('aggregateSnapshots', () => {
    it('aggregates roles from multiple snapshots', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: ['arn:aws:iam::123456789012:role/Role1'],
            actions: {},
          },
        },
        {
          testName: 'integ.test2',
          snapshot: {
            version: '1.0',
            roles: ['arn:aws:iam::123456789012:role/Role2'],
            actions: {},
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);

      expect(aggregate.roles).toHaveLength(2);
      expect(aggregate.roles).toContain('arn:aws:iam::123456789012:role/Role1');
      expect(aggregate.roles).toContain('arn:aws:iam::123456789012:role/Role2');
    });

    it('deduplicates roles that appear in multiple tests', () => {
      const sharedRole = 'arn:aws:iam::123456789012:role/SharedRole';
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: [sharedRole],
            actions: {},
          },
        },
        {
          testName: 'integ.test2',
          snapshot: {
            version: '1.0',
            roles: [sharedRole],
            actions: {},
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);

      expect(aggregate.roles).toHaveLength(1);
      expect(aggregate.roles).toContain(sharedRole);
    });

    it('aggregates actions from multiple snapshots', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject'] },
          },
        },
        {
          testName: 'integ.test2',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { lambda: ['InvokeFunction'] },
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);

      expect(Object.keys(aggregate.permissions)).toContain('s3');
      expect(Object.keys(aggregate.permissions)).toContain('lambda');
    });

    it('tracks which tests use each action', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject'] },
          },
        },
        {
          testName: 'integ.test2',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject', 'PutObject'] },
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);

      const s3Actions = aggregate.permissions.s3;
      const getObjectAction = s3Actions.find(a => a.action === 'GetObject');
      const putObjectAction = s3Actions.find(a => a.action === 'PutObject');

      expect(getObjectAction?.tests).toEqual(['integ.test1', 'integ.test2']);
      expect(putObjectAction?.tests).toEqual(['integ.test2']);
    });

    it('deduplicates actions across tests', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject', 'PutObject'] },
          },
        },
        {
          testName: 'integ.test2',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject', 'DeleteObject'] },
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);

      expect(aggregate.permissions.s3).toHaveLength(3); // GetObject, PutObject, DeleteObject
    });

    it('sorts services alphabetically', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { lambda: ['InvokeFunction'], ec2: ['DescribeInstances'], s3: ['GetObject'] },
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);
      const services = Object.keys(aggregate.permissions);

      expect(services).toEqual(['ec2', 'lambda', 's3']);
    });

    it('sorts actions within each service alphabetically', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.test1',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['PutObject', 'DeleteObject', 'GetObject'] },
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);
      const actionNames = aggregate.permissions.s3.map(a => a.action);

      expect(actionNames).toEqual(['DeleteObject', 'GetObject', 'PutObject']);
    });

    it('sorts test names within each action alphabetically', () => {
      const snapshots: SnapshotInput[] = [
        {
          testName: 'integ.zebra',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject'] },
          },
        },
        {
          testName: 'integ.alpha',
          snapshot: {
            version: '1.0',
            roles: [],
            actions: { s3: ['GetObject'] },
          },
        },
      ];

      const aggregate = aggregateSnapshots(snapshots);
      const getObjectAction = aggregate.permissions.s3.find(a => a.action === 'GetObject');

      expect(getObjectAction?.tests).toEqual(['integ.alpha', 'integ.zebra']);
    });

    it('sets correct metadata', () => {
      const snapshots: SnapshotInput[] = [
        { testName: 'integ.test1', snapshot: { version: '1.0', roles: [], actions: {} } },
        { testName: 'integ.test2', snapshot: { version: '1.0', roles: [], actions: {} } },
      ];

      const aggregate = aggregateSnapshots(snapshots);

      expect(aggregate.version).toBe('1.0');
      expect(aggregate.testCount).toBe(2);
      expect(new Date(aggregate.generatedAt).getTime()).not.toBeNaN();
    });

    it('handles empty snapshots array', () => {
      const aggregate = aggregateSnapshots([]);

      expect(aggregate.testCount).toBe(0);
      expect(aggregate.roles).toEqual([]);
      expect(aggregate.permissions).toEqual({});
    });
  });

  describe('writeAggregateSnapshot and readAggregateSnapshot', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('writes and reads aggregate snapshot correctly', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 2,
        roles: ['arn:aws:iam::123456789012:role/Role1'],
        permissions: {
          s3: [{ action: 'GetObject', tests: ['integ.test1'] }],
        },
      };
      const filePath = path.join(tempDir, 'aggregate.json');

      writeAggregateSnapshot(aggregate, filePath);
      const loaded = readAggregateSnapshot(filePath);

      expect(loaded).toEqual(aggregate);
    });

    it('creates directory if it does not exist', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 1,
        roles: [],
        permissions: {},
      };
      const filePath = path.join(tempDir, 'subdir', 'nested', 'aggregate.json');

      writeAggregateSnapshot(aggregate, filePath);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('returns undefined when file does not exist', () => {
      const filePath = path.join(tempDir, 'nonexistent.json');

      const result = readAggregateSnapshot(filePath);

      expect(result).toBeUndefined();
    });

    it('writes pretty-printed JSON', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 1,
        roles: [],
        permissions: {},
      };
      const filePath = path.join(tempDir, 'aggregate.json');

      writeAggregateSnapshot(aggregate, filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      // check it's indented (not minified)
      expect(content).toContain('\n');
      expect(content.split('\n').length).toBeGreaterThan(1);
    });
  });

  describe('formatAggregateAsMarkdown', () => {
    it('generates markdown with title and metadata', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: '2024-01-15T10:30:00.000Z',
        testCount: 5,
        roles: [],
        permissions: {},
      };

      const markdown = formatAggregateAsMarkdown(aggregate);

      expect(markdown).toContain('# Required Permissions');
      expect(markdown).toContain('2024-01-15T10:30:00.000Z');
      expect(markdown).toContain('5 integration test(s)');
    });

    it('includes roles section', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 1,
        roles: [
          'arn:aws:iam::123456789012:role/Role1',
          'arn:aws:iam::123456789012:role/Role2',
        ],
        permissions: {},
      };

      const markdown = formatAggregateAsMarkdown(aggregate);

      expect(markdown).toContain('## IAM Roles');
      expect(markdown).toContain('`arn:aws:iam::123456789012:role/Role1`');
      expect(markdown).toContain('`arn:aws:iam::123456789012:role/Role2`');
    });

    it('includes permissions table by service', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 1,
        roles: [],
        permissions: {
          s3: [
            { action: 'GetObject', tests: ['integ.test1'] },
            { action: 'PutObject', tests: ['integ.test1', 'integ.test2'] },
          ],
        },
      };

      const markdown = formatAggregateAsMarkdown(aggregate);

      expect(markdown).toContain('### s3');
      expect(markdown).toContain('| Action | Used by Tests |');
      expect(markdown).toContain('| `GetObject` | integ.test1 |');
      expect(markdown).toContain('| `PutObject` | integ.test1, integ.test2 |');
    });

    it('truncates long test lists with count', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 10,
        roles: [],
        permissions: {
          s3: [
            {
              action: 'GetObject',
              tests: ['integ.test1', 'integ.test2', 'integ.test3', 'integ.test4', 'integ.test5'],
            },
          ],
        },
      };

      const markdown = formatAggregateAsMarkdown(aggregate);

      expect(markdown).toContain('(+2 more)');
    });
  });

  describe('getAggregateStats', () => {
    it('calculates correct statistics', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 3,
        roles: ['role1', 'role2'],
        permissions: {
          s3: [
            { action: 'GetObject', tests: [] },
            { action: 'PutObject', tests: [] },
          ],
          lambda: [{ action: 'InvokeFunction', tests: [] }],
          ec2: [
            { action: 'DescribeInstances', tests: [] },
            { action: 'RunInstances', tests: [] },
            { action: 'TerminateInstances', tests: [] },
          ],
        },
      };

      const stats = getAggregateStats(aggregate);

      expect(stats.totalRoles).toBe(2);
      expect(stats.totalServices).toBe(3);
      expect(stats.totalActions).toBe(6);
      expect(stats.actionsByService).toEqual({
        s3: 2,
        lambda: 1,
        ec2: 3,
      });
    });

    it('handles empty aggregate', () => {
      const aggregate: AggregateSnapshot = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        testCount: 0,
        roles: [],
        permissions: {},
      };

      const stats = getAggregateStats(aggregate);

      expect(stats.totalRoles).toBe(0);
      expect(stats.totalServices).toBe(0);
      expect(stats.totalActions).toBe(0);
      expect(stats.actionsByService).toEqual({});
    });
  });

  describe('getDefaultAggregateSnapshotPath', () => {
    it('returns correct default path', () => {
      const projectRoot = '/home/user/my-project';
      const result = getDefaultAggregateSnapshotPath(projectRoot);

      expect(result).toBe('/home/user/my-project/.permissions/permissions-aggregate.json');
    });
  });

  describe('AGGREGATE_SNAPSHOT_FILENAME', () => {
    it('has correct value', () => {
      expect(AGGREGATE_SNAPSHOT_FILENAME).toBe('permissions-aggregate.json');
    });
  });
});
