import { PermissionsRecorder } from '../../lib/permissions-snapshot/permissions-recorder';
import { createSdkInterceptorMiddleware } from '../../lib/permissions-snapshot/sdk-interceptor';

describe('SDK Interceptor', () => {
  let recorder: PermissionsRecorder;

  beforeEach(() => {
    recorder = new PermissionsRecorder();
  });

  describe('createSdkInterceptorMiddleware', () => {
    test('should record action when middleware is invoked', async () => {
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });
      const context = {
        clientName: 'S3Client',
        commandName: 'PutObjectCommand',
      };
      const args = {
        input: {
          Bucket: 'test-bucket',
          Key: 'test-key',
        },
      };

      const wrappedMiddleware = middleware(next, context);
      await wrappedMiddleware(args);

      const snapshot = recorder.stopRecording();

      expect(next).toHaveBeenCalledWith(args);
      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0]).toEqual({
        service: 's3',
        action: 'PutObject',
      });
    });

    test('should record role assumption for AssumeRole calls', async () => {
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });
      const context = {
        clientName: 'STSClient',
        commandName: 'AssumeRoleCommand',
      };
      const args = {
        input: {
          RoleArn: 'arn:aws:iam::123456789012:role/TestRole',
          RoleSessionName: 'test-session',
          ExternalId: 'external-id',
        },
      };

      const wrappedMiddleware = middleware(next, context);
      await wrappedMiddleware(args);

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0].service).toBe('sts');
      expect(snapshot.iamActions[0].action).toBe('AssumeRole');

      expect(snapshot.assumedRoles).toHaveLength(1);
      expect(snapshot.assumedRoles[0]).toEqual({
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
        sessionName: 'test-session',
        externalId: 'external-id',
      });
    });

    test('should handle different AssumeRole variants', async () => {
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });

      // Test AssumeRoleWithSAML
      const samlContext = {
        clientName: 'STSClient',
        commandName: 'AssumeRoleWithSAMLCommand',
      };
      const samlArgs = {
        input: {
          RoleArn: 'arn:aws:iam::123456789012:role/SAMLRole',
        },
      };

      const wrappedMiddleware = middleware(next, samlContext);
      await wrappedMiddleware(samlArgs);

      // Test AssumeRoleWithWebIdentity
      const webIdContext = {
        clientName: 'STSClient',
        commandName: 'AssumeRoleWithWebIdentityCommand',
      };
      const webIdArgs = {
        input: {
          RoleArn: 'arn:aws:iam::123456789012:role/WebIdRole',
        },
      };

      const wrappedMiddleware2 = middleware(next, webIdContext);
      await wrappedMiddleware2(webIdArgs);

      const snapshot = recorder.stopRecording();

      expect(snapshot.assumedRoles).toHaveLength(2);
      expect(snapshot.assumedRoles.map(r => r.roleArn)).toContain(
        'arn:aws:iam::123456789012:role/SAMLRole',
      );
      expect(snapshot.assumedRoles.map(r => r.roleArn)).toContain(
        'arn:aws:iam::123456789012:role/WebIdRole',
      );
    });

    test('should handle unknown client gracefully', async () => {
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });
      const context = {
        // Missing clientName
        commandName: 'SomeCommand',
      };
      const args = { input: {} };

      const wrappedMiddleware = middleware(next, context);
      await wrappedMiddleware(args);

      const snapshot = recorder.stopRecording();

      // Should still record with 'unknown' service
      expect(snapshot.iamActions).toHaveLength(1);
      expect(snapshot.iamActions[0].service).toBe('unknown');
      expect(snapshot.iamActions[0].action).toBe('Some');
    });

    test('should extract common ARN patterns from input', async () => {
      recorder = new PermissionsRecorder({ includeResourceArns: true });
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });
      const context = {
        clientName: 'LambdaClient',
        commandName: 'InvokeCommand',
      };
      const args = {
        input: {
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:MyFunction',
        },
      };

      const wrappedMiddleware = middleware(next, context);
      await wrappedMiddleware(args);

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions[0].resources).toContain(
        'arn:aws:lambda:us-east-1:123456789012:function:MyFunction',
      );
    });

    test('should pass through errors from SDK', async () => {
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const error = new Error('SDK Error');
      const next = jest.fn().mockRejectedValue(error);
      const context = {
        clientName: 'S3Client',
        commandName: 'GetObjectCommand',
      };
      const args = { input: {} };

      const wrappedMiddleware = middleware(next, context);

      await expect(wrappedMiddleware(args)).rejects.toThrow('SDK Error');

      // Action should still be recorded even on error
      const snapshot = recorder.stopRecording();
      expect(snapshot.iamActions).toHaveLength(1);
    });
  });

  describe('service name extraction', () => {
    test('should handle various client name formats', async () => {
      recorder.startRecording();

      const testCases = [
        { clientName: 'S3Client', expected: 's3' },
        { clientName: 'DynamoDBClient', expected: 'dynamodb' },
        { clientName: 'CloudFormationClient', expected: 'cloudformation' },
        { clientName: 'EC2Client', expected: 'ec2' },
        { clientName: 'IAMClient', expected: 'iam' },
      ];

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });

      for (const testCase of testCases) {
        const context = {
          clientName: testCase.clientName,
          commandName: 'DescribeCommand',
        };
        const wrappedMiddleware = middleware(next, context);
        await wrappedMiddleware({ input: {} });
      }

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions).toHaveLength(testCases.length);
      for (let i = 0; i < testCases.length; i++) {
        expect(snapshot.iamActions[i].service).toBe(testCases[i].expected);
      }
    });
  });

  describe('action name extraction', () => {
    test('should strip Command suffix from action names', async () => {
      recorder.startRecording();

      const middleware = createSdkInterceptorMiddleware({ recorder });
      const next = jest.fn().mockResolvedValue({ $metadata: {} });

      const commandNames = [
        'GetObjectCommand',
        'PutObjectCommand',
        'DescribeInstancesCommand',
        'CreateFunctionCommand',
      ];

      for (const commandName of commandNames) {
        const context = {
          clientName: 'TestClient',
          commandName,
        };
        const wrappedMiddleware = middleware(next, context);
        await wrappedMiddleware({ input: {} });
      }

      const snapshot = recorder.stopRecording();

      expect(snapshot.iamActions.map(a => a.action)).toEqual([
        'GetObject',
        'PutObject',
        'DescribeInstances',
        'CreateFunction',
      ]);
    });
  });
});
