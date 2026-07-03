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
  * @param type - Matching type: 'skill', 'keywords', or 'categories'
  * @param criteria - Criteria object:
  *   - For 'skill': { category: string } (e.g., 'cleaning')
  *   - For 'keywords': { keywords: string[] } (e.g., ['electrical', 'plumbing'])
  *   - For 'categories': { categorySlugs: string[] }
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
    type: 'skill' | 'nearby' | 'keywords' | 'categories',
    criteria: {
      category?: string;
      categories?: string[];
      keywords?: string[];
      categorySlugs?: string[];
      longitude?: number;
      latitude?: number;
      radiusMeters?: number;
      excludeUids?: string[];
    }
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

  static async matchSkillCategories(categories: string[]): Promise<string[]> {
    const unique = Array.from(
      new Set(
        (categories || []).filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    );
    if (unique.length === 0) return [];

    if (unique.length === 1) {
      return this.matchUsers('skill', { category: unique[0] });
    }

    return this.matchUsers('skill', { categories: unique });
  }

  static async matchNearbyTaskers(params: {
    longitude: number;
    latitude: number;
    radiusMeters?: number;
    excludeUids?: string[];
  }): Promise<string[]> {
    return this.matchUsers('nearby', params);
  }

  /**
   * Poster / Book Now helper availability — same rules as GET nearby-helpers.
   * Returns null when user-service cannot be reached (fail-open, like poster UI).
   */
  static async checkPosterHelperAvailability(params: {
    firebaseUid?: string;
    city?: string;
    pinCode?: string;
    lat?: number;
    lng?: number;
    limit?: number;
  }): Promise<{
    checkPerformed: boolean;
    resolvedCity: string | null;
    count: number;
    hasHelpers: boolean;
    serviceable: boolean;
  } | null> {
    const city = String(params.city || '').trim();
    const pinCode = String(params.pinCode || '').trim();
    const firebaseUid = String(params.firebaseUid || '').trim();
    const limit = params.limit ?? 1;

    if (!this.isInitialized) {
      logger.warn('UserServiceClient: Not initialized, calling initialize with defaults');
      this.initialize();
    }

    try {
      const response = await axios.get(
        `${this.baseURL}/api/v1/profiles/internal/helper-availability-by-city`,
        {
          params: {
            ...(city ? { city } : {}),
            ...(pinCode ? { pinCode } : {}),
            ...(firebaseUid ? { firebaseUid } : {}),
            ...(typeof params.lat === 'number' && Number.isFinite(params.lat)
              ? { lat: params.lat }
              : {}),
            ...(typeof params.lng === 'number' && Number.isFinite(params.lng)
              ? { lng: params.lng }
              : {}),
            limit,
          },
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 5000,
        },
      );

      const payload = response.data?.data ?? response.data;
      const checkPerformed = Boolean(payload?.checkPerformed);
      const hasHelpers = Boolean(payload?.hasHelpers);
      const count = Number(payload?.count) || 0;
      const resolvedCity =
        typeof payload?.resolvedCity === 'string' ? payload.resolvedCity : city || null;
      const serviceable =
        typeof payload?.serviceable === 'boolean'
          ? payload.serviceable
          : checkPerformed
            ? hasHelpers
            : true;

      return {
        checkPerformed,
        resolvedCity,
        count,
        hasHelpers,
        serviceable,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.warn('UserServiceClient: Failed poster helper availability check', {
        city,
        firebaseUid: firebaseUid || null,
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return null;
    }
  }

  /** @deprecated Use checkPosterHelperAvailability */
  static async hasHelpersInCity(city: string): Promise<boolean | null> {
    const result = await this.checkPosterHelperAvailability({ city, limit: 1 });
    if (result === null) return null;
    return result.serviceable;
  }

  /**
   * Update performer profile stats after task completion
   * Increments completedTasks and totalTasks on the user-service profile.
   *
   * @param profileId - MongoDB ObjectId of the performer's profile
   */
  static async updatePerformerStats(profileId: string): Promise<void> {
    if (!this.isInitialized) {
      this.initialize();
    }

    try {
      await axios.patch(
        `${this.baseURL}/api/v1/profiles/${profileId}/internal/stats-increment`,
        { completedTasks: 1, totalTasks: 1 },
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        }
      );
      logger.info('UserServiceClient: Performer stats incremented', { profileId });
    } catch (error) {
      // Non-critical – log and continue so task completion isn't blocked
      logger.warn('UserServiceClient: Failed to update performer stats (non-critical)', {
        profileId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Forward domain events to user-service rewards qualification engine.
   */
  static async processRewardEvent(params: {
    eventType: string;
    payload: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void> {
    if (!this.isInitialized) {
      this.initialize();
    }
    if (!this.serviceAuthToken) return;

    try {
      await axios.post(
        `${this.baseURL}/api/v1/user/internal/rewards/process-event`,
        params,
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        }
      );
    } catch (error) {
      logger.warn('UserServiceClient: processRewardEvent failed (non-critical)', {
        eventType: params.eventType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
