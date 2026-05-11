export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "internal";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required") {
    super("unauthorized", 401, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super("forbidden", 403, message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super("not_found", 404, message);
  }
}

export class ValidationError extends ApiError {
  constructor(message = "Validation failed", details?: unknown) {
    super("validation_failed", 400, message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict") {
    super("conflict", 409, message);
  }
}
