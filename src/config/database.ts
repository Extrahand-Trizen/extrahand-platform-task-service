import dns from 'node:dns';
import mongoose from 'mongoose';
import logger from './logger';
import { config } from './env';

// Temporary workaround for local DNS issue.
// Remove once your Windows DNS problem is fixed.
dns.setServers(['8.8.8.8', '8.8.4.4']);

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

    // Fix malformed URI if detected (common issue with duplicate appName parameter)
    let cleanUri = uri;
    if (uri.includes('appName=Cluster0w=majority')) {
      cleanUri = uri.replace(
        /appName=Cluster0w=majority&appName=Cluster0/,
        'appName=Cluster0'
      );
      logger.warn('⚠️ Detected malformed MongoDB URI, auto-fixing...');
    }

    try {
      const connectionOptions = {
        dbName: process.env.MONGODB_DB || 'extrahand',
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 2,
      };

      logger.info('🔌 Attempting to connect to MongoDB...');
      logger.info(`📊 Database: ${connectionOptions.dbName}`);

      await mongoose.connect(cleanUri, connectionOptions);

      isConnected = true;

      logger.info('✅ MongoDB connected successfully');
      logger.info(
        `📊 Connected to database: ${
          mongoose.connection.db?.databaseName || connectionOptions.dbName
        }`
      );

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
    const readyState = mongoose.connection.readyState;
    const connected = isConnected && readyState === 1;

    if (!connected && readyState !== 0) {
      const states = [
        'disconnected',
        'connected',
        'connecting',
        'disconnecting',
      ];

      logger.warn(
        `⚠️ MongoDB connection state: ${
          states[readyState] || 'unknown'
        } (${readyState})`
      );
    }

    return connected;
  }
}