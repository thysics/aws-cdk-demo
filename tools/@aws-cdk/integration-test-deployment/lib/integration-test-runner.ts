
import { spawn } from 'child_process';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  PermissionsRecorder,
  instrumentSdkClient,
  safeWritePermissionsSnapshot,
  ENV_VARS,
} from '@aws-cdk/permissions-recorder';
import { AtmosphereAllocation } from './atmosphere';
import { getChangedSnapshots } from './utils';

/**
 * Configuration for permissions recording
 */
export interface PermissionsRecordingOptions {
  /**
   * Whether to enable permissions recording
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * Base directory for snapshots (snapshot dir will be derived from test paths)
   */
  readonly snapshotBaseDir?: string;
}

/**
 * Get the snapshot directory for a given test path
 * Extracts the .snapshot directory from the test path
 */
function getSnapshotDirForTest(testPath: string): string | undefined {
  // Test path looks like: packages/@aws-cdk-testing/framework-integ/test/aws-lambda/test/integ.lambda.js
  // Snapshot dir should be: packages/@aws-cdk-testing/framework-integ/test/aws-lambda/test/integ.lambda.js.snapshot
  if (testPath.endsWith('.js') || testPath.endsWith('.ts')) {
    return `${testPath}.snapshot`;
  }
  return undefined;
}

export const deployIntegTests = async (props: {
  atmosphereRoleArn: string;
  endpoint: string;
  pool: string;
  batchSize?: number;
  permissionsRecording?: PermissionsRecordingOptions;
}) => {
  const batchSize = props.batchSize ?? 3;
  const permissionsRecordingEnabled = props.permissionsRecording?.enabled ?? true;

  // Initialize permissions recorder if enabled
  const recorder = permissionsRecordingEnabled ? PermissionsRecorder.globalInstance : undefined;

  const changedSnapshots = await getChangedSnapshots();

  if (changedSnapshots.length === 0) {
    throw new Error('No snapshots changed, skipping deployment integ test.');
  }

  let hasFailure = false;

  for (let i = 0; i < changedSnapshots.length; i += batchSize) {
    const batch = changedSnapshots.slice(i, i + batchSize);

    // Reset and start recording for this batch
    if (recorder) {
      recorder.reset();
      recorder.start();
    }

    const creds = await assumeAtmosphereRole(props.atmosphereRoleArn, recorder);
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
      const baseEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH, // Allows the spawn process to find the yarn binary.
        AWS_ACCESS_KEY_ID: allocation.allocation.credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: allocation.allocation.credentials.secretAccessKey,
        AWS_SESSION_TOKEN: allocation.allocation.credentials.sessionToken,
        AWS_REGION: allocation.allocation.environment.region,
        AWS_ACCOUNT_ID: allocation.allocation.environment.account,
        TARGET_BRANCH_COMMIT: process.env.TARGET_BRANCH_COMMIT,
        SOURCE_BRANCH_COMMIT: process.env.SOURCE_BRANCH_COMMIT,
      };

      // Add permissions recording environment variables if enabled
      const env = permissionsRecordingEnabled
        ? {
          ...baseEnv,
          [ENV_VARS.PERMISSIONS_SNAPSHOT]: 'true',
        }
        : baseEnv;

      await bootstrap(env);
      await deployIntegrationTest(env, batch);
      outcome = 'success';
    } catch (e) {
      console.error(e);
      hasFailure = true;
    } finally {
      // Stop recording and write snapshot
      if (recorder) {
        recorder.stop();

        try {
          const snapshot = recorder.getSnapshot();

          // Write snapshot to each test's snapshot directory
          for (const testPath of batch) {
            const snapshotDir = getSnapshotDirForTest(testPath);
            if (snapshotDir) {
              safeWritePermissionsSnapshot(snapshotDir, snapshot);
            }
          }
        } catch (snapshotError) {
          // Log but don't fail the test due to snapshot errors
          console.warn(`::warning::Failed to capture permissions snapshot: ${snapshotError}`);
        }
      }

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

  if (hasFailure) {
    throw Error('Deployment integration test did not pass');
  }
};

export const assumeAtmosphereRole = async (roleArn: string, recorder?: PermissionsRecorder) => {
  const sts = new STSClient({});

  // Instrument the STS client if recording is enabled
  if (recorder) {
    instrumentSdkClient(sts, recorder);
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

  // Add snapshot directory to environment for each test if permissions recording is enabled
  const snapshotDirs = snapshotPaths
    .map(getSnapshotDirForTest)
    .filter((dir): dir is string => dir !== undefined);

  const enhancedEnv: NodeJS.ProcessEnv = {
    ...env,
    // Pass first snapshot dir for now - in future, could support multiple
    ...(snapshotDirs.length > 0 && env[ENV_VARS.PERMISSIONS_SNAPSHOT] === 'true'
      ? { [ENV_VARS.SNAPSHOT_DIR]: snapshotDirs[0] }
      : {}),
  };

  const spawnProcess = spawn('yarn', ['integ-runner', '--disable-update-workflow', '--strict', '--directory', 'packages', '--force', ...snapshotPaths], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: enhancedEnv,
  });

  return new Promise<void>((resolve, reject) => spawnProcess.on('close', (code) => {
    if (code == 0) resolve();
    else reject(new Error(`Integration tests failed with exit code ${code}`));
  }));
};
