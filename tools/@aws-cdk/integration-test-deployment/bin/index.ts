#!/usr/bin/env node
import { deployIntegTests, DeployIntegTestsOptions } from '../lib/integration-test-runner';

const endpoint = process.env.CDK_ATMOSPHERE_ENDPOINT;
const pool = process.env.CDK_ATMOSPHERE_POOL;
const atmosphereRoleArn = process.env.CDK_ATMOSPHERE_OIDC_ROLE;
const batchSize = process.env.CDK_ATMOSPHERE_BATCH_SIZE !== undefined ? Number.parseInt(process.env.CDK_ATMOSPHERE_BATCH_SIZE) : undefined;

// Parse command line arguments
const args = process.argv.slice(2);

/**
 * Parses command line flags.
 */
function parseArgs(argv: string[]): {
  updatePermissionsSnapshot: boolean;
  skipPermissionsCheck: boolean;
} {
  return {
    updatePermissionsSnapshot: argv.includes('--update-permissions-snapshot'),
    skipPermissionsCheck: argv.includes('--skip-permissions-check'),
  };
}

const parsedArgs = parseArgs(args);

// Check for --help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: integration-test-deployment [options]

Options:
  --update-permissions-snapshot  Update permissions snapshots when they differ
  --skip-permissions-check       Skip permissions validation entirely
  --help, -h                     Show this help message

Environment Variables:
  CDK_ATMOSPHERE_ENDPOINT        Atmosphere endpoint URL (required)
  CDK_ATMOSPHERE_POOL            Atmosphere pool name (required)
  CDK_ATMOSPHERE_OIDC_ROLE       Atmosphere OIDC role ARN (required)
  CDK_ATMOSPHERE_BATCH_SIZE      Number of tests to run in parallel (default: 3)
  TARGET_BRANCH_COMMIT           Target branch commit for diff comparison
  SOURCE_BRANCH_COMMIT           Source branch commit for diff comparison

Description:
  Runs integration tests that have changed between the target and source branches.
  Automatically tracks permissions used during test execution and compares against
  stored permissions snapshots.

  Permissions snapshots are stored in permissions.snapshot.json files alongside
  each integration test's CloudFormation snapshots.

Examples:
  # Run with default settings
  integration-test-deployment

  # Update permissions snapshots
  integration-test-deployment --update-permissions-snapshot

  # Skip permissions validation
  integration-test-deployment --skip-permissions-check
`);
  process.exit(0);
}

if (!endpoint) {
  throw new Error('CDK_ATMOSPHERE_ENDPOINT environment variable is required');
}

if (!pool) {
  throw new Error('CDK_ATMOSPHERE_POOL environment variable is required');
}

if (!atmosphereRoleArn) {
  throw new Error('CDK_ATMOSPHERE_OIDC_ROLE environment variable is required');
}

const options: DeployIntegTestsOptions = {
  atmosphereRoleArn,
  endpoint,
  pool,
  batchSize,
  permissionsTracking: {
    enabled: !parsedArgs.skipPermissionsCheck,
    skipValidation: parsedArgs.skipPermissionsCheck,
    updateSnapshot: parsedArgs.updatePermissionsSnapshot,
  },
};

deployIntegTests(options).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
