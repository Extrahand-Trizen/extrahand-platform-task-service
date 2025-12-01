/**
 * MinIO Storage Provider for CapRover
 * 
 * Implements storage interface using MinIO (S3-compatible object storage)
 * Specifically configured for CapRover-deployed MinIO instances
 * 
 * NOTE: Uses AWS SDK because MinIO implements the S3 API (S3-compatible)
 */

import * as AWS from 'aws-sdk';
import logger from '../../config/logger';
import { BaseStorage } from './StorageInterface';

export class MinIOStorage extends BaseStorage {
  private s3: AWS.S3;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;
  private publicDomain?: string;
  private region: string;

  constructor(config: any = {}) {
    super();
    
    // CapRover MinIO configuration
    this.endpoint = config.endpoint || process.env.MINIO_ENDPOINT || 'http://srv-captain--extrahand-minio-storage:9000';
    
    // Support both MINIO_ACCESS_KEY and MINIO_ROOT_USER (CapRover uses MINIO_ROOT_USER)
    this.accessKeyId = config.accessKeyId || process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || '';
    
    // Support both MINIO_SECRET_KEY and MINIO_ROOT_PASSWORD (CapRover uses MINIO_ROOT_PASSWORD)
    this.secretAccessKey = config.secretAccessKey || process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
    
    this.bucketName = config.bucketName || process.env.MINIO_BUCKET_NAME || 'extrahand-images';
    
    // Support MINIO_SERVER_URL (from CapRover) or MINIO_PUBLIC_DOMAIN
    const serverUrl = process.env.MINIO_SERVER_URL;
    if (serverUrl) {
      try {
        const url = new URL(serverUrl);
        this.publicDomain = url.hostname;
      } catch (e) {
        this.publicDomain = config.publicDomain || process.env.MINIO_PUBLIC_DOMAIN;
      }
    } else {
      this.publicDomain = config.publicDomain || process.env.MINIO_PUBLIC_DOMAIN;
    }
    
    // Support MINIO_REGION_NAME from CapRover, fallback to us-east-1
    this.region = config.region || process.env.MINIO_REGION_NAME || 'us-east-1';

    // Validate required configuration
    if (!this.accessKeyId || !this.secretAccessKey) {
      logger.warn('⚠️ MinIO credentials not configured. Storage operations will fail.');
    }

    // Initialize S3 client (MinIO is S3-compatible)
    this.s3 = new AWS.S3({
      endpoint: this.endpoint,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      s3ForcePathStyle: true, // Required for MinIO
      signatureVersion: 'v4',
      region: this.region,
    });

    logger.info('✅ CapRover MinIO Storage initialized', {
      endpoint: this.endpoint,
      bucket: this.bucketName,
      publicDomain: this.publicDomain || 'using endpoint',
      region: this.region,
    });

    // Ensure bucket exists on initialization
    this.ensureBucketExists().catch(error => {
      logger.warn('⚠️ Could not ensure bucket exists during initialization:', error.message);
    });
  }

  /**
   * Ensure bucket exists, create if it doesn't
   */
  private async ensureBucketExists(): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      // Check if bucket exists
      try {
        await this.s3.headBucket({ Bucket: this.bucketName }).promise();
        // Bucket exists - ensure public read policy is set
        await this.ensureBucketPolicy();
        logger.debug(`✅ Bucket '${this.bucketName}' exists - ready for uploads`);
        return true;
      } catch (headError: any) {
        // Bucket doesn't exist (404/NotFound) - proceed to create it
        if (headError.statusCode === 404 || headError.code === 'NotFound') {
          try {
            logger.info(`📦 Bucket '${this.bucketName}' not found. Creating it...`);
            await this.s3.createBucket({ Bucket: this.bucketName }).promise();
            
            // Set bucket policy for public read access
            await this.ensureBucketPolicy();
            
            logger.info(`✅ Bucket '${this.bucketName}' created successfully - ready for uploads`);
            return true;
          } catch (createError: any) {
            // Handle race condition: bucket might have been created by another request
            if (
              createError.code === 'BucketAlreadyOwnedByYou' ||
              createError.code === 'BucketAlreadyExists' ||
              createError.message.includes('already own it') ||
              createError.message.includes('already exists')
            ) {
              logger.debug(`✅ Bucket '${this.bucketName}' exists (created by concurrent request) - ready for uploads`);
              return true;
            }
            logger.error('Error creating bucket:', {
              error: createError.message,
              code: createError.code,
              bucket: this.bucketName,
            });
            throw createError;
          }
        }
        throw headError;
      }
    } catch (error: any) {
      logger.error('Failed to ensure bucket exists:', {
        error: error.message,
        code: error.code,
        bucket: this.bucketName,
      });
      throw new Error(`Failed to ensure bucket exists: ${error.message}`);
    }
  }

  /**
   * Ensure bucket has public read policy
   */
  private async ensureBucketPolicy(): Promise<void> {
    try {
      const bucketPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucketName}/*`],
          },
        ],
      };
      
      await this.s3.putBucketPolicy({
        Bucket: this.bucketName,
        Policy: JSON.stringify(bucketPolicy),
      }).promise();
      
      logger.debug(`✅ Bucket policy set for public read access on '${this.bucketName}'`);
    } catch (policyError: any) {
      // Log but don't fail - policy might already be set or might require admin access
      if (policyError.code !== 'MalformedPolicy' && !policyError.message.includes('already exists')) {
        logger.warn(`⚠️ Could not set bucket policy (may need manual configuration): ${policyError.message}`);
      }
    }
  }

  /**
   * Upload file to MinIO
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
        throw new Error('MinIO credentials not configured');
      }

      // Ensure bucket exists before upload
      await this.ensureBucketExists();

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

      // Generate presigned read URL (valid for 1 year) for secure access
      let url: string;
      try {
        url = await this.getPresignedReadUrl(key, 31536000); // 1 year expiry
        logger.debug('Using presigned read URL for uploaded file');
      } catch (presignedError) {
        // Fallback to public URL if presigned fails
        logger.warn('Could not generate presigned URL, using public URL:', (presignedError as Error).message);
        url = this.getFileUrl(key);
      }

      logger.info('File uploaded to MinIO', {
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
      logger.error('Error uploading file to MinIO:', {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to upload file to MinIO: ${error.message}`);
    }
  }

  /**
   * Delete file from MinIO
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      const params: AWS.S3.DeleteObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
      };

      await this.s3.deleteObject(params).promise();

      logger.info('File deleted from MinIO', { key, bucket: this.bucketName });
      return true;
    } catch (error: any) {
      logger.error('Error deleting file from MinIO:', {
        error: error.message,
        key,
      });
      throw new Error(`Failed to delete file from MinIO: ${error.message}`);
    }
  }

  /**
   * Get public URL for a file
   */
  getFileUrl(key: string): string {
    if (this.publicDomain) {
      // Use public domain if configured
      return `https://${this.publicDomain}/${this.bucketName}/${key}`;
    }
    
    // Fallback to endpoint URL (internal, may not be accessible from outside)
    const endpointUrl = this.endpoint.replace(/\/$/, ''); // Remove trailing slash
    return `${endpointUrl}/${this.bucketName}/${key}`;
  }

  /**
   * Generate presigned URL for reading a file (GET)
   */
  private async getPresignedReadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      const params = {
        Bucket: this.bucketName,
        Key: key,
        Expires: expiresIn,
      };

      const url = await this.s3.getSignedUrlPromise('getObject', params);
      return url;
    } catch (error: any) {
      logger.error('Error generating presigned read URL:', {
        error: error.message,
        key,
      });
      throw new Error(`Failed to generate presigned read URL: ${error.message}`);
    }
  }

  /**
   * Generate presigned URL for direct upload (PUT)
   */
  async getPresignedUploadUrl(key: string, contentType: string, expiresIn: number = 3600): Promise<string> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      // Ensure bucket exists before generating URL
      await this.ensureBucketExists();

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
   * Health check - verify MinIO is accessible and bucket exists
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        return false;
      }

      // Try to ensure bucket exists (will create if needed)
      await this.ensureBucketExists();
      
      // Verify we can access the bucket
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      return true;
    } catch (error: any) {
      logger.warn('MinIO health check failed:', error.message);
      return false;
    }
  }
}
