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
  const serviceAuthToken = req.headers['x-service-auth'] as string;
  const serviceName = req.headers['x-service-name'] as string;

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

