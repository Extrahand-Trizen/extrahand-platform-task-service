import PartnerCancellationPass from '../models/PartnerCancellationPass';
import logger from '../config/logger';

const TOTAL_PASSES_PER_MONTH = 3;

export class CancellationPassService {
  /**
   * Get the current month's cancellation pass status for a partner.
   * Auto-resets when a new month starts (query-time reset).
   */
  static async getPassStatus(partnerUid: string): Promise<{
    used: number;
    remaining: number;
    total: number;
    month: number;
    year: number;
  }> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const pass = await PartnerCancellationPass.findOne({
      partnerUid,
      month,
      year,
    }).lean();

    const used = pass?.usedPasses ?? 0;

    return {
      used,
      remaining: Math.max(TOTAL_PASSES_PER_MONTH - used, 0),
      total: TOTAL_PASSES_PER_MONTH,
      month,
      year,
    };
  }

  /**
   * Consume one cancellation pass for the current month.
   * Always succeeds — even if passes are exhausted (informational only).
   * Uses atomic findOneAndUpdate to handle concurrent requests.
   */
  static async consumePass(partnerUid: string): Promise<{
    success: boolean;
    used: number;
    remaining: number;
    total: number;
  }> {
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const pass = await PartnerCancellationPass.findOneAndUpdate(
        {
          partnerUid,
          month,
          year,
        },
        {
          $inc: { usedPasses: 1 },
          $setOnInsert: {
            partnerUid,
            month,
            year,
            totalPasses: TOTAL_PASSES_PER_MONTH,
          },
        },
        {
          new: true,
          upsert: true,
        },
      );

      const used = pass.usedPasses;
      const remaining = Math.max(TOTAL_PASSES_PER_MONTH - used, 0);

      logger.info('[CancellationPassService] Pass consumed', {
        partnerUid,
        month,
        year,
        used,
        remaining,
      });

      return {
        success: true,
        used,
        remaining,
        total: TOTAL_PASSES_PER_MONTH,
      };
    } catch (error: any) {
      logger.error('[CancellationPassService] Failed to consume pass', {
        partnerUid,
        error: error.message,
      });

      // Don't block cancellation on pass tracking failure
      return {
        success: false,
        used: 0,
        remaining: TOTAL_PASSES_PER_MONTH,
        total: TOTAL_PASSES_PER_MONTH,
      };
    }
  }
}
