import 'express';

declare global {
   namespace Express {
      interface Request {
         user?: {
            uid: string;
            sessionId?: string;
            token?: string;
         };
      }
   }
}
