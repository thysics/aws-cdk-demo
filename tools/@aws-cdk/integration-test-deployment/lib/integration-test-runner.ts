
import { spawn } from 'child_process';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { AtmosphereAllocation } from './atmosphere';
import { getChangedSnapshots } from './utils';

/**
 * Interface for permissions tracking module.
 * This allows the integration test runner to optionally use permissions tracking
 * if the module is available.
 */
interface PermissionsRunnerLike {
  setupTracking(testName: string): void;
  finalizeTracking(snapshotDir: string, options?: { updateSnapshots?: boolean }): {
    success: boolean;
    snapshotUpdated: boolean;
    message: string;
    diff?: unknown;
  };
  isTrackingActive(): boolean;
  stopTracking(): void;
  getMiddlewarePlugin<Input extends object, Output extends { $metadata: unknown }>(): unknown | undefined;
}

/**
 * Try to load the permissions runner module.
 * Returns undefined if not available.
 */
const tryLoadPermissionsRunner = (): PermissionsRunnerLike | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const permissionsModule = require('@aws-cdk/integ-tests-alpha/lib/permissions');
    return permissionsModule.PermissionsRunner;
  } catch {
    // Module not available or not built yet - that's okay
    return undefined;
  }
};

/**
 * Options for deploying integration tests
 */
export interface DeployIntegTestsOptions {
  atmosphereRoleArn: string;
  endpoint: string;
  pool: string;
  batchSize?: number;
  /**
   * Enable permissions snapshot tracking during test execution.
   * When enabled, all AWS SDK calls will be recorded and compared
   * against stored snapshots.
   *
   * @default false
   */
  enablePermissionsSnapshot?: boolean;
  /**
   * Update permissions snapshots instead of comparing them.
   * Should be set to true when running with --update or --update-on-failed.
   *
   * @default false
   */
  updatePermissionsSnapshot?: boolean;
}

export const deployIntegTests = async (props: DeployIntegTestsOptions) => {
  const batchSize = props.batchSize ?? 3;
  const enablePermissionsSnapshot = props.enablePermissionsSnapshot ?? false;
  const updatePermissionsSnapshot = props.updatePermissionsSnapshot ?? false;

  // Try to load permissions runner if enabled
  let PermissionsRunner: PermissionsRunnerLike | undefined;
  if (enablePermissionsSnapshot) {
    PermissionsRunner = tryLoadPermissionsRunner();
    if (!PermissionsRunner) {
      console.warn('[IntegTestRunner] Permissions tracking enabled but @aws-cdk/integ-tests-alpha module not available');
    }
  }

  const changedSnapshots = await getChangedSnapshots();

  if (changedSnapshots.length === 0) {
    throw new Error('No snapshots changed, skipping deployment integ test.');
  }

  let hasFailure = false;
  const permissionsResults: { snapshot: string; result: ReturnType<PermissionsRunnerLike['finalizeTracking']> }[] = [];

  for (let i = 0; i < changedSnapshots.length; i += batchSize) {
    const batch = changedSnapshots.slice(i, i + batchSize);
    const creds = await assumeAtmosphereRole(props.atmosphereRoleArn);
    const allocation = await AtmosphereAllocation.acquire({
      endpoint: props.endpoint,
      pool: props.pool,
      creds: {
        accessKeyId: creds.AccessKeyId!,
        secretAccessKey: creds.SecretAccessKey!,
        sessionToken: creds.SessionToken!,
      },
    });
    let outcome = 'failure';

    try {
      const env = {
        PATH: process.env.PATH, // Allows the spawn process to find the yarn binary.
        AWS_ACCESS_KEY_ID: allocation.allocation.credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: allocation.allocation.credentials.secretAccessKey,
        AWS_SESSION_TOKEN: allocation.allocation.credentials.sessionToken,
        AWS_REGION: allocation.allocation.environment.region,
        AWS_ACCOUNT_ID: allocation.allocation.environment.account,
        TARGET_BRANCH_COMMIT: process.env.TARGET_BRANCH_COMMIT,
        SOURCE_BRANCH_COMMIT: process.env.SOURCE_BRANCH_COMMIT,
      };

      await bootstrap(env);

      // Setup permissions tracking for each snapshot in the batch
      if (PermissionsRunner) {
        for (const snapshotPath of batch) {
          const testName = getTestNameFromSnapshotPath(snapshotPath);
          PermissionsRunner.setupTracking(testName);
        }
      }

      await deployIntegrationTest(env, batch);
      outcome = 'success';

      // Finalize permissions tracking and validate snapshots
      if (PermissionsRunner) {
        for (const snapshotPath of batch) {
          const snapshotDir = getSnapshotDirectory(snapshotPath);
          const result = PermissionsRunner.finalizeTracking(snapshotDir, {
            updateSnapshots: updatePermissionsSnapshot,
          });

          permissionsResults.push({ snapshot: snapshotPath, result });

          if (!result.success) {
            console.error(`\n[PermissionsSnapshot] ${snapshotPath}:`);
            console.error(result.message);
            hasFailure = true;
          } else if (result.snapshotUpdated) {
            console.log(`[PermissionsSnapshot] Updated: ${snapshotPath}`);
          }
        }
      }
    } catch (e) {
      console.error(e);
      hasFailure = true;

      // Stop permissions tracking on error
      if (PermissionsRunner) {
        PermissionsRunner.stopTracking();
      }
    } finally {
      try {
        await allocation.release(outcome);
      } catch (e) {
        if (e instanceof Error && e.message.includes('The security token included in the request is expired')) {
          // In case of timeouts, the expired security token error can occur. We can skip the release as it will automatically be deleted.
          // Atmosphere will automatically release the resource if a timeout occurs on the backend.
          //
          // Log uses Github warning syntax, see: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-a-warning-message
          console.warn(`::warning::Atmosphere allocation release failed: ${e}`);
          console.warn('Skipping release request as we assume its caused by an integ test timing out.');
        } else {
          throw e;
        }
      }
    }
  }

  // Print summary of permissions snapshot results
  if (permissionsResults.length > 0) {
    printPermissionsResultsSummary(permissionsResults);
  }

  if (hasFailure) {
    throw Error('Deployment integration test did not pass');
  }
};

export const assumeAtmosphereRole = async (roleArn: string) => {
  const sts = new STSClient({});
  const response = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'run-tests@aws-cdk-deployment-integ',
    DurationSeconds: 3600,
  }));

  if (response.Credentials === undefined) throw new Error('Failed to assume atmopshere role');

  return response.Credentials;
};

export const bootstrap = async (env: NodeJS.ProcessEnv) => {
  console.log('Bootstrapping AWS account.');
  const spawnProcess = spawn('npx', ['cdk', 'bootstrap', ...['us-east-1', 'us-east-2', 'us-west-2'].map((region) => `aws://${env.AWS_ACCOUNT_ID}/${region}`)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });

  return new Promise<void>((resolve, reject) => spawnProcess.on('close', (code) => {
    if (code == 0) resolve();
    else reject(new Error(`Account bootstrap failed with exit code ${code}`));
  }));
};

export const deployIntegrationTest = async (env: NodeJS.ProcessEnv, snapshotPaths: string[]) => {
  console.log(`Deploying snapshots:\n${snapshotPaths.join('\n')}`);

  const spawnProcess = spawn('yarn', ['integ-runner', '--disable-update-workflow', '--strict', '--directory', 'packages', '--force', ...snapshotPaths], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });

  return new Promise<void>((resolve, reject) => spawnProcess.on('close', (code) => {
    if (code == 0) resolve();
    else reject(new Error(`Integration tests failed with exit code ${code}`));
  }));
};

/**
 * Extract test name from snapshot path.
 * e.g., "packages/@aws-cdk-testing/framework-integ/test/aws-s3/test/integ.bucket.js.snapshot"
 * returns "aws-s3/integ.bucket"
 */
function getTestNameFromSnapshotPath(snapshotPath: string): string {
  // Extract the integration test filename
  const match = snapshotPath.match(/test\/([^/]+)\/test\/(integ\.[^/]+)\.js\.snapshot$/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  // Fallback: use the snapshot directory name
  const parts = snapshotPath.split('/');
  const snapshotDirName = parts[parts.length - 1] || parts[parts.length - 2];
  return snapshotDirName.replace('.js.snapshot', '').replace('.snapshot', '');
}

/**
 * Get the snapshot directory from a snapshot path.
 * The path may be the snapshot directory itself or a file within it.
 */
function getSnapshotDirectory(snapshotPath: string): string {
  if (snapshotPath.endsWith('.snapshot')) {
    return snapshotPath;
  }
  // Assume it's a path to a file in the snapshot, get the directory
  const parts = snapshotPath.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('.snapshot')) {
      return parts.slice(0, i + 1).join('/');
    }
  }
  return snapshotPath;
}

/**
 * Print a summary of permissions snapshot results.
 */
function printPermissionsResultsSummary(
  results: { snapshot: string; result: ReturnType<PermissionsRunnerLike['finalizeTracking']> }[],
): void {
  const passed = results.filter(r => r.result.success && !r.result.snapshotUpdated);
  const updated = results.filter(r => r.result.snapshotUpdated);
  const failed = results.filter(r => !r.result.success);

  console.log('\n=== Permissions Snapshot Summary ===');
  console.log(`  Passed: ${passed.length}`);
  console.log(`  Updated: ${updated.length}`);
  console.log(`  Failed: ${failed.length}`);

  if (updated.length > 0) {
    console.log('\nUpdated snapshots:');
    for (const r of updated) {
      console.log(`  - ${r.snapshot}`);
    }
  }

  if (failed.length > 0) {
    console.log('\nFailed snapshots (permissions changed):');
    for (const r of failed) {
      console.log(`  - ${r.snapshot}`);
    }
  }

  console.log('');
}
