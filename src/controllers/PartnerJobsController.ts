import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { PartnerJobsService } from '../services/PartnerJobsService';
import { DispatchService } from '../services/DispatchService';
import { TaskTransitionService } from '../services/TaskTransitionService';
import { BadRequestError } from '../errors/AppError';
import type { PartnerExecutionStatus } from '../types/supply';

export class PartnerJobsController {
  static async listJobs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const tabParam = (req.query.tab as string) || 'offered';
    const validTabs = ['offered', 'upcoming', 'ongoing', 'completed', 'cancelled'] as const;
    if (!validTabs.includes(tabParam as (typeof validTabs)[number])) {
      throw new BadRequestError(`Invalid tab. Must be one of: ${validTabs.join(', ')}`);
    }
    const tab = tabParam as (typeof validTabs)[number];
    const jobs = await PartnerJobsService.listJobs(uid, tab);
    res.json({ success: true, data: jobs });
  }

  static async getJob(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const detail = await PartnerJobsService.getJobDetail(req.params.taskId, uid);
    res.json({ success: true, data: detail });
  }

  static async respond(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const { action, helperProfileId } = req.body;
    if (!action || !['accept', 'decline'].includes(action)) {
      throw new BadRequestError('action must be accept or decline');
    }
    if (action === 'accept' && !helperProfileId) {
      throw new BadRequestError('helperProfileId required for accept');
    }
    if (helperProfileId && !mongoose.Types.ObjectId.isValid(helperProfileId)) {
      throw new BadRequestError('Invalid helperProfileId');
    }

    const result = await DispatchService.respondToOffer({
      taskId: req.params.taskId,
      partnerUid: uid,
      partnerProfileId: helperProfileId || '',
      action,
    });
    res.json({ success: true, data: result });
  }

  static async milestone(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { milestone } = req.body;
    if (!milestone) throw new BadRequestError('milestone required');
    const task = await TaskTransitionService.setPartnerMilestone(
      req.params.taskId,
      milestone as PartnerExecutionStatus,
    );
    res.json({ success: true, data: task });
  }
}
