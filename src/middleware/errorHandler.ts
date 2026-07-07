import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import logger from '../config/logger';
import { AuthenticatedRequest } from '../types';

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error with full context
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    isAppError: err instanceof AppError
  });

  // Check if headers have already been sent to avoid "Cannot set headers" error
  if (res.headersSent) {
    logger.warn('⚠️ [ErrorHandler] Attempted to send error response but headers already sent', {
      url: req.url,
      method: req.method,
      error: err.message
    });
    return;
  }

  // If it's an AppError, use its status code and message
  if (err instanceof AppError) {
    const statusCode = err.statusCode || 500;
    const errMessage = err.message || 'Internal Server Error';
    
    res.status(statusCode).json({
      success: false,
      error: errMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
    return;
  }

  // Default to 500 for unknown errors
  const statusCode = (err as any).statusCode || 500;
  const errMessage = err.message || 'Internal Server Error';
  
  // Always log the full error for debugging
  logger.error('Unhandled error details:', {
    message: errMessage,
    name: err.name,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  // Return appropriate error message based on error type
  let errorResponse: Record<string, any> = {
    success: false,
    error: 'Internal Server Error'
  };
  
  // In development or for specific errors, include the actual error message
  if (process.env.NODE_ENV === 'development') {
    errorResponse.message = errMessage;
    errorResponse.stack = err.stack;
  } else if (err.name === 'ValidationError' || err.name === 'CastError') {
    // Include helpful message for validation/cast errors even in production
    errorResponse.message = errMessage;
  } else if (errMessage.includes('MONGODB') || errMessage.includes('MongoDB') || errMessage.includes('connect')) {
    // Database connection errors
    errorResponse.message = 'Database connection error. Please try again later.';
  } else {
    errorResponse.message = 'An unexpected error occurred';
  }
  
  res.status(statusCode).json(errorResponse);
}

// Async handler wrapper to catch errors in async route handlers
// Supports both standard Request and AuthenticatedRequest
export function asyncHandler(
  fn: (req: AuthenticatedRequest, res: Response) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res)).catch(next);
  };
}

