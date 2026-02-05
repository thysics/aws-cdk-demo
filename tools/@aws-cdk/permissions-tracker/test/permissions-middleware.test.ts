import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListBucketsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, DeleteStackCommand } from '@aws-sdk/client-cloudformation';
import { createPermissionsMiddleware, PermissionsCollector } from '../lib';

describe('PermissionsMiddleware', () => {
  const s3Mock = mockClient(S3Client);
  const stsMock = mockClient(STSClient);
  const cfnMock = mockClient(CloudFormationClient);

  beforeEach(() => {
    // Reset all mocks and collector
    s3Mock.reset();
    stsMock.reset();
    cfnMock.reset();
    PermissionsCollector.resetInstance();
  });

  describe('S3 API calls', () => {
    test('captures ListBuckets call', async () => {
      s3Mock.on(ListBucketsCommand).resolves({ Buckets: [] });

      const s3Client = new S3Client({ region: 'us-east-1' });
      s3Client.middlewareStack.use(createPermissionsMiddleware());

      await s3Client.send(new ListBucketsCommand({}));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('s3');
      expect(calls[0].action).toBe('ListBuckets');
    });

    test('captures multiple S3 calls', async () => {
      s3Mock.on(ListBucketsCommand).resolves({ Buckets: [] });
      s3Mock.on(GetObjectCommand).resolves({ Body: undefined });
      s3Mock.on(PutObjectCommand).resolves({});

      const s3Client = new S3Client({ region: 'us-east-1' });
      s3Client.middlewareStack.use(createPermissionsMiddleware());

      await s3Client.send(new ListBucketsCommand({}));
      await s3Client.send(new GetObjectCommand({ Bucket: 'test', Key: 'key' }));
      await s3Client.send(new PutObjectCommand({ Bucket: 'test', Key: 'key', Body: 'data' }));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(3);
      expect(calls.map(c => c.action)).toEqual(['ListBuckets', 'GetObject', 'PutObject']);
    });
  });

  describe('STS API calls', () => {
    test('captures GetCallerIdentity call', async () => {
      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:iam::123456789012:user/test',
        UserId: 'AIDAEXAMPLE',
      });

      const stsClient = new STSClient({ region: 'us-east-1' });
      stsClient.middlewareStack.use(createPermissionsMiddleware());

      await stsClient.send(new GetCallerIdentityCommand({}));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('sts');
      expect(calls[0].action).toBe('GetCallerIdentity');
    });

    test('captures AssumeRole and tracks role chain', async () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::111111111111:user/original' });

      stsMock.on(AssumeRoleCommand).resolves({
        Credentials: {
          AccessKeyId: 'AKIAEXAMPLE',
          SecretAccessKey: 'secret',
          SessionToken: 'token',
          Expiration: new Date(),
        },
        AssumedRoleUser: {
          AssumedRoleId: 'AROAEXAMPLE:test-session',
          Arn: 'arn:aws:sts::123456789012:assumed-role/test-role/test-session',
        },
      });

      const stsClient = new STSClient({ region: 'us-east-1' });
      stsClient.middlewareStack.use(createPermissionsMiddleware());

      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::123456789012:role/test-role',
        RoleSessionName: 'test-session',
        DurationSeconds: 3600,
      }));

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('sts');
      expect(calls[0].action).toBe('AssumeRole');

      const assumedRoles = collector.getAssumedRoles();
      expect(assumedRoles).toHaveLength(1);
      expect(assumedRoles[0].roleArn).toBe('arn:aws:iam::123456789012:role/test-role');
      expect(assumedRoles[0].sessionName).toBe('test-session');
      expect(assumedRoles[0].durationSeconds).toBe(3600);
      expect(assumedRoles[0].assumedBy).toBe('arn:aws:iam::111111111111:user/original');

      // Verify role chain is updated
      const roleChain = collector.getRoleChain();
      expect(roleChain.initialPrincipal).toBe('arn:aws:iam::111111111111:user/original');
      expect(roleChain.roles).toHaveLength(1);
    });

    test('tracks multiple AssumeRole calls in chain', async () => {
      const collector = PermissionsCollector.getInstance();
      collector.configure({ initialPrincipal: 'arn:aws:iam::111111111111:user/original' });

      stsMock.on(AssumeRoleCommand).resolves({
        Credentials: {
          AccessKeyId: 'AKIAEXAMPLE',
          SecretAccessKey: 'secret',
          SessionToken: 'token',
          Expiration: new Date(),
        },
      });

      const stsClient = new STSClient({ region: 'us-east-1' });
      stsClient.middlewareStack.use(createPermissionsMiddleware());

      // First assume role
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::222222222222:role/role-a',
        RoleSessionName: 'session-a',
      }));

      // Second assume role
      await stsClient.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::333333333333:role/role-b',
        RoleSessionName: 'session-b',
      }));

      const roleChain = collector.getRoleChain();
      expect(roleChain.roles).toHaveLength(2);
      expect(roleChain.roles[0].roleArn).toBe('arn:aws:iam::222222222222:role/role-a');
      expect(roleChain.roles[0].assumedBy).toBe('arn:aws:iam::111111111111:user/original');
      expect(roleChain.roles[1].roleArn).toBe('arn:aws:iam::333333333333:role/role-b');
      expect(roleChain.roles[1].assumedBy).toBe('arn:aws:iam::222222222222:role/role-a');
    });
  });

  describe('CloudFormation API calls', () => {
    test('captures CreateStack call', async () => {
      cfnMock.on(CreateStackCommand).resolves({ StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid' });

      const cfnClient = new CloudFormationClient({ region: 'us-east-1' });
      cfnClient.middlewareStack.use(createPermissionsMiddleware());

      await cfnClient.send(new CreateStackCommand({
        StackName: 'test-stack',
        TemplateBody: '{}',
      }));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('cloudformation');
      expect(calls[0].action).toBe('CreateStack');
    });

    test('captures multiple CloudFormation calls', async () => {
      cfnMock.on(CreateStackCommand).resolves({ StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid' });
      cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [] });
      cfnMock.on(DeleteStackCommand).resolves({});

      const cfnClient = new CloudFormationClient({ region: 'us-east-1' });
      cfnClient.middlewareStack.use(createPermissionsMiddleware());

      await cfnClient.send(new CreateStackCommand({ StackName: 'test', TemplateBody: '{}' }));
      await cfnClient.send(new DescribeStacksCommand({ StackName: 'test' }));
      await cfnClient.send(new DeleteStackCommand({ StackName: 'test' }));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(3);
      expect(calls.map(c => c.action)).toEqual(['CreateStack', 'DescribeStacks', 'DeleteStack']);
    });
  });

  describe('multiple services together', () => {
    test('captures calls across S3, STS, and CloudFormation', async () => {
      s3Mock.on(ListBucketsCommand).resolves({ Buckets: [] });
      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:iam::123456789012:user/test',
        UserId: 'AIDAEXAMPLE',
      });
      cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [] });

      // Create middleware once and use collector singleton
      const middleware = createPermissionsMiddleware();

      const s3Client = new S3Client({ region: 'us-east-1' });
      s3Client.middlewareStack.use(middleware);

      const stsClient = new STSClient({ region: 'us-east-1' });
      stsClient.middlewareStack.use(createPermissionsMiddleware());

      const cfnClient = new CloudFormationClient({ region: 'us-east-1' });
      cfnClient.middlewareStack.use(createPermissionsMiddleware());

      // Make calls to all three services
      await s3Client.send(new ListBucketsCommand({}));
      await stsClient.send(new GetCallerIdentityCommand({}));
      await cfnClient.send(new DescribeStacksCommand({}));

      const collector = PermissionsCollector.getInstance();
      const calls = collector.getApiCalls();

      expect(calls).toHaveLength(3);
      const services = calls.map(c => c.service);
      expect(services).toContain('s3');
      expect(services).toContain('sts');
      expect(services).toContain('cloudformation');

      // Verify unique permissions
      const permissions = collector.getUniquePermissions();
      expect(permissions).toEqual([
        'cloudformation:DescribeStacks',
        's3:ListBuckets',
        'sts:GetCallerIdentity',
      ]);
    });
  });

  describe('middleware does not affect request/response', () => {
    test('S3 response is unchanged', async () => {
      const expectedBuckets = [
        { Name: 'bucket-1', CreationDate: new Date() },
        { Name: 'bucket-2', CreationDate: new Date() },
      ];
      s3Mock.on(ListBucketsCommand).resolves({ Buckets: expectedBuckets });

      const s3Client = new S3Client({ region: 'us-east-1' });
      s3Client.middlewareStack.use(createPermissionsMiddleware());

      const response = await s3Client.send(new ListBucketsCommand({}));

      expect(response.Buckets).toHaveLength(2);
      expect(response.Buckets?.[0].Name).toBe('bucket-1');
      expect(response.Buckets?.[1].Name).toBe('bucket-2');
    });

    test('STS response is unchanged', async () => {
      const expectedResponse = {
        Account: '123456789012',
        Arn: 'arn:aws:iam::123456789012:user/test',
        UserId: 'AIDAEXAMPLE',
      };
      stsMock.on(GetCallerIdentityCommand).resolves(expectedResponse);

      const stsClient = new STSClient({ region: 'us-east-1' });
      stsClient.middlewareStack.use(createPermissionsMiddleware());

      const response = await stsClient.send(new GetCallerIdentityCommand({}));

      expect(response.Account).toBe('123456789012');
      expect(response.Arn).toBe('arn:aws:iam::123456789012:user/test');
      expect(response.UserId).toBe('AIDAEXAMPLE');
    });

    test('CloudFormation response is unchanged', async () => {
      const expectedStacks = [
        {
          StackName: 'test-stack',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ];
      cfnMock.on(DescribeStacksCommand).resolves({ Stacks: expectedStacks });

      const cfnClient = new CloudFormationClient({ region: 'us-east-1' });
      cfnClient.middlewareStack.use(createPermissionsMiddleware());

      const response = await cfnClient.send(new DescribeStacksCommand({ StackName: 'test-stack' }));

      expect(response.Stacks).toHaveLength(1);
      expect(response.Stacks?.[0].StackName).toBe('test-stack');
      expect(response.Stacks?.[0].StackStatus).toBe('CREATE_COMPLETE');
    });

    test('errors are propagated unchanged', async () => {
      const error = new Error('Access Denied');
      s3Mock.on(ListBucketsCommand).rejects(error);

      const s3Client = new S3Client({ region: 'us-east-1' });
      s3Client.middlewareStack.use(createPermissionsMiddleware());

      await expect(s3Client.send(new ListBucketsCommand({}))).rejects.toThrow('Access Denied');
    });
  });

  describe('filtering with middleware', () => {
    test('respects excludeServices configuration', async () => {
      s3Mock.on(ListBucketsCommand).resolves({ Buckets: [] });
      stsMock.on(GetCallerIdentityCommand).resolves({
        Account: '123456789012',
        Arn: 'arn:aws:iam::123456789012:user/test',
        UserId: 'AIDAEXAMPLE',
      });

      const collector = PermissionsCollector.getInstance();
      collector.configure({ excludeServices: ['sts'] });

      const s3Client = new S3Client({ region: 'us-east-1' });
      s3Client.middlewareStack.use(createPermissionsMiddleware());

      const stsClient = new STSClient({ region: 'us-east-1' });
      stsClient.middlewareStack.use(createPermissionsMiddleware());

      await s3Client.send(new ListBucketsCommand({}));
      await stsClient.send(new GetCallerIdentityCommand({}));

      const calls = collector.getApiCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].service).toBe('s3');
    });
  });
});
