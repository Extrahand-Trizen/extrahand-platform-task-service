import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Define environment schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).refine(n => n > 0 && n < 65536, 'Port must be between 1-65535').default('4002'),
  
  // MongoDB
  MONGODB_URI: z.string().url('Invalid MongoDB URI').optional(),
  MONGODB_DB: z.string().default('extrahand'),
  
  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Security
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('1000'),
  
  // CORS
  CORS_ORIGIN: z.string().optional(),
  
  // Health check
  HEALTH_CHECK_PATH: z.string().default('/api/v1/health'),
  
  // Service-to-Service Communication
  SERVICE_AUTH_TOKEN: z.string().min(1, 'SERVICE_AUTH_TOKEN is required for service-to-service communication').optional(),

  /**
   * When "true" or "1": dev-only behavior (e.g. resolve missing X-Profile-Id from uid for dummy sessions).
   * Must remain unset/false in production (same contract as api-gateway complete-dev).
   */
  LOCAL_TEST: z.string().optional(),

  /** Comma-separated *poster* Firebase UIDs (test); assignee may use 123123 to start */
  TASK_START_OTP_BYPASS_UIDS: z.string().optional(),
  USER_SERVICE_URL: z.string().url().default('http://localhost:4001'),
  MESSAGING_SERVICE_URL: z.string().url().default('http://localhost:4006'),
  NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:4005'),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:4003'),
  EMAIL_SERVICE_URL: z.string().url().optional(),
  WEB_APP_URL: z.string().url().optional(),
  MAIN_ADMIN_SERVICE_URL: z.string().url().default('http://localhost:4007'),
  
  // SMS Configuration
  FAST2SMS_API_KEY: z.string().optional(),
  
  // Storage Configuration
  STORAGE_PROVIDER: z.enum(['minio', 's3', 'local']).default('local'),
  
  // MinIO Configuration
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_ROOT_USER: z.string().optional(),
  MINIO_ROOT_PASSWORD: z.string().optional(),
  MINIO_BUCKET_NAME: z.string().default('extrahand-images'),
  MINIO_PUBLIC_DOMAIN: z.string().optional(),
  MINIO_SERVER_URL: z.string().url().optional(),
  MINIO_REGION_NAME: z.string().optional(),
  
  // AWS S3 Configuration
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().default('extrahand-images'),
  AWS_CLOUDFRONT_DOMAIN: z.string().optional(),

  // Redis (optional - task list cache; app works without it)
  // Use redis:// or rediss:// (not https); e.g. redis://:password@host:6379
  REDIS_URL: z
    .string()
    .optional()
    .refine(
      (v) => !v || v.startsWith('redis://') || v.startsWith('rediss://'),
      'REDIS_URL must be redis:// or rediss:// (e.g. redis://:password@host:6379)'
    ),
});

// Extend global type for CORS config logging
declare global {
  // eslint-disable-next-line no-var
  var __CORS_CONFIG_LOGGED__: boolean | undefined;
}

// CORS configuration
export function getCorsConfig(env: z.infer<typeof envSchema>) {
  const allowedOrigins = [
    'https://extrahand.in',
    'https://www.extrahand.in',
    'http://localhost:3000',
    'http://localhost:4000',
    'http://localhost:4001',
    'http://localhost:4002',
    'http://localhost:4004',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4000',
    'http://127.0.0.1:4001',
    'http://127.0.0.1:4002',
    'http://127.0.0.1:4004',
    'http://127.0.0.1:8080'
  ];
  
  if (env.CORS_ORIGIN) {
    const customOrigins = env.CORS_ORIGIN.split(',').map(origin => origin.trim());
    allowedOrigins.push(...customOrigins);
  }
  
  if (!global.__CORS_CONFIG_LOGGED__) {
    console.log(`🌐 CORS Configuration - Environment: ${env.NODE_ENV}`);
    console.log(`🌐 CORS Allowed Origins:`, allowedOrigins);
    global.__CORS_CONFIG_LOGGED__ = true;
  }
  
  return {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin) {
        if (env.NODE_ENV === 'development') {
          console.log('🔓 CORS: Allowing request with no origin');
        }
        return callback(null, true);
      }
      
      if (env.NODE_ENV === 'development') {
        console.log(`🔍 CORS: Checking origin: ${origin}`);
      }
      
      if (allowedOrigins.includes(origin)) {
        if (env.NODE_ENV === 'development') {
          console.log(`🔓 CORS: Allowing origin: ${origin}`);
        }
        callback(null, true);
      } else {
        console.log(`🔒 CORS: Blocking origin: ${origin}`);
        console.log(`🔒 CORS: Origin not in allowed list. Allowed origins:`, allowedOrigins);
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      }
    },
    credentials: true,
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Cache-Control',
      'Pragma',
      'X-API-Key',
      'X-Service-Auth',
      'X-User-Id',
      'X-Service-Name'
    ],
    preflightContinue: false,
    exposedHeaders: ['Content-Length', 'X-Foo'],
    maxAge: 86400 // 24 hours
  };
}

export function validateEnv() {
  try {
    const env = envSchema.parse(process.env);
    
    // Check for Firebase credentials
    const hasFirebaseEnvVars = env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY;
    const hasFirebaseServiceAccountPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const hasGoogleCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    const serviceAccountPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
    const hasServiceAccountFile = fs.existsSync(serviceAccountPath);
    
    const hasFirebaseCredentials = hasFirebaseEnvVars || hasFirebaseServiceAccountPath || hasGoogleCredentials || hasServiceAccountFile;
    
    if (!hasFirebaseCredentials && env.NODE_ENV === 'production') {
      throw new Error('Firebase credentials must be provided in production. Either set environment variables or ensure serviceAccountKey.json exists.');
    }
    
    if (hasServiceAccountFile) {
      console.log('✅ Firebase service account file found: serviceAccountKey.json');
    } else if (hasFirebaseEnvVars) {
      console.log('✅ Firebase credentials found in environment variables');
    } else if (hasFirebaseServiceAccountPath) {
      console.log('✅ Firebase service account path specified:', env.FIREBASE_SERVICE_ACCOUNT_PATH);
    } else if (hasGoogleCredentials) {
      console.log('✅ Google Application Credentials found');
    }
    
    return env;
  } catch (error) {
    console.error('❌ Environment validation failed:');
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(`  - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    process.exit(1);
  }
}

export type EnvConfig = z.infer<typeof envSchema>;

// Config class for easy access
export class Config {
  private static env: z.infer<typeof envSchema>;

  static initialize() {
    this.env = validateEnv();
  }

  static get PORT(): number {
    return this.env.PORT;
  }

  static get NODE_ENV(): string {
    return this.env.NODE_ENV;
  }

  static get MONGODB_URI(): string {
    return this.env.MONGODB_URI || '';
  }

  static get LOG_LEVEL(): string {
    return this.env.LOG_LEVEL;
  }

  static get RATE_LIMIT_WINDOW_MS(): number {
    return this.env.RATE_LIMIT_WINDOW_MS;
  }

  static get RATE_LIMIT_MAX_REQUESTS(): number {
    return this.env.RATE_LIMIT_MAX_REQUESTS;
  }

  static get CORS_ORIGIN(): string | undefined {
    return this.env.CORS_ORIGIN;
  }

  static get SERVICE_AUTH_TOKEN(): string | undefined {
    return this.env.SERVICE_AUTH_TOKEN;
  }

  static get LOCAL_TEST(): string | undefined {
    return this.env.LOCAL_TEST;
  }

  static get TASK_START_OTP_BYPASS_UIDS(): string | undefined {
    return this.env.TASK_START_OTP_BYPASS_UIDS;
  }

  static get USER_SERVICE_URL(): string {
    return this.env.USER_SERVICE_URL;
  }

  static get MESSAGING_SERVICE_URL(): string {
    return this.env.MESSAGING_SERVICE_URL;
  }

  static get PAYMENT_SERVICE_URL(): string {
    return this.env.PAYMENT_SERVICE_URL;
  }

  static get EMAIL_SERVICE_URL(): string {
    return this.env.EMAIL_SERVICE_URL || 'http://localhost:4007';
  }

  static get MAIN_ADMIN_SERVICE_URL(): string {
    return this.env.MAIN_ADMIN_SERVICE_URL || 'http://localhost:4007';
  }

  static get WEB_APP_URL(): string {
    return this.env.WEB_APP_URL || 'https://extrahand.in';
  }

  static get FAST2SMS_API_KEY(): string | undefined {
    return this.env.FAST2SMS_API_KEY;
  }

  static get STORAGE_PROVIDER(): 'minio' | 's3' | 'local' {
    return this.env.STORAGE_PROVIDER;
  }

  static get REDIS_URL(): string | undefined {
    return this.env.REDIS_URL;
  }
}

// Initialize config on module load
Config.initialize();

export const config = Config;

