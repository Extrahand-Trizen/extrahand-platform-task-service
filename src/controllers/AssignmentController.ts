import { Response } from 'express';
import mongoose from 'mongoose';
import { AssignmentService } from '../services/AssignmentService';
import { AuthenticatedRequest } from '../types';
import { BadRequestError } from '../errors/AppError';

export class AssignmentController {
  static async listPending(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = Number(req.query.limit) || 50;
    const page = Number(req.query.page) || 1;
    const data = await AssignmentService.listPendingAssignments(limit, page);
    res.json({ success: true, data });
  }

  static async assignHelper(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { orderId, helperUid, helperProfileId, bookingItemId } = req.body;
    if (!orderId || !helperUid || !helperProfileId) {
      throw new BadRequestError('orderId, helperUid, helperProfileId are required');
    }
    if (!mongoose.Types.ObjectId.isValid(helperProfileId)) {
      throw new BadRequestError('Invalid helperProfileId');
    }

    const data = await AssignmentService.assignHelper({
      orderId,
      helperUid,
      helperProfileId: new mongoose.Types.ObjectId(helperProfileId),
      assignedByUid: user.uid,
      bookingItemId,
    });

    res.json({ success: true, data });
  }
}
