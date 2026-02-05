# Integration Tests

This document describes the purpose of integration tests as well as acting as a guide
on what type of changes require integrations tests and how you should write integration tests.

- [Integration Tests](#integration-tests)
  - [What are CDK Integration Tests](#what-are-cdk-integration-tests)
  - [When are Integration Tests Required](#when-are-integration-tests-required)
  - [How to write Integration Tests](#how-to-write-integration-tests)
    - [Creating a Test](#creating-a-test)
    - [New L2 Constructs](#new-l2-constructs)
    - [Existing L2 Constructs](#existing-l2-constructs)
    - [Assertions](#assertions)
  - [Running Integration Tests](#running-integration-tests)
    - [Running large numbers of Tests](#running-large-numbers-of-tests)
  - [Permissions Snapshot Testing](#permissions-snapshot-testing)
    - [Purpose and Benefits](#purpose-and-benefits)
    - [How It Works](#how-it-works)
    - [Snapshot File Format](#snapshot-file-format)
    - [Complete Annotated Example](#complete-annotated-example)
    - [CLI Flags for Permissions Snapshots](#cli-flags-for-permissions-snapshots)
    - [Interpreting Permissions Diffs](#interpreting-permissions-diffs)
    - [Determining if Changes are Expected](#determining-if-changes-are-expected)
    - [Updating Permissions Snapshots](#updating-permissions-snapshots)
    - [Troubleshooting Common Issues](#troubleshooting-common-issues)

## What are CDK Integration Tests

All Construct libraries in the CDK code base have integration tests that serve to -

1. Acts as a regression detector. It does this by running `cdk synth` on the integration test and comparing it against
   the Cloud Assembly stored in the snapshot (`*.snapshot/`) directory. This highlights how a change affects the synthesized stacks.
2. Allows for a way to verify if the stacks are still valid CloudFormation templates, as part of an intrusive change.
   This is done by running `yarn integ` which will run `cdk deploy` across all of the integration tests in that package.
   If you are developing a new integration test or for some other reason want to work on a single integration test
   over and over again without running through all the integration tests you can do so using
   `yarn integ integ.test-name.js`. Remember to set up AWS credentials before doing this.
3. (Optionally) Acts as a way to validate that constructs set up the CloudFormation resources as expected.
   A successful CloudFormation deployment does not mean that the resources are set up correctly.


## When are Integration Tests Required

The following list contains common scenarios where we _know_ that integration tests are required.
This is not an exhaustive list and we will, by default, require integration tests for all
new features unless there is a good reason why one is not needed.

**1. Adding a new feature that is using previously unused CloudFormation resource types**
For example, adding a new L2 construct for an L1 resource. There should be a new integration test
to test that the new L2 successfully creates the resources in AWS.

**2. Adding a new feature that is using previously unused (or untested) CloudFormation properties**
For example, there is an existing L2 construct for a CloudFormation resource and you are adding
support for a new property. This could be either a new property that has been added to CloudFormation
or an existing property that the CDK did not have coverage for. You should either update and existing
integration test to cover this new property or create a new test.

Sometimes the CloudFormation documentation is incorrect or unclear on the correct way to configure
a property. This can lead to introducing new features that don't actually work. Creating
an integration test for the new feature can ensure that it works and avoid unnecessary bugs.

**3. Involves configuring resource types across services (i.e. integrations)**
For example, you are adding functionality that allows for service x to integrate with service y.
A good example of this is the [aws-stepfunctions-tasks](./packages/aws-cdk-lib/aws-stepfunctions-tasks) or
[aws-apigatewayv2-integrations-alpha](./packages/@aws-cdk/aws-apigatewayv2-integrations-alpha) modules. Both of these
have L2 constructs that provide functionality to integrate services.

Sometimes these integrations involve configuring/formatting json/vtl or some other type of data.
For these types of features it is important to create an integration test that not only validates
that the infrastructure deploys successfully, but that the intended functionality works. This could
mean deploying the integration test and then manually making an HTTP request or invoking a Lambda function.

**4. Adding a new supported version (e.g. a new [AuroraMysqlEngineVersion](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.AuroraMysqlEngineVersion.html))**
Sometimes new versions introduce new CloudFormation properties or new required configuration.
For example Aurora MySQL version 8 introduced a new parameter and was not compatible with the
existing parameter (see [#19145](https://github.com/aws/aws-cdk/pull/19145)).

**5. Adding any functionality via a [Custom Resource](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources-readme.html)**
Custom resources involve non-standard functionality and are at a higher risk of introducing bugs.

## How to write Integration Tests

This section will detail how to write integration tests, how they are executed and how to ensure
you have good test coverage.

### Creating a Test

Integration tests for stable modules live in `@aws-cdk-testing/framework-integ/test/MODULE_NAME/test/`. Alpha module integ tests still live in their `test/` directories. Names of integration tests start with integ (e.g. `integ.*.ts`).

To create a new integration test, first create a new file, for example `integ.my-new-construct.ts`.
The contents of this file should be a CDK app. For example, a very simple integration test for a
Lambda Function would look like this:

_integ.lambda.ts_
```ts
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as integ from '@aws-cdk/integ-tests-alpha';

const app = new cdk.App();

const stack = new cdk.Stack(app, 'aws-cdk-lambda-1');

const fn = new lambda.Function(stack, 'MyLambda', {
  code: new lambda.InlineCode('foo'),
  handler: 'index.handler',
  runtime: lambda.Runtime.NODEJS_LATEST,
});

new integ.IntegTest(app, 'LambdaTest', {
  testCases: [stack],
});
```

To run the test you would run:

*Note - filename must be `*.js`*
```
yarn integ --update-on-failed integ.lambda.js
```

This will:
1. Synthesize the CDK app
2. `cdk deploy` to your AWS account
3. `cdk destroy` to delete the stack
4. Save a snapshot of the Cloud Assembly to `integ.lambda.js.snapshot/`

Now when you run `npm test` it will synth the integ app and compare the result with the snapshot.
If the snapshot has changed the same process must be followed to update the snapshot.

### New L2 Constructs

When creating a new L2 construct (or new construct library) it is important to ensure you have a good
coverage base from which future contributions can build on.

Some general rules to follow are:

- **1 test with all default values**
One test for each L2 that only populates the required properties. For a Lambda Function this would look like:

```ts
new lambda.Function(this, 'Handler', {
  code,
  handler,
  runtime,
});
```

- **1 test with all values provided**
One test for each L2 that populates non-default properties. Some of this will come down to judgement, but this should
be based on major functionality. For example, when testing a Lambda Function there are 37 (*at the time of this writing) different
input parameters. Some of these can be tested together and don't represent large pieces of functionality,
while others do.

For example, the test for a Lambda Function might look like this. For most of these properties we are probably fine
testing them together and just testing one of their values. For example we don't gain much by testing a bunch of
different `memorySize` settings, as long as we test that we can `set` the memorySize then we should be good.

```ts
new lambda.Function(this, 'Handler', {
  code,
  handler,
  runtime,
  architecture,
  description,
  environment,
  environmentEncryption,
  functionName,
  initialPolicy,
  insightsVersion,
  layers,
  maxEventAge,
  memorySize,
  reservedConcurrentExecutions,
  retryAttempts,
  role,
  timeout,
  tracing,
});
```

Other parameters might represent larger pieces of functionality and might create other resources for us or configure
integrations with other services. For these it might make sense to split them out into separate tests so it is easier
to reason about them.

A couple of examples would be
(you could also mix in different configurations of the above parameters with each of these):

_testing filesystems_
```ts
new lambda.Function(this, 'Handler', {
  filesystem,
});
```

_testing event sources_
```ts
new lambda.Function(this, 'Handler', {
  events,
});
```

_testing VPCs_
```ts
new lambda.Function(this, 'Handler', {
  securityGroups,
  vpc,
  vpcSubnets,
});
```

### Existing L2 Constructs

Updating an existing L2 Construct could consist of:

1. **Adding coverage for a new (or previously uncovered) CloudFormation property.**
In this case you would want to either add this new property to an existing integration test or create a new
integration test. A new integration test is preferred for larger update (e.g. adding VPC connectivity, etc).

2. **Updating functionality for an existing property.**
In this case you should first check if you are already covered by an existing integration test. If not, then you would follow the
same process as adding new coverage.

3. **Changing functionality that affects asset bundling**
Some constructs deal with asset bundling (i.e. `aws-lambda-nodejs`, `aws-lambda-python`, etc). There are some updates that may not
touch any CloudFormation property, but instead change the way that code is bundled. While these types of changes may not require
a change to an integration test, you need to make sure that the integration tests and assertions are rerun.

An example of this would be making a change to the way `aws-lambda-nodejs` bundles Lambda code. A couple of things could go wrong that would
only be caught by rerunning the integration tests. 

1. The bundling commands are only running when performing a real synth (not part of unit tests). Running the integration test confirms
that the actual bundling was not broken.
2. When deploying Lambda Functions, CloudFormation will only update the Function configuration with the new code,
but it will not validate that the Lambda function can be invoked. Because of this, it is important to rerun the integration test
to deploy the Lambda Function _and_ then rerun the assertions to ensure that the function can still be invoked.

### Assertions

Sometimes it is necessary to perform some form of _assertion_ against the deployed infrastructure to validate that the
test succeeds. A good example of this is the `aws-cdk-lib/aws-stepfunctions-tasks` module which creates integrations between
AWS StepFunctions and other AWS services. 

If we look at the [integ.put-events.ts](https://github.com/aws/aws-cdk/blob/main/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/eventbridge/integ.put-events.ts)
integration test we can see that we are creating an `aws-cdk-lib/aws-events.EventBus` along with a `aws-cdk-lib/aws-stepfunctions.StateMachine`
which will send an event to the `EventBus`. In a typical integration test we would just deploy the test and the fact that the
infrastructure deployed successfully would be enough of a validation that the test succeeded. In this case though, we ideally
want to validate that the _integration_ connecting `StepFunctions` to the `EventBus` has been setup correctly, and the only
way to do that is to actually trigger the `StateMachine` and validate that it was successful.

```ts
import * as integ from '@aws-cdk/integ-tests-alpha';

declare const app: App;
declare const sm: sfn.StateMachine;
declare const stack: Stack;

const testCase = new integ.IntegTest(app, 'PutEvents', {
  testCases: [stack],
});

// Start an execution
const start = testCase.assertions.awsApiCall('StepFunctions', 'startExecution', {
  stateMachineArn: sm.stateMachineArn,
});

// describe the results of the execution
const describe = testCase.assertions.awsApiCall('StepFunctions', 'describeExecution', {
  executionArn: start.getAttString('executionArn'),
});

// assert the results
describe.expect(integ.ExpectedResult.objectLike({
  status: 'SUCCEEDED',
}));
```

If we want to pick out certain values from the api call response, we can use the `assertAtPath()` method, as in the [integ.pipeline-with-additional-inputs.ts](https://github.com/aws/aws-cdk/blob/main/packages/%40aws-cdk-testing/framework-integ/test/pipelines/test/integ.pipeline-with-additional-inputs.ts) integ test. Note that using the `outputPaths` optional parameter on the `awsApiCall()` function often interacts poorly with the `expect()` function. 

```ts
import * as integ from '@aws-cdk/integ-tests-alpha';

declare const app: App;
declare const stack: Stack;
declare const pipelineName: string;
declare const expectedString: string;

const testCase = new integ.IntegTest(app, 'PipelineAdditionalInputsTest', {
  testCases: [stack],
});

const source = testCase.assertions.awsApiCall('CodePipeline', 'GetPipeline', {
  name: pipelineName,
});

// assert the value at the given path matches the expected string
// the numbers index arrays in the json response object
source.assertAtPath('pipeline.stages.0.actions.0.name', integ.ExpectedResult.stringLikeRegexp(expectedString));
```
A helpful trick is to deploy the integ test with `--no-clean` and then make the api call locally. We can then trace the path to specific values easily. For example, `> aws codepipeline get-pipeline --name MyFirstPipeline`.

Adding assertions is preferred on all new integ tests; however, it is not strictly required. We typically do not need to assert CloudFormation behavior. For example, if we create an S3 Bucket
with Encryption, we do not need to assert that Encryption is set on the bucket. We can trust that the CloudFormation behavior works.
Some things you should look for in deciding if the test needs an assertion:

- Integrations between services (i.e. integration libraries like `aws-cdk-lib/aws-lambda-destinations`, `aws-cdk-lib/aws-stepfunctions-tasks`, etc).
- All custom resources. Must assert the expected behavior of the lambda is correct.
- Anything that bundles or deploys custom code (i.e. does a Lambda function bundled with `aws-cdk-lib/aws-lambda-nodejs` still invoke or did we break bundling behavior).
- IAM/Networking connections.
  - This one is a bit of a judgement call. Most things do not need assertions, but sometimes we handle complicated configurations involving IAM permissions or
    Networking access.


## Running Integration Tests

Most of the time you will only need to run integration tests for an individual module (i.e. `aws-lambda`). Other times you may need to run tests across multiple modules.
In this case I would recommend running from the root directory like below.

_Run snapshot tests only_
```bash
yarn integ-runner --directory packages/@aws-cdk
```

_Run snapshot tests and then re-run integration tests for failed snapshots_
```bash
yarn integ-runner --directory packages/@aws-cdk --update-on-failed
```

One benefit of running from the root directory like this is that it will only collect tests from "built" modules. If you have built the entire
repo it will run all integration tests, but if you have only built a couple modules it will only run tests from those.

### Running large numbers of Tests

If you need to re-run a large number of tests you can run them in parallel like this.

```bash
yarn integ-runner --directory packages/@aws-cdk --update-on-failed \
  --parallel-regions us-east-1 \
  --parallel-regions us-east-2 \
  --parallel-regions us-west-2 \
  --parallel-regions eu-west-1 \
  --profiles profile1 \
  --profiles profile2 \
  --profiles profile3 \
  --verbose
```

When using both `--parallel-regions` and `--profiles` it will execute (regions*profiles) tests in parallel (in this example 12)
If you want to execute more than 16 tests in parallel you can pass a higher value to `--max-workers`.

## Permissions Snapshot Testing

Permissions snapshot testing is a feature that automatically tracks and records all AWS API calls and IAM role assumptions made during integration test execution. This provides visibility into the permissions required by CDK constructs and helps detect unintended changes in permission requirements.

### Purpose and Benefits

- **Regression detection**: Automatically detect when code changes result in new or removed AWS API calls
- **Security review**: Provides clear visibility into what permissions your constructs actually require
- **Documentation**: Creates a permanent record of permissions used by each integration test
- **Least privilege verification**: Helps ensure constructs request only the permissions they need

### How It Works

When you run an integration test, the permissions tracker:

1. **Intercepts SDK calls**: Uses AWS SDK v3 middleware to capture every API call
2. **Tracks role assumptions**: Records STS AssumeRole calls to maintain a role chain
3. **Generates snapshot**: Creates a `permissions.snapshot.json` file in the test's snapshot directory
4. **Compares on subsequent runs**: Fails the test if permissions differ from the stored snapshot

### Snapshot File Format

The `permissions.snapshot.json` file is a JSON document with the following structure:

```json
{
  "version": "1.0",
  "testName": "my-integration-test",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "rolesAssumed": [
    {
      "roleArn": "arn:aws:iam::123456789012:role/TestRole",
      "sessionName": "test-session",
      "durationSeconds": 3600,
      "assumedBy": "arn:aws:iam::123456789012:user/TestUser"
    }
  ],
  "actionsPerformed": [
    {
      "service": "s3",
      "action": "GetObject",
      "region": "us-east-1"
    },
    {
      "service": "cloudformation",
      "action": "CreateStack",
      "region": "us-east-1"
    }
  ]
}
```

**Field Descriptions:**

| Field | Description |
|-------|-------------|
| `version` | Schema version for the snapshot format (currently "1.0") |
| `testName` | Name of the integration test that generated this snapshot |
| `timestamp` | ISO 8601 timestamp when the snapshot was generated |
| `rolesAssumed` | Array of IAM roles that were assumed during test execution |
| `rolesAssumed[].roleArn` | The ARN of the assumed role |
| `rolesAssumed[].sessionName` | The session name used when assuming the role |
| `rolesAssumed[].durationSeconds` | Session duration in seconds (if specified) |
| `rolesAssumed[].assumedBy` | The principal (user/role) that assumed this role |
| `actionsPerformed` | Array of unique AWS API actions performed during the test |
| `actionsPerformed[].service` | AWS service name (e.g., 's3', 'cloudformation', 'lambda') |
| `actionsPerformed[].action` | API action name (e.g., 'GetObject', 'CreateStack') |
| `actionsPerformed[].region` | AWS region where the action was performed |

### Complete Annotated Example

Here is a complete example of a typical permissions snapshot with annotations explaining each part:

```json
{
  // Schema version - used for forward compatibility
  "version": "1.0",
  
  // Test identifier - matches the integration test file name
  "testName": "integ.lambda-with-s3",
  
  // When this snapshot was captured
  "timestamp": "2024-01-15T10:30:00.000Z",
  
  // Roles assumed during test execution (in order)
  "rolesAssumed": [
    {
      // The deployment role assumed by CDK
      "roleArn": "arn:aws:iam::123456789012:role/cdk-hnb659fds-deploy-role-123456789012-us-east-1",
      "sessionName": "aws-cdk-integ-test",
      "durationSeconds": 3600,
      // The original caller identity
      "assumedBy": "arn:aws:iam::123456789012:user/developer"
    },
    {
      // The CloudFormation execution role
      "roleArn": "arn:aws:iam::123456789012:role/cdk-hnb659fds-cfn-exec-role-123456789012-us-east-1",
      "sessionName": "AWSCloudFormation",
      // This role was assumed by the deploy role
      "assumedBy": "arn:aws:iam::123456789012:role/cdk-hnb659fds-deploy-role-123456789012-us-east-1"
    }
  ],
  
  // All unique AWS API actions performed (sorted alphabetically)
  "actionsPerformed": [
    {
      // CloudFormation operations for stack management
      "service": "cloudformation",
      "action": "CreateStack",
      "region": "us-east-1"
    },
    {
      "service": "cloudformation",
      "action": "DescribeStacks",
      "region": "us-east-1"
    },
    {
      "service": "cloudformation",
      "action": "DescribeStackEvents",
      "region": "us-east-1"
    },
    {
      // Lambda function creation
      "service": "lambda",
      "action": "CreateFunction",
      "region": "us-east-1"
    },
    {
      // S3 operations for asset uploads
      "service": "s3",
      "action": "GetBucketLocation",
      "region": "us-east-1"
    },
    {
      "service": "s3",
      "action": "PutObject",
      "region": "us-east-1"
    },
    {
      // STS calls for role assumption
      "service": "sts",
      "action": "AssumeRole",
      "region": "us-east-1"
    }
  ]
}
```

### CLI Flags for Permissions Snapshots

The integration test runner supports the following flags for managing permissions snapshots:

#### `--update-permissions-snapshot`

Updates the permissions snapshot file when differences are detected. Use this flag when:
- You've intentionally added or removed API calls in your construct
- You're creating a new integration test for the first time
- You've reviewed the diff and confirmed the changes are expected

```bash
yarn integ test/aws-lambda/test/integ.lambda.js --update-permissions-snapshot
```

#### `--skip-permissions-check`

Bypasses permissions snapshot validation entirely. Use this flag when:
- You're debugging a test and don't want snapshot failures to block you
- Running tests in an environment where permissions tracking isn't needed
- The permissions snapshot feature is causing issues you need to investigate

```bash
yarn integ test/aws-lambda/test/integ.lambda.js --skip-permissions-check
```

### Interpreting Permissions Diffs

When a permissions snapshot mismatch occurs, the test failure output shows a detailed diff. Here's how to interpret it:

**Example diff output:**
```
✗ Permissions snapshot mismatch

New roles assumed (1):
  + arn:aws:iam::123456789012:role/NewRole
      session: new-session

New actions performed (2):
  + dynamodb:PutItem (us-east-1)
  + dynamodb:GetItem (us-east-1)

Removed actions (1):
  - s3:ListBucket (us-east-1)

Total changes: 4
```

**Interpreting changes:**

| Change Type | What It Means | Common Causes |
|-------------|---------------|---------------|
| **New roles assumed** | A new IAM role is being assumed that wasn't before | Added cross-account access, new service integration |
| **Removed roles** | A role that was assumed is no longer used | Simplified architecture, removed dependency |
| **New actions** | New AWS API calls are being made | Added functionality, new resource types |
| **Removed actions** | API calls that were made are no longer occurring | Removed functionality, optimized code |

### Determining if Changes are Expected

Follow these steps to evaluate permissions changes:

1. **Review your code changes**: What functionality did you add, modify, or remove?
2. **Map changes to permissions**: New resources typically require new actions (e.g., adding DynamoDB table → `dynamodb:*` actions)
3. **Check for unintended changes**: Look for unexpected permissions that might indicate bugs
4. **Verify security implications**: Ensure new permissions align with least privilege principles

**Expected changes:**
- Adding a new S3 bucket → expect `s3:CreateBucket`, `s3:PutBucketPolicy`, etc.
- Adding Lambda event source → expect new IAM role for event source mapping
- Removing a resource → expect removal of related actions

**Unexpected changes to investigate:**
- Permissions for services you didn't add code for
- Role assumptions to accounts you don't recognize
- Actions that seem unrelated to your changes

### Updating Permissions Snapshots

When you've confirmed that permissions changes are intentional:

1. **Review the diff carefully**:
   ```bash
   yarn integ test/aws-lambda/test/integ.lambda.js
   # Review the permissions diff in the output
   ```

2. **Update the snapshot**:
   ```bash
   yarn integ test/aws-lambda/test/integ.lambda.js --update-permissions-snapshot
   ```

3. **Commit the updated snapshot**:
   ```bash
   git add test/aws-lambda/test/integ.lambda.js.snapshot/permissions.snapshot.json
   git commit -m "chore: update permissions snapshot for new dynamodb integration"
   ```

4. **Document in your PR**: Explain why permissions changed in your PR description

### Troubleshooting Common Issues

#### Test fails with "permissions snapshot mismatch" but I didn't change permissions

**Possible causes:**
- Non-deterministic resource naming affecting action patterns
- Environment differences (different AWS account, region)
- Transient API calls that don't always occur

**Solutions:**
- Ensure deterministic resource naming in your test
- Review if the diff shows legitimate environment differences
- If calls are non-deterministic, consider excluding them from tracking

#### Snapshot shows unexpected role assumptions

**Possible causes:**
- CDK bootstrap roles being captured
- Cross-account access you weren't aware of
- Service-linked role assumptions

**Solutions:**
- Review the role chain to understand who assumed what
- Verify the roles are expected for your construct's functionality
- Check if the roles are CDK deployment infrastructure vs. your construct

#### Empty permissions snapshot

**Possible causes:**
- Middleware not properly attached to SDK clients
- Test not making any AWS API calls
- Permissions collector not initialized

**Solutions:**
- Ensure `createPermissionsMiddleware()` is attached to all SDK clients used
- Verify your test actually deploys resources
- Check that `PermissionsCollector.getInstance()` is called before test execution

#### Permissions snapshot shows API calls I didn't expect

**Possible causes:**
- SDK retry calls being captured
- Polling operations for resource creation
- Implicit API calls from higher-level constructs

**Solutions:**
- Review the construct's implementation for implicit dependencies
- Check if calls are expected CloudFormation polling behavior
- Verify you understand all resources created by your construct
