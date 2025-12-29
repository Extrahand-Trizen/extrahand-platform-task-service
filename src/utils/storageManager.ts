/**
 * Storage Manager
 * 
 * Factory/Manager for storage providers
 * Allows easy switching between MinIO, AWS S3, and other storage providers
 */

import logger from '../config/logger';
import { MinIOStorage } from './storage/MinIOStorage';
import { S3Storage } from './storage/S3Storage';
import { LocalFileStorage } from './storage/LocalFileStorage';
import { StorageInterface } from './storage/StorageInterface';
import { validateEnv } from '../config/env';

const env = validateEnv();

// Storage provider types
export const STORAGE_TYPES = {
  MINIO: 'minio',
  S3: 's3',
  LOCAL: 'local',
} as const;

// Get storage provider type from environment (internal function)
function getStorageTypeInternal(): string {
  const provider = env.STORAGE_PROVIDER?.toLowerCase();
  if (provider && Object.values(STORAGE_TYPES).includes(provider as any)) {
    return provider;
  }
  // Default to local for development
  return STORAGE_TYPES.LOCAL;
}

// Initialize storage provider based on configuration
let storageInstance: StorageInterface | null = null;

/**
 * Get or create storage instance
 */
function getStorage(): StorageInterface {
  if (storageInstance) {
    return storageInstance;
  }

  const storageType = getStorageTypeInternal();
  logger.info(`📦 Initializing storage provider: ${storageType}`);

  switch (storageType) {
    case STORAGE_TYPES.LOCAL:
      logger.info('✅ Using Local File Storage (development mode)');
      storageInstance = new LocalFileStorage();
      break;

    case STORAGE_TYPES.MINIO:
      logger.info('✅ Using CapRover MinIO storage (S3-compatible, uses AWS SDK for S3 API)');
      storageInstance = new MinIOStorage();
      break;
    
    case STORAGE_TYPES.S3:
      logger.info('✅ Using AWS S3 storage');
      storageInstance = new S3Storage();
      break;
    
    default:
      logger.warn(`⚠️ Unknown storage provider: ${storageType}. Falling back to Local File Storage.`);
      storageInstance = new LocalFileStorage();
  }

  // Perform health check
  storageInstance.healthCheck()
    .then(isHealthy => {
      if (isHealthy) {
        logger.info(`✅ Storage provider (${storageType}) is healthy`);
      } else {
        logger.warn(`⚠️ Storage provider (${storageType}) health check failed`);
      }
    })
    .catch(error => {
      logger.error(`❌ Storage provider (${storageType}) health check error:`, error);
    });

  return storageInstance;
}

/**
 * Reset storage instance (useful for testing or reconfiguration)
 */
function resetStorage(): void {
  storageInstance = null;
  logger.info('🔄 Storage instance reset');
}

/**
 * Upload file to storage
 */
export async function uploadFile(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  folder: string = 'uploads',
  metadata: any = {}
): Promise<{ url: string; key: string; bucket?: string }> {
  const storage = getStorage();
  return await storage.uploadFile(fileBuffer, fileName, contentType, folder, metadata);
}

/**
 * Delete file from storage
 */
export async function deleteFile(key: string): Promise<boolean> {
  const storage = getStorage();
  return await storage.deleteFile(key);
}

/**
 * Get public URL for a file
 */
export function getFileUrl(key: string): string {
  const storage = getStorage();
  return storage.getFileUrl(key);
}

/**
 * Generate presigned URL for direct upload
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const storage = getStorage();
  return await storage.getPresignedUploadUrl(key, contentType, expiresIn);
}

/**
 * Health check for storage
 */
export async function healthCheck(): Promise<boolean> {
  const storage = getStorage();
  return await storage.healthCheck();
}

// Export StorageManager class for backward compatibility
export class StorageManager {
  static getStorageType(): string {
    return getStorageTypeInternal();
  }

  static async uploadFile(
    buffer: Buffer,
    filename: string,
    mimetype: string,
    folder: string,
    metadata?: any
  ): Promise<{ url: string; key: string }> {
    const result = await uploadFile(buffer, filename, mimetype, folder, metadata);
    return { url: result.url, key: result.key };
  }

  static async deleteFile(key: string): Promise<void> {
    await deleteFile(key);
  }

  static async healthCheck(): Promise<boolean> {
    return await healthCheck();
  }
}

// Export getStorageType function
export function getStorageType(): string {
  return getStorageTypeInternal();
}

// Export utility functions
export { getStorage, resetStorage };


