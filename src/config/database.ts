import mongoose from 'mongoose';
import logger from './logger';
import { config } from './env';

let isConnected = false;

export class Database {
  public static async connectToDb(): Promise<void> {
    if (isConnected) {
      logger.info('✅ MongoDB already connected');
      return;
    }

    const uri = config.MONGODB_URI;
    if (!uri) {
      logger.warn('⚠️ MONGODB_URI not provided, skipping MongoDB connection');
      return;
    }

    mongoose.set('strictQuery', true);

    try {
      await mongoose.connect(uri, {
        dbName: process.env.MONGODB_DB || 'extrahand',
      });

      isConnected = true;
      logger.info('✅ MongoDB connected successfully');

      // Handle connection events
      mongoose.connection.on('error', (err) => {
        logger.error('❌ MongoDB connection error:', err);
        isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('⚠️ MongoDB disconnected');
        isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('✅ MongoDB reconnected');
        isConnected = true;
      });
    } catch (error) {
      logger.error('❌ Failed to connect to MongoDB:', error);
      isConnected = false;
      throw error;
    }
  }

  public static async disconnectFromDb(): Promise<void> {
    if (isConnected) {
      await mongoose.disconnect();
      isConnected = false;
      logger.info('✅ MongoDB disconnected');
    }
  }

  public static isConnected(): boolean {
    return isConnected && mongoose.connection.readyState === 1;
  }
}

