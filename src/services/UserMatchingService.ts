import logger from '../config/logger';
import mongoose from 'mongoose';

/**
 * UserMatchingService
 * 
 * Finds users who should receive notifications based on:
 * 1. Skill category matching (for recommended task alerts)
 * 2. Keyword matching (for keyword-based task alerts)
 * 
 * All methods apply strict cost-control filters:
 * - Role: tasker or both
 * - Active: isActive = true
 * - Verification: canAcceptTasks = true (verified)
 * - Exact keyword match (case-insensitive)
 * - No duplicates
 */
export class UserMatchingService {
  /**
   * Find taskers whose primary skill category matches the task category
   * 
   * Cost-control filters applied:
   * - Role filter: roles includes 'tasker' or 'both'
   * - Active filter: isActive = true
   * - Verification filter: canAcceptTasks = true
   * 
   * @param task - Task document
   * @returns Array of user IDs (taskers with matching skill category)
   * 
   * Used by: TaskService.createTask() → TASK_CREATED_RECOMMENDED event
   */
  static async findTaskersWithMatchingCategory(task: any): Promise<string[]> {
    try {
      if (!task || !task.category) {
        logger.warn('findTaskersWithMatchingCategory: Invalid task', { taskId: task?._id });
        return [];
      }

      const Profile = mongoose.connection.collection('profiles');

      const taskers = await Profile.find({
        // Role filter: tasker or both
        roles: { $in: ['tasker', 'both'] },
        // Active filter: must be active
        isActive: true,
        // Verification filter: must be verified to accept tasks
        canAcceptTasks: true,
        // Skill filter: primary skill category matches task category
        'skills.primaryCategory': task.category
      })
        .project({ uid: 1 })
        .toArray();

      const userIds = taskers.map((p: any) => p.uid).filter(Boolean);
      
      logger.info('findTaskersWithMatchingCategory', {
        taskId: task._id,
        category: task.category,
        matchedCount: userIds.length
      });

      return userIds;
    } catch (error) {
      logger.error('Error finding taskers with matching category', {
        taskId: task?._id,
        category: task?.category,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Find users who have saved this keyword in their preferences
   * 
   * Cost-control filters applied:
   * - Active filter: isActive = true
   * - Keyword filter: exact match (case-insensitive)
   * - No duplicates
   * 
   * Note: Role filter NOT applied here - both taskers and requesters
   * can subscribe to keyword alerts
   * 
   * @param keyword - Single keyword to search for
   * @returns Array of unique user IDs with this keyword saved
   * 
   * Used by: TaskService.createTask() → TASK_CREATED_KEYWORD event
   */
  static async findUsersWithKeyword(keyword: string): Promise<string[]> {
    try {
      if (!keyword || keyword.trim().length === 0) {
        logger.warn('findUsersWithKeyword: Empty keyword');
        return [];
      }

      // Normalize keyword: lowercase and trim
      const normalizedKeyword = keyword.toLowerCase().trim();

      const Profile = mongoose.connection.collection('profiles');

      // MongoDB query with case-insensitive regex
      const users = await Profile.find({
        isActive: true,
        'savedKeywords.keywords': {
          $regex: `^${normalizedKeyword}$`,
          $options: 'i' // Case-insensitive
        }
      })
        .project({ uid: 1 })
        .toArray();

      // Deduplicate (shouldn't be necessary but safe)
      const userIds = Array.from(new Set(
        users.map((p: any) => p.uid).filter(Boolean)
      ));

      logger.info('findUsersWithKeyword', {
        keyword: normalizedKeyword,
        matchedCount: userIds.length
      });

      return userIds;
    } catch (error) {
      logger.error('Error finding users with keyword', {
        keyword,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Find users who have ANY of these keywords saved
   * 
   * Used by TaskService.createTask() to emit TASK_CREATED_KEYWORD
   * when task has multiple keywords (title, tags, description).
   * 
   * Applies same cost-control filters as findUsersWithKeyword()
   * 
   * @param keywords - Array of keywords to search for
   * @returns Array of unique user IDs who have ANY matching keyword
   * 
   * Example:
   * const keywords = ['plumbing', 'repair', 'pipes'];
   * const users = await UserMatchingService.findUsersWithAnyKeyword(keywords);
   */
  static async findUsersWithAnyKeyword(keywords: string[]): Promise<string[]> {
    try {
      if (!keywords || keywords.length === 0) {
        logger.warn('findUsersWithAnyKeyword: Empty keywords array');
        return [];
      }

      const Profile = mongoose.connection.collection('profiles');

      // Normalize all keywords: lowercase and trim
      const normalizedKeywords = keywords
        .map(k => k.toLowerCase().trim())
        .filter(k => k.length > 0);

      if (normalizedKeywords.length === 0) {
        return [];
      }

      // Build regex array for OR matching (any keyword)
      const keywordRegexes = normalizedKeywords.map(k => `^${k}$`);
      const pattern = keywordRegexes.join('|'); // Combine with OR

      const users = await Profile.find({
        isActive: true,
        'savedKeywords.keywords': {
          $regex: pattern,
          $options: 'i' // Case-insensitive
        }
      })
        .project({ uid: 1 })
        .toArray();

      // Deduplicate
      const userIds = Array.from(new Set(
        users.map((p: any) => p.uid).filter(Boolean)
      ));

      logger.info('findUsersWithAnyKeyword', {
        keywordCount: keywords.length,
        matchedCount: userIds.length
      });

      return userIds;
    } catch (error) {
      logger.error('Error finding users with any keyword', {
        keywordCount: keywords?.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Helper: Extract all keywords from a task
   * 
   * Used by createTask trigger to find all users who might be interested
   * Extracts from:
   * - Task title
   * - Task tags
   * - Task description (first few words)
   * 
   * @param task - Task document
   * @returns Array of normalized keywords
   */
  static extractKeywordsFromTask(task: any): string[] {
    try {
      const keywords = new Set<string>();

      if (task.title) {
        // Extract words > 3 chars from title
        task.title
          .toLowerCase()
          .split(/\s+/)
          .forEach((word: string) => {
            const clean = word.replace(/[^\w]/g, '').trim();
            if (clean.length >= 3) {
              keywords.add(clean);
            }
          });
      }

      if (Array.isArray(task.tags)) {
        task.tags.forEach((tag: string) => {
          const clean = tag.toLowerCase().trim();
          if (clean.length >= 3) {
            keywords.add(clean);
          }
        });
      }

      if (task.description) {
        // Extract first 5 words from description
        task.description
          .toLowerCase()
          .split(/\s+/)
          .slice(0, 5)
          .forEach((word: string) => {
            const clean = word.replace(/[^\w]/g, '').trim();
            if (clean.length >= 3) {
              keywords.add(clean);
            }
          });
      }

      return Array.from(keywords);
    } catch (error) {
      logger.error('Error extracting keywords from task', {
        taskId: task?._id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }
}
