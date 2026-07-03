import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';

/**
 * Auth middleware - extracts user info from API Gateway headers
 * API Gateway has already verified the token, so we just extract the user info
 * Headers set by API Gateway:
 *   - X-User-Id: User's Firebase UID
 *   - X-Profile-Id: User's Profile ObjectId (optional)
 *   - Authorization: Bearer token (for backward compatibility, but not verified here)
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract user ID from X-User-Id header (set by API Gateway)
    const uid = req.headers['x-user-id'] as string;
    
    if (!uid) {
      res.status(401).json({ 
        success: false,
        error: 'Missing X-User-Id header - authentication required' 
      });
      return;
    }
    
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
    
    // Extract token from Authorization header (for backward compatibility)
    const authHeader = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(authHeader);
    const token = match?.[1];
    
    (req as AuthenticatedRequest).user = { 
      uid, 
      token: token as any, // Store token string (not verified - gateway already did that)
      profileId, // ✅ ObjectId reference for database operations
    };
    
    next();
  } catch (e) {
    res.status(401).json({ 
      success: false,
      error: 'Authentication failed' 
    });
    return;
  }
}

/**
 * Optional auth middleware - extracts user info from API Gateway headers if present
 * Used for public routes that can show personalized data if user is authenticated
 * Headers set by API Gateway:
 *   - X-User-Id: User's Firebase UID (optional)
 *   - X-Profile-Id: User's Profile ObjectId (optional)
 *   - Authorization: Bearer token (optional)
 */
export async function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract user ID from X-User-Id header (optional)
    const uid = req.headers['x-user-id'] as string;
    
    if (uid) {
      // Extract profileId from X-Profile-Id header (optional)
      const profileIdHeader = req.headers['x-profile-id'] as string;
      let profileId: mongoose.Types.ObjectId | undefined;
      
      if (profileIdHeader) {
        try {
          profileId = new mongoose.Types.ObjectId(profileIdHeader);
        } catch (error) {
          // Invalid ObjectId format - continue without profileId
        }
      }
      
      // Extract token from Authorization header (optional)
      const authHeader = req.headers.authorization || '';
      const match = /^Bearer (.+)$/.exec(authHeader);
      const token = match?.[1];
      
      (req as AuthenticatedRequest).user = { 
        uid, 
        token: token as any,
        profileId,
      };
    } else {
      // No user info - set to undefined
      (req as AuthenticatedRequest).user = undefined;
    }
    
    next();
  } catch (e) {
    // On error, continue without user info (public route)
    (req as AuthenticatedRequest).user = undefined;
    next();
  }
}

