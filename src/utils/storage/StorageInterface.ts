/**
 * Storage Interface
 * Base class that all storage providers must implement
 */

export interface StorageInterface {
  uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    folder?: string,
    metadata?: any
  ): Promise<{ url: string; key: string; bucket?: string }>;

  deleteFile(key: string): Promise<boolean>;

  getFileUrl(key: string): string;

  getPresignedUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string>;

  healthCheck(): Promise<boolean>;
}

export abstract class BaseStorage implements StorageInterface {
  abstract uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    folder?: string,
    metadata?: any
  ): Promise<{ url: string; key: string; bucket?: string }>;

  abstract deleteFile(key: string): Promise<boolean>;

  abstract getFileUrl(key: string): string;

  abstract getPresignedUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string>;

  abstract healthCheck(): Promise<boolean>;
}


