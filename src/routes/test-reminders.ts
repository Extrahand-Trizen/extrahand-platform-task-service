import { Router, Request, Response } from 'express';
import { ReminderScheduler } from '../schedulers/ReminderScheduler';
import logger from '../config/logger';
import mongoose from 'mongoose';

const router = Router();

/**
 * POST /api/v1/test/reminders/trigger
 * Manually trigger reminder job for testing
 *
 * SECURITY: This should only be enabled in development
 * or protected with admin authentication
 */
router.post('/trigger', async (_req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'Test endpoints are disabled in production'
      });
    }

    logger.info('Manual reminder trigger requested via API');
    const count = await ReminderScheduler.sendRemindersNow();

    return res.status(200).json({
      success: true,
      message: `Reminder job completed`,
      data: { remindersProcessed: count, timestamp: new Date().toISOString() }
    });
  } catch (error) {
    logger.error('Error in manual reminder trigger', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to trigger reminders',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/v1/test/reset-task-phase
 * DEV ONLY: Reset a task's executionPhase back to 'assigned' and clear startOtp for re-testing.
 * Body: { taskId: string }
 */
router.post('/reset-task-phase', async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, error: 'Disabled in production' });
    }

    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ success: false, error: 'taskId is required' });

    const db = mongoose.connection.db;
    if (!db) return res.status(500).json({ success: false, error: 'DB not connected' });

    const result = await db.collection('tasks').updateOne(
      { _id: new mongoose.Types.ObjectId(taskId) },
      {
        $set: { executionPhase: 'assigned' },
        $unset: { startOtp: '' }
      }
    );

    logger.info(`[DEV] Task ${taskId} reset to executionPhase=assigned. modifiedCount=${result.modifiedCount}`);

    return res.status(200).json({
      success: true,
      message: `Task ${taskId} reset to executionPhase=assigned`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    logger.error('[DEV] Error resetting task phase', {
      error: error instanceof Error ? error.message : 'Unknown'
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
