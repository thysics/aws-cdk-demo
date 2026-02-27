import * as s3 from '../../aws-s3';
import * as cdk from '../../core';
import { MapResultWriter } from '../lib/states/result-writer';

describe('MapResultWriter', () => {
  let stack: cdk.Stack;
  let bucket: s3.Bucket;

  beforeEach(() => {
    stack = new cdk.Stack();
    bucket = new s3.Bucket(stack, 'ResultBucket');
  });

  test('bind() returns correct configuration with bucket only', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
    });

    // WHEN
    const config = resultWriter.bind();

    // THEN
    expect(config.resource).toContain('states');
    expect(config.resource).toContain('s3');
    expect(config.resource).toContain('putObject');
    expect(config.parameters.Bucket).toBeDefined();
    expect(config.parameters.Prefix).toBeUndefined();
  });

  test('bind() returns correct configuration with bucket and prefix', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
      prefix: 'my-results',
    });

    // WHEN
    const config = resultWriter.bind();

    // THEN
    expect(config.resource).toContain('states');
    expect(config.resource).toContain('s3');
    expect(config.resource).toContain('putObject');
    expect(config.parameters.Bucket).toBeDefined();
    expect(config.parameters.Prefix).toEqual('my-results');
  });

  test('bind() does not include Prefix when prefix is not provided', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
    });

    // WHEN
    const config = resultWriter.bind();

    // THEN
    expect(Object.keys(config.parameters)).toEqual(['Bucket']);
    expect(config.parameters).not.toHaveProperty('Prefix');
  });

  test('bind() includes Prefix when prefix is provided', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
      prefix: 'output/',
    });

    // WHEN
    const config = resultWriter.bind();

    // THEN
    expect(Object.keys(config.parameters)).toEqual(['Bucket', 'Prefix']);
    expect(config.parameters.Prefix).toEqual('output/');
  });

  test('exposes bucket and prefix properties', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
      prefix: 'test-prefix',
    });

    // THEN
    expect(resultWriter.bucket).toBe(bucket);
    expect(resultWriter.prefix).toEqual('test-prefix');
  });

  test('prefix is undefined when not provided', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
    });

    // THEN
    expect(resultWriter.prefix).toBeUndefined();
  });

  test('providePolicyStatements() returns S3 policy statements', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
    });

    // WHEN
    const statements = resultWriter.providePolicyStatements();

    // THEN
    expect(statements).toHaveLength(1);
    expect(statements[0].toStatementJson()).toEqual(expect.objectContaining({
      Action: [
        's3:PutObject',
        's3:GetObject',
        's3:ListMultipartUploadParts',
        's3:AbortMultipartUpload',
      ],
      Effect: 'Allow',
    }));
  });

  test('resource ARN follows states:s3:putObject format', () => {
    // GIVEN
    const resultWriter = new MapResultWriter({
      bucket,
    });

    // WHEN
    const config = resultWriter.bind();

    // THEN
    expect(config.resource).toMatch(/arn:.*:states:::s3:putObject/);
  });
});
