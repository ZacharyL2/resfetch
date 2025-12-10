import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Error thrown when schema validation fails.
 *
 * @example
 * ```ts
 * const result = await resfetch('/api/users');
 * if (!result.ok && isValidationError(result.error)) {
 *   console.log('Validation failed:', result.error.issues);
 *   console.log('Raw data:', result.error.data);
 * }
 * ```
 */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  /** List of validation issues with details about each failure. */
  issues: readonly StandardSchemaV1.Issue[];

  /** The raw data that failed validation. */
  data: unknown;

  constructor(result: StandardSchemaV1.FailureResult, data: unknown) {
    super(JSON.stringify(result.issues));
    this.issues = result.issues;
    this.data = data;
  }
}

/**
 * Error thrown when a request fails (network error, HTTP error, etc).
 *
 * @example
 * ```ts
 * const result = await resfetch('/api/users');
 * if (!result.ok && isResponseError(result.error)) {
 *   console.log('HTTP status:', result.error.status);
 *   console.log('Response body:', result.error.data);
 * }
 * ```
 */
export class ResponseError extends Error {
  override readonly name = 'ResponseError';

  /** The original Response object, if available. */
  response?: Response;

  /** The original Request object, if available. */
  request?: Request;

  /** The parsed response body, if available. */
  data?: unknown;

  /** The HTTP status code, if available. */
  status?: number;

  /** The original error (for network errors, etc). */
  originalError?: unknown;

  constructor(props: {
    message?: string
    response?: Response
    data?: unknown
    request?: Request
    originalError?: unknown
  }) {
    super(
      props.message ||
      (props.originalError instanceof Error
        ? props.originalError.message
        : ''),
    );
    this.response = props.response;
    this.request = props.request;
    this.data = props.data;
    this.status = props.response?.status;
    this.originalError = props.originalError;

    if (props.originalError instanceof Error && props.originalError.stack) {
      this.stack = props.originalError.stack;
    }
  }
}

/**
 * Check if an error is a ValidationError.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Check if an error is a ResponseError.
 */
export function isResponseError(error: unknown): error is ResponseError {
  return error instanceof ResponseError;
}

// --- ResfetchError Type ---
export type ResfetchError = ValidationError | ResponseError;
