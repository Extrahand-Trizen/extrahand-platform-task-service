import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

export function gatewayAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
   const serviceAuth = req.headers['x-service-auth'];
   const userId =
     (req.headers['x-user-id'] as string | undefined)?.trim() ||
     (typeof req.query.firebaseUid === 'string' ? req.query.firebaseUid.trim() : undefined);
   const profileIdHeader = req.headers['x-profile-id'] as string | undefined;
   const sessionId = req.headers['x-session-id'] as string | undefined;
   
   // Prefer validated config so we stay in sync with serviceAuthMiddleware.
   const expectedToken = process.env.SERVICE_AUTH_TOKEN;
   if (!serviceAuth || !expectedToken || serviceAuth !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
   }
   
   // Extract profileId from X-Profile-Id header if present
   let profileId: mongoose.Types.ObjectId | undefined;
   if (profileIdHeader) {
      try {
         profileId = new mongoose.Types.ObjectId(profileIdHeader);
      } catch (error) {
         // Invalid ObjectId format - continue without profileId
      }
   }
   
   if (userId) {
      (req as any).user = { 
         uid: userId, 
         sessionId,
         profileId, // ✅ ObjectId reference for database operations
      };
   }
   next();
}