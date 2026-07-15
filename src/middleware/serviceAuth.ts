import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import logger from '../config/logger';

export interface ServiceAuthRequest extends Request {
  serviceName?: string;
}

export function serviceAuthMiddleware(
  req: ServiceAuthRequest,
  res: Response,
  next: NextFunction
): void {
  const rawToken = req.headers['x-service-auth'];
  const serviceAuthToken = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const rawName = req.headers['x-service-name'];
  const serviceName = Array.isArray(rawName) ? rawName[0] : rawName;

  const expectedToken = config.SERVICE_AUTH_TOKEN;

  if (!expectedToken) {
    logger.error('SERVICE_AUTH_TOKEN not configured');
    res.status(500).json({
      success: false,
      error: 'Service authentication not configured'
    });
    return;
  }

  if (!serviceAuthToken || serviceAuthToken !== expectedToken) {
    logger.warn('Unauthorized service request', {
      serviceName,
      hasToken: !!serviceAuthToken,
      path: req.path
    });
    res.status(401).json({
      success: false,
      error: 'Unauthorized service request'
    });
    return;
  }

  req.serviceName = serviceName;
  next();
}

