import * as s3 from '../../aws-s3';
import * as cdk from '../../core';
// Import directly from the file to avoid ambiguity with the deprecated ResultWriter in distributed-map
import { ResultWriter } from '../lib/states/result-writer';

describe('ResultWriter', () => {
  test('ResultWriter with bucket and prefix', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const writer = new ResultWriter({ bucket, prefix: 'results' });
    const config = stack.resolve(writer.bind());

    // THEN
    expect(config).toStrictEqual({
      Resource: {
        'Fn::Join': [
          '',
          [
            'arn:',
            { Ref: 'AWS::Partition' },
            ':states:::s3:putObject',
          ],
        ],
      },
      Parameters: {
        Bucket: {
          Ref: 'ResultBucket6B0764B4',
        },
        Prefix: 'results',
      },
    });
  });

  test('ResultWriter with bucket only (no prefix)', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const writer = new ResultWriter({ bucket });
    const config = stack.resolve(writer.bind());

    // THEN
    expect(config).toStrictEqual({
      Resource: {
        'Fn::Join': [
          '',
          [
            'arn:',
            { Ref: 'AWS::Partition' },
            ':states:::s3:putObject',
          ],
        ],
      },
      Parameters: {
        Bucket: {
          Ref: 'ResultBucket6B0764B4',
        },
      },
    });
  });

  test('ResultWriter exposes bucket and prefix properties', () => {
    // GIVEN
    const stack = new cdk.Stack();
    const bucket = new s3.Bucket(stack, 'ResultBucket');

    // WHEN
    const writerWithPrefix = new ResultWriter({ bucket, prefix: 'my-prefix' });
    const writerWithoutPrefix = new ResultWriter({ bucket });

    // THEN
    expect(writerWithPrefix.bucket).toBe(bucket);
    expect(writerWithPrefix.prefix).toBe('my-prefix');
    expect(writerWithoutPrefix.bucket).toBe(bucket);
    expect(writerWithoutPrefix.prefix).toBeUndefined();
  });
});
