import { Response, NextFunction } from 'express';
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
  // gatewayAuthMiddleware already validated the request and set req.user
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/**
 * Optional auth middleware - allows unauthenticated requests
 * req.user will be set if authenticated, undefined otherwise
 */
export async function optionalAuthMiddleware(
  _req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // gatewayAuthMiddleware already set req.user if authenticated
  // Just pass through - req.user may or may not be set
  next();
}

