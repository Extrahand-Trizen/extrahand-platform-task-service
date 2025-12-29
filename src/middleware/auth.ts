import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { auth } from '../config/firebase';
import { AuthenticatedRequest } from '../types';

/**
 * Auth middleware - requires user to be authenticated via gateway
 * gatewayAuthMiddleware must run before this (sets req.user from gateway headers)
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    
    if (!match) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    
    const idToken = match[1];
    const token = await auth.verifyIdToken(idToken);
    
    // Extract profileId from X-Profile-Id header (set by API Gateway)
    const profileIdHeader = req.headers['x-profile-id'] as string;
    let profileId: mongoose.Types.ObjectId | undefined;
    
    if (profileIdHeader) {
      try {
        profileId = new mongoose.Types.ObjectId(profileIdHeader);
      } catch (error) {
        // Invalid ObjectId format - continue without profileId
      }
    }
    
    req.user = { 
      uid: token.uid, 
      token,
      profileId, // ✅ ObjectId reference for database operations
    };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
}

/**
 * Optional auth middleware - allows unauthenticated requests
 * req.user will be set if authenticated, undefined otherwise
 */
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
      
      // Extract profileId from X-Profile-Id header if present
      const profileIdHeader = req.headers['x-profile-id'] as string;
      let profileId: mongoose.Types.ObjectId | undefined;
      
      if (profileIdHeader) {
        try {
          profileId = new mongoose.Types.ObjectId(profileIdHeader);
        } catch (error) {
          // Invalid ObjectId format - continue without profileId
        }
      }
      
      req.user = { 
        uid: token.uid, 
        token,
        profileId,
      };
    } catch (e) {
      req.user = undefined;
    }
  } else {
    req.user = undefined;
  }
  
  next();
}

