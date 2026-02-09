
import { spawn } from 'child_process';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { AtmosphereAllocation } from './atmosphere';
import { getChangedSnapshots } from './utils';
import {
  PermissionsSnapshotManager,
  PermissionsSnapshotOptions,
  PermissionsCheckResult,
} from './permissions-snapshot-integration';

/**
 * Options for running integration tests with permissions tracking.
 */
export interface DeployIntegTestsOptions {
  atmosphereRoleArn: string;
  endpoint: string;
  pool: string;
  batchSize?: number;
  /**
   * Options for permissions snapshot tracking.
   */
  permissionsSnapshot?: PermissionsSnapshotOptions;
}

export const deployIntegTests = async (props: DeployIntegTestsOptions) => {
  const batchSize = props.batchSize ?? 3;
  const permissionsOptions = props.permissionsSnapshot ?? {};

  const changedSnapshots = await getChangedSnapshots();

  if (changedSnapshots.length === 0) {
    throw new Error('No snapshots changed, skipping deployment integ test.');
  }

  let hasFailure = false;
  const permissionsResults: Map<string, PermissionsCheckResult> = new Map();

  for (let i = 0; i < changedSnapshots.length; i += batchSize) {
    const batch = changedSnapshots.slice(i, i + batchSize);

    // Create permissions manager for this batch
    const permissionsManager = new PermissionsSnapshotManager(permissionsOptions);

    // Create STS client and register for tracking
    const stsClient = new STSClient({});
    permissionsManager.registerStsClient(stsClient);

    const creds = await assumeAtmosphereRoleWithClient(stsClient, props.atmosphereRoleArn);
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

      // Start tracking permissions
      permissionsManager.start();

      await bootstrap(env);
      await deployIntegrationTest(env, batch);
      outcome = 'success';

      // Stop tracking and check snapshots
      permissionsManager.stop();

      // Check permissions snapshots for each test in the batch
      for (const snapshotPath of batch) {
        const testName = extractTestName(snapshotPath);
        const result = await permissionsManager.checkSnapshot(snapshotPath, testName);
        permissionsResults.set(snapshotPath, result);

        if (!result.passed) {
          console.error(`\nPermissions snapshot check failed for ${snapshotPath}:`);
          console.error(result.message);
          if (result.diff) {
            console.error(result.diff);
          }
          hasFailure = true;
        } else if (result.updated) {
          console.log(`\nPermissions snapshot updated for ${snapshotPath}`);
          if (result.diff) {
            console.log(result.diff);
          }
        }
      }
    } catch (e) {
      console.error(e);
      hasFailure = true;
    } finally {
      // Clean up permissions tracking
      permissionsManager.cleanup();

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

  // Print summary of permissions checks
  if (permissionsResults.size > 0) {
    console.log('\n=== Permissions Snapshot Summary ===');
    for (const [testPath, result] of permissionsResults) {
      const status = result.passed ? (result.updated ? '✓ UPDATED' : '✓ PASSED') : '✗ FAILED';
      console.log(`${status}: ${testPath}`);
    }
  }

  if (hasFailure) {
    throw Error('Deployment integration test did not pass');
  }
};

/**
 * Assume the atmosphere role using a provided STS client.
 */
export const assumeAtmosphereRoleWithClient = async (stsClient: STSClient, roleArn: string) => {
  const response = await stsClient.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'run-tests@aws-cdk-deployment-integ',
    DurationSeconds: 3600,
  }));

  if (response.Credentials === undefined) throw new Error('Failed to assume atmopshere role');

  return response.Credentials;
};

/**
 * @deprecated Use assumeAtmosphereRoleWithClient for tracking support
 */
export const assumeAtmosphereRole = async (roleArn: string) => {
  const sts = new STSClient({});
  return assumeAtmosphereRoleWithClient(sts, roleArn);
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
 * Extract a human-readable test name from a snapshot path.
 */
function extractTestName(snapshotPath: string): string {
  // Example: packages/@aws-cdk-testing/framework-integ/test/aws-lambda/test/integ.my-test.ts.snapshot
  const parts = snapshotPath.split('/');
  const filename = parts[parts.length - 1] || parts[parts.length - 2];

  // Remove extensions and .snapshot suffix
  return filename
    .replace(/\.snapshot$/, '')
    .replace(/\.(ts|js)$/, '')
    .replace(/^integ\./, '');
}
