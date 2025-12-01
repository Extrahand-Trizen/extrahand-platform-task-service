/**
 * AWS S3 Storage Provider
 * 
 * Implements storage interface using AWS S3
 * Can be used as an alternative to MinIO
 */

import * as AWS from 'aws-sdk';
import logger from '../../config/logger';
import { BaseStorage } from './StorageInterface';

export class S3Storage extends BaseStorage {
  private s3: AWS.S3;
  private region: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;
  private cloudFrontDomain?: string;

  constructor(config: any = {}) {
    super();
    
    // AWS S3 configuration
    this.region = config.region || process.env.AWS_REGION || 'us-east-1';
    this.accessKeyId = config.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '';
    this.secretAccessKey = config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '';
    this.bucketName = config.bucketName || process.env.AWS_S3_BUCKET_NAME || 'extrahand-images';
    this.cloudFrontDomain = config.cloudFrontDomain || process.env.AWS_CLOUDFRONT_DOMAIN;

    // Validate required configuration
    if (!this.accessKeyId || !this.secretAccessKey) {
      logger.warn('⚠️ AWS S3 credentials not configured. Storage operations will fail.');
    }

    // Initialize S3 client
    this.s3 = new AWS.S3({
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
    });

    logger.info('✅ AWS S3 Storage initialized', {
      region: this.region,
      bucket: this.bucketName,
      cloudFrontDomain: this.cloudFrontDomain || 'using S3 URL',
    });
  }

  /**
   * Upload file to AWS S3
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    folder: string = 'uploads',
    metadata: any = {}
  ): Promise<{ url: string; key: string; bucket?: string }> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('AWS S3 credentials not configured');
      }

      // Sanitize file name
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const timestamp = Date.now();
      const key = `${folder}/${timestamp}_${sanitizedFileName}`;

      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        Metadata: {
          uploadedAt: new Date().toISOString(),
          originalFileName: fileName,
          ...metadata,
        },
      };

      await this.s3.upload(params).promise();

      // Construct public URL (use CloudFront if configured, otherwise S3 URL)
      const url = this.getFileUrl(key);

      logger.info('File uploaded to AWS S3', {
        key,
        bucket: this.bucketName,
        url,
        size: fileBuffer.length,
      });

      return {
        url,
        key,
        bucket: this.bucketName,
      };
    } catch (error: any) {
      logger.error('Error uploading file to AWS S3:', {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to upload file to AWS S3: ${error.message}`);
    }
  }

  /**
   * Delete file from AWS S3
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('AWS S3 credentials not configured');
      }

      const params: AWS.S3.DeleteObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
      };

      await this.s3.deleteObject(params).promise();

      logger.info('File deleted from AWS S3', { key, bucket: this.bucketName });
      return true;
    } catch (error: any) {
      logger.error('Error deleting file from AWS S3:', {
        error: error.message,
        key,
      });
      throw new Error(`Failed to delete file from AWS S3: ${error.message}`);
    }
  }

  /**
   * Get public URL for a file
   */
  getFileUrl(key: string): string {
    if (this.cloudFrontDomain) {
      // Use CloudFront domain if configured
      return `https://${this.cloudFrontDomain}/${key}`;
    }
    
    // Fallback to S3 URL
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Generate presigned URL for direct upload
   */
  async getPresignedUploadUrl(key: string, contentType: string, expiresIn: number = 3600): Promise<string> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('AWS S3 credentials not configured');
      }

      const params = {
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
        Expires: expiresIn,
      };

      const url = await this.s3.getSignedUrlPromise('putObject', params);
      return url;
    } catch (error: any) {
      logger.error('Error generating presigned URL:', {
        error: error.message,
        key,
      });
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  /**
   * Health check - verify AWS S3 is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        return false;
      }

      // Try to head the bucket (lightweight operation)
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      return true;
    } catch (error: any) {
      logger.warn('AWS S3 health check failed:', error.message);
      return false;
    }
  }
}

