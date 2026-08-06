import { ZodSchema } from 'zod';
import { ValidationError } from '../errors/AppError';

export function parseWithZod<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      })
      .join('; ');
    throw new ValidationError(message || 'Validation Error');
  }
  return result.data;
}
