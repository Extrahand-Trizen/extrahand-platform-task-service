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

    const { orderId, helperUid, helperProfileId, helperName, bookingItemId } = req.body;
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
      helperName,
      assignedByUid: user.uid,
      bookingItemId,
    });

    res.json({ success: true, data });
  }

  static async getOrderIdForTaskAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
    const info = await AssignmentService.findOrderIdForTaskAdmin(req.params.taskId);
    if (!info) {
      res.status(404).json({ success: false, error: 'Booking not found for this task' });
      return;
    }
    res.json({ success: true, data: info });
  }

  static async unassignHelper(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { taskId, escrowId } = req.body;
    if (!taskId) {
      throw new BadRequestError('taskId is required');
    }

    const data = await AssignmentService.unassignHelper({
      taskId,
      escrowId,
      unassignedByUid: user.uid,
    });

    res.json({ success: true, data });
  }

  static async assignHelperDirect(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.uid) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { taskId, helperUid, helperProfileId, helperName } = req.body;
    if (!taskId || !helperUid || !helperProfileId) {
      throw new BadRequestError('taskId, helperUid, and helperProfileId are required');
    }
    if (!mongoose.Types.ObjectId.isValid(helperProfileId)) {
      throw new BadRequestError('Invalid helperProfileId');
    }

    const data = await AssignmentService.assignHelperDirect({
      taskId,
      helperUid,
      helperProfileId,
      helperName,
      assignedByUid: user.uid,
    });

    res.json({ success: true, data });
  }
}
