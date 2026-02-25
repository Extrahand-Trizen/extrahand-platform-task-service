import { Router, Request, Response } from 'express';
import { ReminderScheduler } from '../schedulers/ReminderScheduler';
import logger from '../config/logger';

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
    // Only allow in development
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
      data: {
        remindersProcessed: count,
        timestamp: new Date().toISOString()
      }
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

export default router;
