import { IBucket } from '../../../aws-s3';
import { Arn, ArnFormat, Aws } from '../../../core';

/**
 * Interface for ResultWriter configuration props
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
 * Configuration for writing Map state results to S3
 */
export class ResultWriter {
  /**
   * S3 Bucket in which to save Map Run results
   */
  public readonly bucket: IBucket;

  /**
   * S3 prefix in which to save Map Run results
   *
   * @default - No prefix
   */
  public readonly prefix?: string;

  constructor(props: ResultWriterProps) {
    this.bucket = props.bucket;
    this.prefix = props.prefix;
  }

  /**
   * Returns the CloudFormation ResultWriter configuration object.
   */
  public bind(): object {
    return {
      Resource: Arn.format({
        region: '',
        account: '',
        partition: Aws.PARTITION,
        service: 'states',
        resource: 's3',
        resourceName: 'putObject',
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
      Parameters: {
        Bucket: this.bucket.bucketName,
        ...(this.prefix && { Prefix: this.prefix }),
      },
    };
  }
}
