import dns from 'node:dns';
import mongoose from 'mongoose';
import logger from './logger';
import { config } from './env';

// Temporary workaround for local DNS issue on Windows
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch {
  // ignore
}

let qcConnection: mongoose.Connection | null = null;
let isConnecting = false;
let connectPromise: Promise<mongoose.Connection> | null = null;

export class QcDatabase {
  public static async getQcConnection(): Promise<mongoose.Connection> {
    if (qcConnection && qcConnection.readyState === 1) {
      return qcConnection;
    }

    if (isConnecting && connectPromise) {
      return connectPromise;
    }

    const uri =
      process.env.QC_MONGODB_URI ||
      config.QC_MONGODB_URI ||
      'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

    const dbName = process.env.QC_MONGODB_DB || config.QC_MONGODB_DB || 'extrahand';

    isConnecting = true;
    connectPromise = (async () => {
      try {
        logger.info('🔌 Connecting to Quick Commerce MongoDB cluster...');
        logger.info(`📊 QC Database: ${dbName}`);

        const conn = mongoose.createConnection(uri, {
          dbName,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 10000,
          maxPoolSize: 10,
          minPoolSize: 2,
        });

        await new Promise<void>((resolve, reject) => {
          conn.once('open', () => {
            logger.info('✅ Quick Commerce MongoDB connected successfully');
            resolve();
          });
          conn.once('error', (err) => {
            logger.error('❌ Quick Commerce MongoDB connection error:', err);
            reject(err);
          });
        });

        conn.on('disconnected', () => {
          logger.warn('⚠️ QC MongoDB disconnected');
          qcConnection = null;
        });

        qcConnection = conn;
        return conn;
      } catch (error) {
        logger.error('❌ Failed to connect to Quick Commerce MongoDB:', error);
        qcConnection = null;
        throw error;
      } finally {
        isConnecting = false;
      }
    })();

    return connectPromise;
  }

  public static async getQcDb() {
    const conn = await this.getQcConnection();
    return conn.db;
  }
}

export default QcDatabase;
