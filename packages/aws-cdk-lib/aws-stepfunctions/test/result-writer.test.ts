import * as s3 from '../../aws-s3';
import * as cdk from '../../core';
import { ResultWriter } from '../lib/states/result-writer';

describe('ResultWriter', () => {
  test('bind() returns configuration with bucket only', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const resultWriter = new ResultWriter({
      bucket: bucket,
    });
    const config = resultWriter.bind();

    // THEN
    expect(config).toEqual(expect.objectContaining({
      Resource: expect.objectContaining({}),
      Parameters: expect.objectContaining({
        Bucket: expect.anything(),
      }),
    }));
    expect((config as any).Parameters.Prefix).toBeUndefined();
  });

  test('bind() returns configuration with bucket and prefix', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const resultWriter = new ResultWriter({
      bucket: bucket,
      prefix: 'my-prefix',
    });
    const config = resultWriter.bind();

    // THEN
    expect((config as any).Parameters.Prefix).toEqual('my-prefix');
    expect((config as any).Parameters.Bucket).toBeDefined();
    expect((config as any).Resource).toBeDefined();
  });

  test('bind() omits Prefix when not provided', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const resultWriter = new ResultWriter({ bucket });
    const config = resultWriter.bind();

    // THEN
    expect((config as any).Parameters).not.toHaveProperty('Prefix');
    expect((config as any).Parameters.Bucket).toBeDefined();
  });

  test('bucket and prefix are accessible as properties', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const resultWriter = new ResultWriter({
      bucket: bucket,
      prefix: 'test-prefix',
    });

    // THEN
    expect(resultWriter.bucket).toBe(bucket);
    expect(resultWriter.prefix).toBe('test-prefix');
  });
});
