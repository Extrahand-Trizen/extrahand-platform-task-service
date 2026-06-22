import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { TaskService } from '../services/TaskService';

export class RecurringVisitController {
  static async listVisits(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const syncPayments = String(req.query.sync || '').toLowerCase() === 'true';
    const scopeRaw = String(req.query.scope || '').toLowerCase();
    const scope =
      scopeRaw === 'work_details' ? ('work_details' as const) : ('full' as const);

    const data = await RecurringVisitService.listVisits(
      req.params.id,
      req.user!.profileId,
      { syncPayments, scope },
    );

    ApiResponse.success(res, data, 'Recurring visits retrieved');
  }

  static async confirmVisitPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { escrowId } = req.body;
    if (!escrowId || typeof escrowId !== 'string') {
      throw new BadRequestError('escrowId is required');
    }

    const result = await RecurringVisitService.confirmVisitPayment({
      parentTaskId: req.params.id,
      visitId: req.params.visitId,
      escrowId,
      requesterProfileId: req.user!.profileId,
    });

    ApiResponse.success(res, result, 'Visit payment confirmed');
  }

  static async skipVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { reason } = req.body;

    await RecurringVisitService.skipVisit({
      taskId: req.params.id,
      visitId: req.params.visitId,
      requesterProfileId: req.user!.profileId,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { skipped: true }, 'Visit skipped');
  }

  static async cancelVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { reason } = req.body;

    await TaskService.cancelRecurringVisit(
      req.params.id,
      req.params.visitId,
      req.user!.profileId,
      { cancellationReason: typeof reason === 'string' ? reason : undefined },
    );

    ApiResponse.success(res, { cancelled: true }, 'Visit cancelled');
  }

  static async endPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { reason } = req.body;

    await RecurringVisitService.endPlan({
      taskId: req.params.id,
      requesterProfileId: req.user!.profileId,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { ended: true }, 'Recurring plan ended');
  }

  static async resumePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const pendingPayment = await RecurringVisitService.resumePlan({
      taskId: req.params.id,
      requesterProfileId: req.user!.profileId,
    });

    ApiResponse.success(res, { pendingPayment }, 'Recurring plan resumed');
  }

  static async openNextVisitPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const pendingPayment = await RecurringVisitService.openNextVisitPayment({
      taskId: req.params.id,
      requesterProfileId: req.user!.profileId,
    });

    ApiResponse.success(res, { pendingPayment }, 'Next visit opened for payment');
  }

  static async rescheduleVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { newDate, scheduledTimeStart, scheduledTimeEnd, reason } = req.body;
    if (!newDate) {
      throw new BadRequestError('newDate is required');
    }

    await RecurringVisitService.rescheduleVisit({
      taskId: req.params.id,
      visitId: req.params.visitId,
      requesterProfileId: req.user!.profileId,
      newDate: new Date(String(newDate)),
      scheduledTimeStart:
        typeof scheduledTimeStart === 'string' ? scheduledTimeStart : undefined,
      scheduledTimeEnd: typeof scheduledTimeEnd === 'string' ? scheduledTimeEnd : undefined,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { rescheduled: true }, 'Visit rescheduled');
  }

  static async requestVisitCancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { reason } = req.body;

    await RecurringVisitService.requestVisitCancel({
      taskId: req.params.id,
      visitId: req.params.visitId,
      taskerProfileId: req.user!.profileId,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { requested: true }, 'Cancel request submitted');
  }

  static async respondVisitCancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const approved = req.body?.approved === true;

    await RecurringVisitService.respondVisitCancelRequest({
      taskId: req.params.id,
      visitId: req.params.visitId,
      requesterProfileId: req.user!.profileId,
      approved,
    });

    ApiResponse.success(
      res,
      { approved },
      approved ? 'Cancel request approved' : 'Cancel request dismissed',
    );
  }

  static async requestVisitReschedule(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { newDate, scheduledTimeStart, scheduledTimeEnd, reason } = req.body;
    if (!newDate) {
      throw new BadRequestError('newDate is required');
    }

    await RecurringVisitService.requestVisitReschedule({
      taskId: req.params.id,
      visitId: req.params.visitId,
      taskerProfileId: req.user!.profileId,
      newDate: new Date(String(newDate)),
      scheduledTimeStart:
        typeof scheduledTimeStart === 'string' ? scheduledTimeStart : undefined,
      scheduledTimeEnd: typeof scheduledTimeEnd === 'string' ? scheduledTimeEnd : undefined,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { requested: true }, 'Reschedule request submitted');
  }

  static async respondVisitReschedule(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const approved = req.body?.approved === true;

    await RecurringVisitService.respondVisitRescheduleRequest({
      taskId: req.params.id,
      visitId: req.params.visitId,
      requesterProfileId: req.user!.profileId,
      approved,
    });

    ApiResponse.success(
      res,
      { approved },
      approved ? 'Reschedule request approved' : 'Reschedule request rejected',
    );
  }

  static async pausePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { reason } = req.body;

    await RecurringVisitService.pausePlan({
      taskId: req.params.id,
      requesterProfileId: req.user!.profileId,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { paused: true }, 'Recurring plan paused');
  }

  static async leavePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const { reason } = req.body;

    await RecurringVisitService.leavePlanByTasker({
      taskId: req.params.id,
      taskerProfileId: req.user!.profileId,
      reason: typeof reason === 'string' ? reason : undefined,
    });

    ApiResponse.success(res, { left: true }, 'Left recurring plan');
  }

  /** Service-to-service: payment captured for a recurring visit (assign + visit 1 pay). */
  static async visitPaymentCaptured(req: Request, res: Response): Promise<void> {
    const parentTaskId = String(req.body?.parentTaskId || req.body?.taskId || '').trim();
    const visitId = String(req.body?.visitId || '').trim();
    const escrowId = String(req.body?.escrowId || '').trim();

    if (!parentTaskId || !visitId || !escrowId) {
      throw new BadRequestError('parentTaskId, visitId, and escrowId are required');
    }

    const result = await RecurringVisitService.confirmVisitPaymentFromCapture({
      parentTaskId,
      visitId,
      escrowId,
    });

    ApiResponse.success(res, result, 'Recurring visit payment confirmed');
  }
}
