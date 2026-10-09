import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { BadRequestError } from '../errors/AppError';
import { BookNowRecurringService } from '../services/BookNowRecurringService';
import { BOOK_NOW_RECURRENCE_PATTERNS } from '../recurring-core/types';

const weekdaySchema = z.number().int().min(0).max(6);

const createPlanSchema = z.object({
  items: z.array(z.record(z.unknown())).min(1),
  address: z.object({
    label: z.string().optional(),
    line1: z.string().min(1),
    line2: z.string().optional(),
    area: z.string().optional(),
    city: z.string().min(1),
    state: z.string().optional(),
    pinCode: z.string().min(1),
    coordinates: z.tuple([z.number(), z.number()]).optional(),
  }),
  recurrence: z.object({
    pattern: z.enum(BOOK_NOW_RECURRENCE_PATTERNS),
    selectedWeekdays: z.array(weekdaySchema).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    scheduledTimeStart: z.string().min(1),
    scheduledTimeEnd: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
    fulfillmentType: z.enum(['scheduled', 'instant']).optional(),
  }),
  preferredPartnerId: z.string().optional(),
  notes: z.string().optional(),
  serviceRecipient: z.unknown().optional(),
});

const rescheduleSchema = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTimeStart: z.string().min(1),
  scheduledTimeEnd: z.string().optional(),
  reason: z.string().optional(),
});

function requestIdOf(req: AuthenticatedRequest): string | undefined {
  const raw = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export class BookNowRecurringController {
  static async createPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid || !user.profileId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || 'Invalid recurring plan request');
    }
    const body = parsed.data;
    const result = await BookNowRecurringService.createPlan({
      customerUid: user.uid,
      customerProfileId: user.profileId,
      items: body.items as any,
      address: body.address,
      recurrence: {
        pattern: body.recurrence.pattern,
        selectedWeekdays: body.recurrence.selectedWeekdays,
        startDateKey: body.recurrence.startDate,
        endDateKey: body.recurrence.endDate,
        scheduledTimeStart: body.recurrence.scheduledTimeStart,
        scheduledTimeEnd: body.recurrence.scheduledTimeEnd,
        durationMinutes: body.recurrence.durationMinutes,
        fulfillmentType: body.recurrence.fulfillmentType,
      },
      preferredPartnerId: body.preferredPartnerId,
      notes: body.notes,
      serviceRecipient: body.serviceRecipient,
      requestId: requestIdOf(req),
    });
    res.status(201).json({ success: true, data: result });
  }

  static async listPlans(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const result = await BookNowRecurringService.listPlansForCustomer(user.uid, requestIdOf(req));
    res.json({ success: true, data: result });
  }

  static async getPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const result = await BookNowRecurringService.getPlanForCustomer(
      String(req.params.id),
      user.uid,
      requestIdOf(req),
    );
    res.json({ success: true, data: result });
  }

  static async listVisits(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const result = await BookNowRecurringService.listVisitsForCustomer(
      String(req.params.id),
      user.uid,
      requestIdOf(req),
    );
    res.json({ success: true, data: result });
  }

  static async cancelPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const result = await BookNowRecurringService.cancelPlan(
      String(req.params.id),
      user.uid,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      requestIdOf(req),
    );
    res.json({ success: true, data: result });
  }

  static async cancelVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const result = await BookNowRecurringService.cancelVisit(
      String(req.params.id),
      user.uid,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      requestIdOf(req),
    );
    res.json({ success: true, data: result });
  }

  static async rescheduleVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || 'Invalid reschedule request');
    }
    const result = await BookNowRecurringService.rescheduleVisit(
      String(req.params.id),
      user.uid,
      parsed.data,
      requestIdOf(req),
    );
    res.json({ success: true, data: result });
  }
}
