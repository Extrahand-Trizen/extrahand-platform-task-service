import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { CompletionService } from '../services/CompletionService';

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

    // Old format: return with success, message, and data
    res.json({
      success: true,
      message: 'Completion proof submitted. Waiting for poster approval.',
      data: task
    });
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

    // Old format: return with success, message, and data
    res.json({
      success: true,
      message: 'Task completion approved. Payment will be released.',
      data: task
    });
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

    // Old format: return with success, message, and data
    res.json({
      success: true,
      message: 'Completion rejected. Performer can resubmit proof.',
      data: task
    });
  }
}

