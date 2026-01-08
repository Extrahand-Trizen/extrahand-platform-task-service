/**
 * Task Event Handlers
 * Automatically update profile statistics when task events occur
 * This should be called from the task service after task state changes
 */

import axios from 'axios';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';
const SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || 'your-service-secret';

/**
 * Update profile stats after task completion
 * Call this from task service when task status changes to 'completed'
 */
export async function onTaskCompleted(taskData: {
  assigneeId: string; // Profile MongoDB ObjectId
  requesterId: string; // Profile MongoDB ObjectId
}) {
  try {
    console.log('📊 Updating profile stats after task completion:', taskData);

    // Update stats for both assignee (tasker) and requester (poster)
    const updates = [
      updateProfileStatsByObjectId(taskData.assigneeId),
      updateProfileStatsByObjectId(taskData.requesterId),
    ];

    await Promise.allSettled(updates);
    console.log('✅ Profile stats updated successfully');
  } catch (error) {
    console.error('❌ Failed to update profile stats:', error);
    // Don't throw - stats update failure shouldn't block task completion
  }
}

/**
 * Update profile stats after review is submitted
 * Call this from task service when a review is created
 */
export async function onReviewSubmitted(reviewData: {
  reviewedId: string; // Profile MongoDB ObjectId of person being reviewed
}) {
  try {
    console.log('⭐ Updating profile stats after review submission:', reviewData);
    
    await updateProfileStatsByObjectId(reviewData.reviewedId);
    console.log('✅ Profile stats updated after review');
  } catch (error) {
    console.error('❌ Failed to update profile stats after review:', error);
  }
}

/**
 * Internal helper to update stats using MongoDB ObjectId
 */
async function updateProfileStatsByObjectId(profileId: string) {
  try {
    const response = await axios.post(
      `${USER_SERVICE_URL}/api/v1/profiles/${profileId}/stats/internal/recalculate`,
      {},
      {
        headers: {
          'x-service-auth': SERVICE_AUTH_SECRET,
          'x-service-name': 'task-service',
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error(`Failed to update stats for profile ${profileId}:`, error.message);
    throw error;
  }
}

/**
 * Batch update stats for multiple profiles
 * Useful for migrations or bulk updates
 */
export async function batchUpdateStats(profileIds: string[]) {
  console.log(`📊 Batch updating stats for ${profileIds.length} profiles`);
  
  const results = await Promise.allSettled(
    profileIds.map(id => updateProfileStatsByObjectId(id))
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log(`✅ Batch update complete: ${successful} successful, ${failed} failed`);
  
  return { successful, failed };
}
