/**
 * Local File Storage Provider for Development
 * 
 * Saves files to local disk instead of cloud storage
 * Perfect for development/testing without needing MinIO or S3
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../../config/logger';
import { BaseStorage } from './StorageInterface';

export class LocalFileStorage extends BaseStorage {
  private uploadDir: string;
  private publicBaseUrl: string;

  constructor(config: any = {}) {
    super();
    
    // Default to 'uploads' directory in project root
    this.uploadDir = config.uploadDir || process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), 'uploads');
    
    // Base URL for accessing files (e.g., http://localhost:4002/uploads)
    const port = process.env.PORT || '4002';
    this.publicBaseUrl = config.publicBaseUrl || process.env.LOCAL_STORAGE_URL || `http://localhost:${port}/uploads`;
    
    // Ensure upload directory exists
    this.ensureDirectoryExists(this.uploadDir);
    
    logger.info('✅ Local File Storage initialized', {
      uploadDir: this.uploadDir,
      publicBaseUrl: this.publicBaseUrl
    });
  }

  /**
   * Ensure directory exists, create if it doesn't
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`📁 Created directory: ${dirPath}`);
    }
  }

  /**
   * Upload file to local disk
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    _contentType: string,
    folder: string = 'uploads',
    _metadata: any = {}
  ): Promise<{ url: string; key: string }> {
    try {
      // Create folder path
      const folderPath = path.join(this.uploadDir, folder);
      this.ensureDirectoryExists(folderPath);

      // Sanitize file name
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const timestamp = Date.now();
      const finalFileName = `${timestamp}_${sanitizedFileName}`;
      const filePath = path.join(folderPath, finalFileName);

      // Write file to disk
      fs.writeFileSync(filePath, fileBuffer);

      // Generate key (relative path from upload dir)
      const key = `${folder}/${finalFileName}`;

      // Generate URL
      const url = `${this.publicBaseUrl}/${key}`;

      logger.info('File saved to local storage', {
        key,
        path: filePath,
        url,
        size: fileBuffer.length
      });

      return { url, key };
    } catch (error: any) {
      logger.error('Error saving file to local storage:', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to save file to local storage: ${error.message}`);
    }
  }

  /**
   * Delete file from local disk
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      const filePath = path.join(this.uploadDir, key);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info('File deleted from local storage', { key, path: filePath });
        return true;
      } else {
        logger.warn('File not found for deletion', { key, path: filePath });
        return false;
      }
    } catch (error: any) {
      logger.error('Error deleting file from local storage:', {
        error: error.message,
        key
      });
      throw new Error(`Failed to delete file from local storage: ${error.message}`);
    }
  }

  /**
   * Get public URL for a file
   */
  getFileUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  /**
   * Generate presigned URL (not needed for local storage, returns public URL)
   */
  async getPresignedUploadUrl(
    key: string,
    _contentType: string,
    _expiresIn: number = 3600
  ): Promise<string> {
    // For local storage, just return the public URL
    // In a real implementation, you might add a token or similar
    return this.getFileUrl(key);
  }

  /**
   * Health check - verify upload directory is writable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test write to a temp file
      const testFile = path.join(this.uploadDir, '.health-check');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return true;
    } catch (error: any) {
      logger.warn('Local file storage health check failed:', error.message);
      return false;
    }
  }
}
