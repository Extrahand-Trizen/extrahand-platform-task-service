/**
 * Badge Service Integration
 * This file should be integrated into the Task Service to trigger badge checks
 * after task completion
 * 
 * Location: extrahand-platform-task-service/src/services/badgeIntegration.ts
 */

import axios from 'axios';
import logger from '../config/logger';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';

/**
 * Called after a task is marked as completed
 * Triggers badge upgrade check for the user
 */
export async function checkUserBadgeUpgrade(
  userId: string,
  userToken: string
): Promise<{ success: boolean; upgraded?: boolean; newBadge?: string; message?: string }> {
  try {
    const response = await axios.post(
      `${USER_SERVICE_URL}/user/badge/check-upgrade`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    if (response.data.success) {
      if (response.data.data.upgraded) {
        logger.info('✅ User badge upgraded', {
          userId,
          newBadge: response.data.data.newBadge,
          previousBadge: response.data.data.previousBadge
        });

        return {
          success: true,
          upgraded: true,
          newBadge: response.data.data.newBadge,
          message: response.data.data.message
        };
      } else {
        return {
          success: true,
          upgraded: false,
          message: 'No badge upgrade at this time'
        };
      }
    }

    return { success: false, message: response.data.error };
  } catch (error: any) {
    logger.warn('Failed to check badge upgrade:', {
      userId,
      error: error.message
    });
    // Don't fail task completion if badge check fails
    return { success: false, message: 'Badge check failed' };
  }
}

/**
 * Get user's current badge and fee percentage
 */
export async function getUserBadgeInfo(
  userId: string,
  serviceToken: string
): Promise<{ badge?: string; feePercentage?: number; error?: string }> {
  try {
    const response = await axios.get(
      `${USER_SERVICE_URL}/user/badge`,
      {
        headers: {
          'X-User-Id': userId,
          'X-Service-Token': serviceToken
        },
        timeout: 5000
      }
    );

    if (response.data.success) {
      return {
        badge: response.data.data.currentBadge,
        feePercentage: response.data.data.platformFeePercentage
      };
    }

    return { error: response.data.error };
  } catch (error: any) {
    logger.warn('Failed to get user badge info:', {
      userId,
      error: error.message
    });
    return { error: error.message };
  }
}

/**
 * Get badge tier configuration
 */
export async function getBadgeTierConfig(
  badgeLevel: string
): Promise<{ name?: string; feePercentage?: number; benefits?: string[]; error?: string }> {
  try {
    const response = await axios.get(
      `${USER_SERVICE_URL}/badge/tier-config/${badgeLevel}`,
      {
        timeout: 5000
      }
    );

    if (response.data.success) {
      return {
        name: response.data.data.name,
        feePercentage: response.data.data.platformFeePercentage,
        benefits: response.data.data.benefits
      };
    }

    return { error: response.data.error };
  } catch (error: any) {
    logger.warn('Failed to get badge tier config:', {
      badge: badgeLevel,
      error: error.message
    });
    return { error: error.message };
  }
}
