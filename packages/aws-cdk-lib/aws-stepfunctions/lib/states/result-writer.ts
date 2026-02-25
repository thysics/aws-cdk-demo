import type { IBucket } from '../../../aws-s3';
import { Arn, ArnFormat, Aws } from '../../../core';
import { FieldUtils } from '../fields';

/**
 * Interface for Result Writer configuration props
 */
export interface ResultWriterProps {
  /**
   * S3 Bucket in which to save Map Run results
   */
  readonly bucket: IBucket;

  /**
   * S3 prefix in which to save Map Run results
   *
   * @default - No prefix
   */
  readonly prefix?: string;
}

/**
 * Interface for the return type of `ResultWriter.bind()`
 */
export interface ResultWriterConfig {
  /**
   * The resource ARN for the result writer
   */
  readonly Resource: any;

  /**
   * The parameters for the result writer
   */
  readonly Parameters: { [key: string]: any };
}

/**
 * Value for s3:putObject used as Resource for ResultWriter in the ASL
 * "arn:aws:states:::s3:putObject"
 */
const statesS3PutObjectResource = Arn.format({
  region: '',
  account: '',
  partition: Aws.PARTITION,
  service: 'states',
  resource: 's3',
  resourceName: 'putObject',
  arnFormat: ArnFormat.COLON_RESOURCE_NAME,
});

/**
 * Configuration for writing Map state results to S3
 */
export class ResultWriter {
  /**
   * S3 Bucket in which to save Map Run results
   */
  readonly bucket: IBucket;

  /**
   * S3 prefix in which to save Map Run results
   *
   * @default - No prefix
   */
  readonly prefix?: string;

  constructor(props: ResultWriterProps) {
    this.bucket = props.bucket;
    this.prefix = props.prefix;
  }

  /**
   * Return the result writer configuration as a CloudFormation object
   */
  public bind(): ResultWriterConfig {
    return FieldUtils.renderObject({
      Resource: statesS3PutObjectResource,
      Parameters: {
        Bucket: this.bucket.bucketName,
        ...(this.prefix && { Prefix: this.prefix }),
      },
    }) as ResultWriterConfig;
  }
}
