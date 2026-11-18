export type ErrorCode =
  | 'VALIDATION_ERROR' | 'URL_NOT_ALLOWED' | 'UNAUTHORIZED' | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN_ORIGIN' | 'NOT_FOUND' | 'EMAIL_TAKEN' | 'MONITOR_LIMIT_REACHED'
  | 'RATE_LIMITED' | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}
