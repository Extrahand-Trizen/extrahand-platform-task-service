import type { Response } from 'express';
import { BookServicesAssistantService } from '../services/BookServicesAssistantService';
import type { AuthenticatedRequest } from '../types';
import { UnauthorizedError } from '../errors/AppError';

function authenticatedUid(req: AuthenticatedRequest): string {
  const uid = req.user?.uid?.trim();
  if (!uid) throw new UnauthorizedError('Authentication required');
  return uid;
}

export class BookServicesAssistantController {
  static async startConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await BookServicesAssistantService.startConversation(
      authenticatedUid(req),
      req.body,
    );
    res.status(200).json({ success: true, data });
  }

  static async getConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await BookServicesAssistantService.getConversation(
      authenticatedUid(req),
      req.params.conversationId,
    );
    res.json({ success: true, data });
  }

  static async sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await BookServicesAssistantService.sendMessage(
      authenticatedUid(req),
      req.params.conversationId,
      req.body,
    );
    res.json({ success: true, data });
  }

  static async endConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await BookServicesAssistantService.endConversation(
      authenticatedUid(req),
      req.params.conversationId,
    );
    res.json({ success: true, data });
  }
}
