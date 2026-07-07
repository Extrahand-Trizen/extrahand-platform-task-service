import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import logger from './logger';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  let credential: admin.credential.Credential | undefined = undefined;

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_PATH,
  } = process.env;

  try {
    // 1) Env vars with raw private key
    if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
      const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      credential = admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey,
      });
      logger.info('✅ Firebase initialized with environment variables');
    } else {
      // 2) Local service account file
      const candidatePath = FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, '..', '..', 'serviceAccountKey.json');
      if (fs.existsSync(candidatePath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
        credential = admin.credential.cert(serviceAccount);
        logger.info('✅ Firebase initialized with service account file');
      }
    }
  } catch (e) {
    logger.warn('⚠️ Failed to load Firebase credentials from env/file, falling back to ADC');
  }

  if (credential) {
    admin.initializeApp({ credential });
  } else {
    // 3) ADC (GOOGLE_APPLICATION_CREDENTIALS or GCP runtime)
    try {
      admin.initializeApp();
      logger.info('✅ Firebase initialized with Application Default Credentials');
    } catch (error) {
      logger.error('❌ Failed to initialize Firebase:', error);
      throw new Error('Firebase initialization failed. Please provide credentials.');
    }
  }
}

export const auth = admin.auth();
export const db = admin.firestore();
export { admin };

