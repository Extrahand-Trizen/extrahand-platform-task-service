import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { MatchService } from '../services/MatchService';
import { ApiResponse } from '../utils/ApiResponse';

export class MatchController {
  /**
   * GET /api/v1/matches/tasks/:taskId/candidates
   * Get candidate matches for a task
   */
  static async getTaskCandidates(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { lat, lng, radiusKm } = req.query;
    const candidates = await MatchService.getTaskCandidates(
      req.params.taskId,
      lat ? parseFloat(lat as string) : undefined,
      lng ? parseFloat(lng as string) : undefined,
      radiusKm ? parseFloat(radiusKm as string) : undefined
    );

    ApiResponse.success(res, candidates, 'Candidates retrieved successfully');
  }
}



