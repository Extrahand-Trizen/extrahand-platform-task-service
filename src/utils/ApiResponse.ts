import { Response } from 'express';

export interface ApiResponseBody<T> {
  success: boolean;
  code: number;
  message: string;
  data: T | null;
  meta?: Meta;
}

export interface Meta {
  pagination?: PaginationMeta;
  traceId?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Standardized API Response helper class
 * Usage: ApiResponse.success(res, data, 'Message');
 */
export class ApiResponse {
  /**
   * Send a success response (200 OK)
   */
  static success<T>(res: Response, data: T, message = 'Success'): void {
    res.status(200).json({
      success: true,
      code: 200,
      message,
      data,
    } as ApiResponseBody<T>);
  }

  /**
   * Send a created response (201 Created)
   */
  static created<T>(res: Response, data: T, message = 'Created successfully'): void {
    res.status(201).json({
      success: true,
      code: 201,
      message,
      data,
    } as ApiResponseBody<T>);
  }

  /**
   * Send a success response with pagination metadata
   */
  static paginated<T>(res: Response, data: T, message: string, pagination: PaginationMeta): void {
    res.status(200).json({
      success: true,
      code: 200,
      message,
      data,
      meta: { pagination },
    } as ApiResponseBody<T>);
  }

  /**
   * Send a no content response (204)
   */
  static noContent(res: Response): void {
    res.status(204).send();
  }
}