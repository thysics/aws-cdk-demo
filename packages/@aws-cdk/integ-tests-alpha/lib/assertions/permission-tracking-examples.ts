/**
 * Permission Tracking Examples
 *
 * This file contains examples demonstrating how to use the permission tracking
 * feature with CDK integration tests. These examples are for documentation
 * purposes and show the patterns developers can use.
 *
 * @module @aws-cdk/integ-tests-alpha
 * @see {@link https://github.com/aws/aws-cdk/blob/main/INTEGRATION_TESTS.md#permission-snapshot-testing}
 */

/**
 * Example: Basic Permission Tracking Setup
 *
 * Shows how to set up permission tracking for integration tests.
 * When enabled, all AWS API calls made during the test execution
 * will be recorded and saved as a permission snapshot.
 *
 * @example
 * ```typescript
 * import {
 *   PermissionTracker,
 *   createPermissionTrackerPlugin,
 * } from '@aws-cdk/integ-permissions-tracker';
 * import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
 *
 * // Enable permission tracking on SDK clients
 * const s3Client = new S3Client({});
 * s3Client.middlewareStack.use(createPermissionTrackerPlugin());
 *
 * // Make API calls - they are automatically tracked
 * await s3Client.send(new GetObjectCommand({
 *   Bucket: 'my-bucket',
 *   Key: 'my-key',
 * }));
 *
 * // Get the current permission snapshot
 * const tracker = PermissionTracker.getInstance();
 * const snapshot = tracker.getSnapshot();
 * console.log('Captured permissions:', JSON.stringify(snapshot, null, 2));
 *
 * // Clear for next test
 * tracker.clear();
 * ```
 */
export const basicPermissionTrackingExample = 'basic-permission-tracking';

/**
 * Example: Comparing Permission Snapshots
 *
 * Shows how to compare a current snapshot against a baseline
 * to detect permission changes.
 *
 * @example
 * ```typescript
 * import {
 *   PermissionTracker,
 *   readPermissionSnapshot,
 *   compareSnapshots,
 *   formatSnapshotDiff,
 *   getPermissionSnapshotPath,
 * } from '@aws-cdk/integ-permissions-tracker';
 *
 * // Get current snapshot after test execution
 * const tracker = PermissionTracker.getInstance();
 * const current = tracker.getSnapshot();
 *
 * // Load baseline from file
 * const snapshotPath = getPermissionSnapshotPath('integ.my-test', './test/snapshots');
 * const baseline = readPermissionSnapshot(snapshotPath);
 *
 * // Compare and report
 * const diff = compareSnapshots(baseline, current);
 * if (diff.hasChanges) {
 *   console.log('Permission changes detected:');
 *   console.log(formatSnapshotDiff(diff));
 *
 *   console.log('Added roles:', diff.addedRoles);
 *   console.log('Removed roles:', diff.removedRoles);
 *   console.log('Added actions:', diff.addedActions);
 *   console.log('Removed actions:', diff.removedActions);
 * } else {
 *   console.log('No permission changes');
 * }
 * ```
 */
export const compareSnapshotsExample = 'compare-snapshots';

/**
 * Example: Updating Permission Snapshots
 *
 * Shows how to update permission snapshots when changes are intentional.
 *
 * @example
 * ```typescript
 * import {
 *   PermissionTracker,
 *   readPermissionSnapshot,
 *   writePermissionSnapshot,
 *   compareSnapshots,
 *   getPermissionSnapshotPath,
 * } from '@aws-cdk/integ-permissions-tracker';
 *
 * const snapshotPath = getPermissionSnapshotPath('integ.my-test', './test/snapshots');
 * const tracker = PermissionTracker.getInstance();
 * const current = tracker.getSnapshot();
 * const baseline = readPermissionSnapshot(snapshotPath);
 *
 * const diff = compareSnapshots(baseline, current);
 *
 * // Check if update is requested (e.g., via CLI flag)
 * const shouldUpdate = process.env.CDK_INTEG_UPDATE_PERMISSIONS === 'true';
 *
 * if (diff.hasChanges) {
 *   if (shouldUpdate) {
 *     // Update the snapshot file
 *     writePermissionSnapshot(snapshotPath, current);
 *     console.log(`Updated permission snapshot: ${snapshotPath}`);
 *   } else {
 *     // Fail the test
 *     throw new Error(
 *       `Permission snapshot has changed. Run with --update-permissions-snapshot to update.`
 *     );
 *   }
 * }
 * ```
 */
export const updateSnapshotsExample = 'update-snapshots';

/**
 * Example: Generating Permission Reports
 *
 * Shows how to generate reports from test results for CI/CD integration.
 *
 * @example
 * ```typescript
 * import {
 *   generateReport,
 *   writeReport,
 *   generateGitHubActionsOutput,
 *   TestPermissionResult,
 * } from '@aws-cdk/integ-permissions-tracker';
 *
 * // Collect results from multiple tests
 * const results: TestPermissionResult[] = [
 *   {
 *     testName: 'integ.lambda-function',
 *     snapshotPath: './test/integ.lambda.permissions.snapshot.json',
 *     passed: true,
 *   },
 *   {
 *     testName: 'integ.s3-bucket',
 *     snapshotPath: './test/integ.s3.permissions.snapshot.json',
 *     passed: false,
 *     diff: {
 *       hasChanges: true,
 *       addedRoles: [],
 *       removedRoles: [],
 *       addedServices: ['dynamodb'],
 *       removedServices: [],
 *       addedActions: { dynamodb: ['GetItem', 'PutItem'] },
 *       removedActions: {},
 *     },
 *   },
 * ];
 *
 * // Generate markdown report
 * const markdownReport = generateReport(results, { format: 'markdown' });
 * writeReport(markdownReport, './reports/permissions.md');
 *
 * // Generate JSON report
 * const jsonReport = generateReport(results, { format: 'json' });
 * writeReport(jsonReport, './reports/permissions.json');
 *
 * // Generate GitHub Actions annotations
 * const ghOutput = generateGitHubActionsOutput(results);
 * console.log(ghOutput);
 * ```
 */
export const generateReportsExample = 'generate-reports';

/**
 * Example: Aggregating Multiple Test Snapshots
 *
 * Shows how to combine permission snapshots from multiple tests
 * into a single comprehensive document.
 *
 * @example
 * ```typescript
 * import {
 *   aggregateSnapshots,
 *   formatAggregateAsMarkdown,
 *   writeAggregateSnapshot,
 *   getAggregateStats,
 *   SnapshotInput,
 * } from '@aws-cdk/integ-permissions-tracker';
 *
 * // Collect snapshots from multiple tests
 * const snapshots: SnapshotInput[] = [
 *   {
 *     testName: 'integ.lambda-function',
 *     snapshot: {
 *       version: '1.0',
 *       roles: ['arn:aws:iam::123456789012:role/DeployRole'],
 *       actions: {
 *         lambda: ['CreateFunction', 'DeleteFunction'],
 *         sts: ['AssumeRole'],
 *       },
 *     },
 *   },
 *   {
 *     testName: 'integ.s3-bucket',
 *     snapshot: {
 *       version: '1.0',
 *       roles: ['arn:aws:iam::123456789012:role/DeployRole'],
 *       actions: {
 *         s3: ['CreateBucket', 'DeleteBucket'],
 *         sts: ['AssumeRole'],
 *       },
 *     },
 *   },
 * ];
 *
 * // Create aggregate
 * const aggregate = aggregateSnapshots(snapshots);
 *
 * // Get statistics
 * const stats = getAggregateStats(aggregate);
 * console.log(`Total roles: ${stats.totalRoles}`);
 * console.log(`Total services: ${stats.totalServices}`);
 * console.log(`Total actions: ${stats.totalActions}`);
 *
 * // Save as JSON
 * writeAggregateSnapshot(aggregate, './.permissions/aggregate.json');
 *
 * // Generate markdown documentation
 * const markdown = formatAggregateAsMarkdown(aggregate);
 * console.log(markdown);
 * ```
 */
export const aggregateSnapshotsExample = 'aggregate-snapshots';

/**
 * Example: CLI Helpers for Interactive Output
 *
 * Shows how to use CLI helpers for colored output and interactive prompts.
 *
 * @example
 * ```typescript
 * import {
 *   printPermissionDiff,
 *   printPermissionSummary,
 *   formatChangelogEntry,
 *   PermissionTestResult,
 *   SnapshotDiff,
 * } from '@aws-cdk/integ-permissions-tracker';
 *
 * // Example diff
 * const diff: SnapshotDiff = {
 *   hasChanges: true,
 *   addedRoles: ['arn:aws:iam::123456789012:role/NewRole'],
 *   removedRoles: [],
 *   addedServices: ['dynamodb'],
 *   removedServices: [],
 *   addedActions: {
 *     dynamodb: ['GetItem', 'PutItem'],
 *     lambda: ['InvokeFunction'],
 *   },
 *   removedActions: {
 *     s3: ['DeleteObject'],
 *   },
 * };
 *
 * // Print colored diff to console
 * printPermissionDiff('integ.my-test', diff);
 *
 * // Print summary across multiple tests
 * const results: PermissionTestResult[] = [
 *   { testName: 'integ.test1', passed: true },
 *   { testName: 'integ.test2', passed: false, diff },
 * ];
 * printPermissionSummary(results);
 *
 * // Generate changelog entry
 * const changelog = formatChangelogEntry('integ.my-test', diff);
 * console.log('Changelog entry:');
 * console.log(changelog);
 * ```
 */
export const cliHelpersExample = 'cli-helpers';

/**
 * Example: Integration with IntegTest Construct
 *
 * Shows how permission tracking integrates with the IntegTest construct
 * in a typical integration test file.
 *
 * @example
 * ```typescript
 * // integ.my-feature.ts
 * import * as cdk from 'aws-cdk-lib';
 * import * as lambda from 'aws-cdk-lib/aws-lambda';
 * import * as integ from '@aws-cdk/integ-tests-alpha';
 *
 * const app = new cdk.App();
 * const stack = new cdk.Stack(app, 'MyTestStack');
 *
 * // Create resources
 * const fn = new lambda.Function(stack, 'MyFunction', {
 *   runtime: lambda.Runtime.NODEJS_18_X,
 *   handler: 'index.handler',
 *   code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200 })'),
 * });
 *
 * // Create integration test with permission tracking enabled
 * // Permission tracking is controlled via environment variables:
 * // - CDK_INTEG_PERMISSIONS_SNAPSHOT=true to enable tracking
 * // - CDK_INTEG_UPDATE_PERMISSIONS=true to update snapshots
 * new integ.IntegTest(app, 'MyFeatureTest', {
 *   testCases: [stack],
 * });
 *
 * // Run the test with permission tracking:
 * // $ CDK_INTEG_PERMISSIONS_SNAPSHOT=true yarn integ test/integ.my-feature.js
 * //
 * // Update permission snapshots:
 * // $ yarn integ test/integ.my-feature.js --update-permissions-snapshot
 * ```
 */
export const integTestExample = 'integ-test-integration';
