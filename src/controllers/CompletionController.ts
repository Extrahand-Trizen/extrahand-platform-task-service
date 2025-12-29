import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { CompletionService } from '../services/CompletionService';
import { ApiResponse } from '../utils/ApiResponse';

export class CompletionController {
  /**
   * POST /api/v1/tasks/:taskId/complete
   * Submit completion proof
   */
  static async submitCompletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const task = await CompletionService.submitCompletionProof(
      req.params.taskId,
      req.user!.uid,
      req.body
    );

    ApiResponse.success(res, task, 'Completion proof submitted. Waiting for poster approval.');
  }

  /**
   * POST /api/v1/tasks/:taskId/approve-completion
   * Approve completion
   */
  static async approveCompletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const task = await CompletionService.approveCompletion(
      req.params.taskId,
      req.user!.uid
    );

    ApiResponse.success(res, task, 'Task completion approved. Payment will be released.');
  }

  /**
   * POST /api/v1/tasks/:taskId/reject-completion
   * Reject completion
   */
  static async rejectCompletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const task = await CompletionService.rejectCompletion(
      req.params.taskId,
      req.user!.uid,
      req.body.reason || 'Completion proof not satisfactory'
    );

    ApiResponse.success(res, task, 'Completion rejected. Performer can resubmit proof.');
  }
}

