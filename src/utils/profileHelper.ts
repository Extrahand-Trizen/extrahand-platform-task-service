import mongoose from 'mongoose';
import logger from '../config/logger';

// Helper function to get user name from profile
// Since we share the same MongoDB, we can query Profile collection directly
export async function getUserName(uid: string): Promise<string | null> {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      logger.warn('MongoDB not connected, cannot fetch user name');
      return null;
    }

    // Query Profile collection directly (same DB as User Service)
    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne({ uid }, { projection: { name: 1 } });
    
    return profile?.name || null;
  } catch (error) {
    logger.error('Error fetching user name:', error);
    return null;
  }
}



