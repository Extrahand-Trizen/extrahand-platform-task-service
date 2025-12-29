import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

/**
 * UserServiceClient
 * 
 * HTTP-based client for calling user-service APIs
 * Respects microservice boundaries - never accesses user database directly
 * 
 * Usage:
 * const userIds = await UserServiceClient.matchUsers('skill', { category: 'cleaning' });
 * const userIds = await UserServiceClient.matchUsers('keywords', { keywords: ['electrical', 'plumbing'] });
 */
export class UserServiceClient {
  private static baseURL: string = 'http://localhost:4001';
  private static serviceAuthToken: string = '';
  private static isInitialized: boolean = false;

  /**
   * Initialize UserServiceClient with required config
   * MUST be called once at app startup
   * 
   * @param baseURL - User service base URL (e.g., http://localhost:4001)
   * 
   * Usage:
   * // In app.ts at startup
   * UserServiceClient.initialize('http://localhost:4001');
   */
  static initialize(baseURL?: string): void {
    const env = validateEnv();
    this.baseURL = baseURL || process.env.USER_SERVICE_URL || 'http://localhost:4001';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
    this.isInitialized = true;

    logger.info('UserServiceClient initialized', {
      baseURL: this.baseURL,
      hasAuthToken: !!this.serviceAuthToken
    });

    if (!this.serviceAuthToken) {
      logger.warn('UserServiceClient initialized without SERVICE_AUTH_TOKEN', {
        consequence: 'Matching requests will fail silently'
      });
    }
  }

  /**
   * Match users based on skill category or keywords
   * 
   * For skill matching: Find taskers with a specific skill category
   * For keyword matching: Find users who have saved keywords
   * 
   * @param type - Matching type: 'skill' or 'keywords'
   * @param criteria - Criteria object:
   *   - For 'skill': { category: string } (e.g., 'cleaning')
   *   - For 'keywords': { keywords: string[] } (e.g., ['electrical', 'plumbing'])
   * 
   * @returns Promise<string[]> Array of user UIDs that match criteria
   * 
   * Usage:
   * // Skill matching
   * const taskers = await UserServiceClient.matchUsers('skill', {
   *   category: 'cleaning'
   * });
   * 
   * // Keyword matching
   * const users = await UserServiceClient.matchUsers('keywords', {
   *   keywords: ['electrical', 'plumbing', 'repair']
   * });
   */
  static async matchUsers(
    type: 'skill' | 'keywords',
    criteria: { category?: string; keywords?: string[] }
  ): Promise<string[]> {
    if (!this.isInitialized) {
      logger.warn('UserServiceClient: Not initialized, calling initialize with defaults');
      this.initialize();
    }

    try {
      logger.info('UserServiceClient: Matching users', { type, criteria });

      const response = await axios.post(
        `${this.baseURL}/api/v1/profiles/internal/match-users`,
        { type, criteria },
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      const userIds = response.data.userIds || [];
      logger.info('UserServiceClient: Matching successful', {
        type,
        matchedCount: userIds.length
      });

      return userIds;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('UserServiceClient: Failed to match users', {
        type,
        criteria,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        message: axiosError.message
      });

      // Fail gracefully - return empty array instead of throwing
      // This ensures a task creation failure doesn't prevent notifications
      return [];
    }
  }
}
