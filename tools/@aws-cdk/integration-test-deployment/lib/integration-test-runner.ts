
import { spawn } from 'child_process';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { AtmosphereAllocation } from './atmosphere';
import { getChangedSnapshots } from './utils';
import {
  initializePermissionTracking,
  instrumentStsClient,
  clearPermissionTracker,
  finalizePermissionTracking,
  getSnapshotDirectory,
  getTestName,
  isPermissionTrackingEnabled,
  isUpdateSnapshotsEnabled,
  PermissionTrackingOptions,
  PermissionTrackingContext,
} from './permission-tracking';

/**
 * Options for deploying integration tests.
 */
export interface DeployIntegTestsOptions {
  /**
   * ARN of the Atmosphere role to assume.
   */
  atmosphereRoleArn: string;

  /**
   * Atmosphere endpoint URL.
   */
  endpoint: string;

  /**
   * Atmosphere pool name.
   */
  pool: string;

  /**
   * Number of tests to run in each batch.
   * @default 3
   */
  batchSize?: number;

  /**
   * Options for permission tracking.
   */
  permissionTracking?: PermissionTrackingOptions;
}

export const deployIntegTests = async (props: DeployIntegTestsOptions) => {
  const batchSize = props.batchSize ?? 3;
  const permissionTrackingEnabled = isPermissionTrackingEnabled(props.permissionTracking);
  const updateSnapshots = isUpdateSnapshotsEnabled(props.permissionTracking);

  // log permission tracking status
  if (permissionTrackingEnabled) {
    console.log(`Permission tracking enabled (updateSnapshots: ${updateSnapshots})`);
  }

  const changedSnapshots = await getChangedSnapshots();

  if (changedSnapshots.length === 0) {
    throw new Error('No snapshots changed, skipping deployment integ test.');
  }

  let hasFailure = false;
  let permissionTrackingContext: PermissionTrackingContext | undefined;

  // initialize permission tracking if enabled
  if (permissionTrackingEnabled) {
    permissionTrackingContext = initializePermissionTracking(props.permissionTracking);
  }

  try {
    for (let i = 0; i < changedSnapshots.length; i += batchSize) {
      const batch = changedSnapshots.slice(i, i + batchSize);

      // clear permission tracker before each batch
      if (permissionTrackingContext) {
        clearPermissionTracker(permissionTrackingContext.tracker);
      }

      const creds = await assumeAtmosphereRole(props.atmosphereRoleArn, permissionTrackingContext);
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
        await deployIntegrationTest(env, batch);
        outcome = 'success';

        // finalize permission tracking for each test in the batch
        if (permissionTrackingContext) {
          for (const testPath of batch) {
            const testName = getTestName(testPath);
            const snapshotDir = getSnapshotDirectory(testPath);

            const result = await finalizePermissionTracking(testName, snapshotDir, props.permissionTracking);

            if (!result.passed) {
              console.error(result.message);
              hasFailure = true;
            } else if (result.message) {
              console.log(result.message);
            }
          }
        }
      } catch (e) {
        console.error(e);
        hasFailure = true;
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
  } finally {
    // cleanup permission tracking
    if (permissionTrackingContext) {
      permissionTrackingContext.cleanup();
    }
  }

  if (hasFailure) {
    throw Error('Deployment integration test did not pass');
  }
};

export const assumeAtmosphereRole = async (
  roleArn: string,
  permissionTrackingContext?: PermissionTrackingContext
) => {
  const sts = new STSClient({});

  // instrument the STS client if permission tracking is enabled
  if (permissionTrackingContext) {
    instrumentStsClient(sts, permissionTrackingContext.tracker);
  }

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
