/**
 * Tests for reporter module.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateReport,
  writeReport,
  generateGitHubActionsOutput,
  TestPermissionResult,
  ReportOptions,
} from '../lib/reporter';
import { SnapshotDiff } from '../lib/snapshot-comparison';

describe('reporter', () => {
  describe('generateReport', () => {
    const createDiff = (overrides: Partial<SnapshotDiff> = {}): SnapshotDiff => ({
      hasChanges: true,
      addedRoles: [],
      removedRoles: [],
      addedServices: [],
      removedServices: [],
      addedActions: {},
      removedActions: {},
      ...overrides,
    });

    const createResults = (): TestPermissionResult[] => [
      {
        testName: 'integ.test1',
        snapshotPath: '/path/to/integ.test1.permissions.snapshot.json',
        passed: true,
      },
      {
        testName: 'integ.test2',
        snapshotPath: '/path/to/integ.test2.permissions.snapshot.json',
        passed: false,
        diff: createDiff({
          addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
          addedActions: { s3: ['GetObject'] },
        }),
      },
      {
        testName: 'integ.test3',
        snapshotPath: '/path/to/integ.test3.permissions.snapshot.json',
        passed: false,
        error: 'Failed to read snapshot file',
      },
    ];

    describe('console format', () => {
      it('generates console report with summary', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'console' });

        expect(report).toContain('PERMISSION SNAPSHOT TEST REPORT');
        expect(report).toContain('Total tests:  3');
        expect(report).toContain('Passed:       1');
        expect(report).toContain('Failed:       1');
        expect(report).toContain('Errors:       1');
      });

      it('includes test result status', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'console' });

        expect(report).toContain('[PASS]  integ.test1');
        expect(report).toContain('[FAIL]  integ.test2');
        expect(report).toContain('[ERROR] integ.test3');
      });

      it('shows permission change counts', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'console' });

        expect(report).toContain('Added roles:    1');
        expect(report).toContain('Added actions:  1');
      });

      it('includes verbose diff when verbose option is true', () => {
        const results: TestPermissionResult[] = [
          {
            testName: 'integ.test1',
            snapshotPath: '/path/to/snapshot',
            passed: false,
            diff: createDiff({
              addedActions: { s3: ['GetObject', 'PutObject'] },
            }),
          },
        ];

        const report = generateReport(results, { format: 'console', verbose: true });

        expect(report).toContain('GetObject');
        expect(report).toContain('PutObject');
      });

      it('includes update snapshot hint for failures', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'console' });

        expect(report).toContain('--update-permissions-snapshot');
      });
    });

    describe('markdown format', () => {
      it('generates markdown report with headers', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'markdown' });

        expect(report).toContain('# Permission Snapshot Test Report');
        expect(report).toContain('## Summary');
        expect(report).toContain('## Test Results');
      });

      it('includes summary table', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'markdown' });

        expect(report).toContain('| Metric | Count |');
        expect(report).toContain('| Total tests | 3 |');
        expect(report).toContain('| Passed | 1 |');
        expect(report).toContain('| Failed | 1 |');
        expect(report).toContain('| Errors | 1 |');
      });

      it('includes permission changes table', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'markdown' });

        expect(report).toContain('### Permission Changes');
        expect(report).toContain('| Change Type | Count |');
        expect(report).toContain('| Added roles | 1 |');
        expect(report).toContain('| Added actions | 1 |');
      });

      it('groups tests by status with emoji indicators', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'markdown' });

        expect(report).toContain('### Passed Tests');
        expect(report).toContain('- ✅ integ.test1');
        expect(report).toContain('### Failed Tests');
        expect(report).toContain('- ❌ integ.test2');
        expect(report).toContain('### Tests with Errors');
        expect(report).toContain('- ⚠️ integ.test3');
      });

      it('includes verbose changelog entries when verbose option is true', () => {
        const results: TestPermissionResult[] = [
          {
            testName: 'integ.test1',
            snapshotPath: '/path/to/snapshot',
            passed: false,
            diff: createDiff({
              addedActions: { s3: ['GetObject'] },
            }),
          },
        ];

        const report = generateReport(results, { format: 'markdown', verbose: true });

        expect(report).toContain('**Added permissions:**');
        expect(report).toContain('- s3:GetObject');
      });

      it('includes update snapshot hint for failures', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'markdown' });

        expect(report).toContain('`--update-permissions-snapshot`');
      });
    });

    describe('json format', () => {
      it('generates valid JSON', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'json' });

        expect(() => JSON.parse(report)).not.toThrow();
      });

      it('includes timestamp', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'json' });
        const parsed = JSON.parse(report);

        expect(parsed.timestamp).toBeDefined();
        expect(new Date(parsed.timestamp).getTime()).not.toBeNaN();
      });

      it('includes summary statistics', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'json' });
        const parsed = JSON.parse(report);

        expect(parsed.summary).toEqual({
          totalTests: 3,
          passedTests: 1,
          failedTests: 1,
          errorTests: 1,
          totalAddedRoles: 1,
          totalRemovedRoles: 0,
          totalAddedActions: 1,
          totalRemovedActions: 0,
        });
      });

      it('includes detailed results for each test', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'json' });
        const parsed = JSON.parse(report);

        expect(parsed.results).toHaveLength(3);

        expect(parsed.results[0]).toEqual({
          testName: 'integ.test1',
          snapshotPath: '/path/to/integ.test1.permissions.snapshot.json',
          status: 'passed',
          diff: undefined,
          error: undefined,
        });

        expect(parsed.results[1].status).toBe('failed');
        expect(parsed.results[1].diff).toBeDefined();

        expect(parsed.results[2].status).toBe('error');
        expect(parsed.results[2].error).toBe('Failed to read snapshot file');
      });

      it('includes diff details in results', () => {
        const results = createResults();
        const report = generateReport(results, { format: 'json' });
        const parsed = JSON.parse(report);

        const failedResult = parsed.results.find((r: any) => r.status === 'failed');
        expect(failedResult.diff.addedRoles).toContain('arn:aws:iam::123456789012:role/NewRole');
        expect(failedResult.diff.addedActions.s3).toContain('GetObject');
      });
    });

    it('throws for unknown format', () => {
      const results = createResults();

      expect(() => generateReport(results, { format: 'xml' as any })).toThrow('unknown report format');
    });
  });

  describe('writeReport', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('writes report to file', () => {
      const content = 'Test report content';
      const outputPath = path.join(tempDir, 'report.txt');

      writeReport(content, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, 'utf-8')).toBe(content);
    });

    it('creates directories if they do not exist', () => {
      const content = 'Test report content';
      const outputPath = path.join(tempDir, 'subdir', 'nested', 'report.txt');

      writeReport(content, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, 'utf-8')).toBe(content);
    });

    it('overwrites existing file', () => {
      const outputPath = path.join(tempDir, 'report.txt');
      fs.writeFileSync(outputPath, 'old content');

      writeReport('new content', outputPath);

      expect(fs.readFileSync(outputPath, 'utf-8')).toBe('new content');
    });
  });

  describe('generateGitHubActionsOutput', () => {
    it('generates error annotations for failed tests', () => {
      const results: TestPermissionResult[] = [
        {
          testName: 'integ.test1',
          snapshotPath: '/path/to/snapshot.json',
          passed: false,
          diff: {
            hasChanges: true,
            addedRoles: ['role1'],
            removedRoles: [],
            addedServices: [],
            removedServices: [],
            addedActions: { s3: ['GetObject'] },
            removedActions: {},
          },
        },
      ];

      const output = generateGitHubActionsOutput(results);

      expect(output).toContain('::error file=/path/to/snapshot.json::');
      expect(output).toContain('integ.test1');
      expect(output).toContain('+1 roles');
      expect(output).toContain('+1 actions');
    });

    it('generates error annotations for error tests', () => {
      const results: TestPermissionResult[] = [
        {
          testName: 'integ.test1',
          snapshotPath: '/path/to/snapshot.json',
          passed: false,
          error: 'Failed to read file',
        },
      ];

      const output = generateGitHubActionsOutput(results);

      expect(output).toContain('::error file=/path/to/snapshot.json::integ.test1: Failed to read file');
    });

    it('generates warning with update hint', () => {
      const results: TestPermissionResult[] = [
        {
          testName: 'integ.test1',
          snapshotPath: '/path/to/snapshot.json',
          passed: false,
          diff: {
            hasChanges: true,
            addedRoles: [],
            removedRoles: ['role1'],
            addedServices: [],
            removedServices: [],
            addedActions: {},
            removedActions: { s3: ['DeleteObject'] },
          },
        },
      ];

      const output = generateGitHubActionsOutput(results);

      expect(output).toContain('::warning::');
      expect(output).toContain('--update-permissions-snapshot');
    });

    it('generates no output for all passing tests', () => {
      const results: TestPermissionResult[] = [
        {
          testName: 'integ.test1',
          snapshotPath: '/path/to/snapshot.json',
          passed: true,
        },
      ];

      const output = generateGitHubActionsOutput(results);

      expect(output).not.toContain('::error');
      expect(output).not.toContain('::warning');
    });

    it('counts removals correctly', () => {
      const results: TestPermissionResult[] = [
        {
          testName: 'integ.test1',
          snapshotPath: '/path/to/snapshot.json',
          passed: false,
          diff: {
            hasChanges: true,
            addedRoles: [],
            removedRoles: ['role1', 'role2'],
            addedServices: [],
            removedServices: [],
            addedActions: {},
            removedActions: { s3: ['GetObject', 'PutObject'], ec2: ['DescribeInstances'] },
          },
        },
      ];

      const output = generateGitHubActionsOutput(results);

      expect(output).toContain('-2 roles');
      expect(output).toContain('-3 actions');
    });
  });
});
