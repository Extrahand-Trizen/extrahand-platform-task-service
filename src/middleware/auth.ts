import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';
import { AuthenticatedRequest } from '../types';
import { UnauthorizedError } from '../errors/AppError';

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    
    if (!match) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    
    const idToken = match[1];
    const token = await auth.verifyIdToken(idToken);
    req.user = { uid: token.uid, token };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Optional auth middleware - sets req.user if token is present, but doesn't require it
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  
  if (match) {
    try {
      const idToken = match[1];
      const token = await auth.verifyIdToken(idToken);
      req.user = { uid: token.uid, token };
    } catch (e) {
      req.user = undefined;
    }
  } else {
    req.user = undefined;
  }
  
  next();
}

