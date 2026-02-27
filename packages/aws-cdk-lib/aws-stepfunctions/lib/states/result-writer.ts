import * as iam from '../../../aws-iam';
import type { IBucket } from '../../../aws-s3';
import { Arn, ArnFormat, Aws } from '../../../core';

/**
 * Properties for configuring a MapResultWriter
 */
export interface MapResultWriterProps {
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
 * Configuration returned by `MapResultWriter.bind()`
 */
export interface MapResultWriterConfig {
  /**
   * The Amazon States Language resource ARN for S3 putObject
   */
  readonly resource: string;

  /**
   * Parameters for the ResultWriter
   */
  readonly parameters: { [key: string]: string };
}

/**
 * Configures a Step Functions Map state to write results to an S3 bucket.
 *
 * Use this class to define a ResultWriter configuration object that can be
 * used with a Map state to persist execution results in Amazon S3.
 *
 * The `bind()` method returns the CloudFormation `ResultWriter` configuration
 * object containing the S3 resource ARN and parameters.
 */
export class MapResultWriter {
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

  constructor(props: MapResultWriterProps) {
    this.bucket = props.bucket;
    this.prefix = props.prefix;
  }

  /**
   * Returns the CloudFormation ResultWriter configuration object.
   */
  public bind(): MapResultWriterConfig {
    const parameters: { [key: string]: string } = {
      Bucket: this.bucket.bucketName,
    };

    if (this.prefix) {
      parameters.Prefix = this.prefix;
    }

    return {
      resource: Arn.format({
        region: '',
        account: '',
        partition: Aws.PARTITION,
        service: 'states',
        resource: 's3',
        resourceName: 'putObject',
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
      parameters,
    };
  }

  /**
   * Compile policy statements to provide relevant permissions to the state machine
   */
  public providePolicyStatements(): iam.PolicyStatement[] {
    const bucketName = this.bucket.bucketName;
    if (!bucketName) {
      return [];
    }

    return [
      new iam.PolicyStatement({
        actions: [
          's3:PutObject',
          's3:GetObject',
          's3:ListMultipartUploadParts',
          's3:AbortMultipartUpload',
        ],
        resources: [
          Arn.format({
            region: '',
            account: '',
            partition: Aws.PARTITION,
            service: 's3',
            resource: bucketName,
            resourceName: '*',
          }),
        ],
      }),
    ];
  }
}
