import type { ResponseError, ValidationError } from './errors';
import type { ResfetchResult } from './types';
import { isValidationError } from './errors';

// --- Result Constructors ---
export function ok<T>(data: T): { ok: true, data: T, error?: undefined } {
  return {
    ok: true,
    data,
  };
}

export function err<E>(error: E): { ok: false, error: E, data?: undefined } {
  return {
    ok: false,
    error,
  };
}

/**
 * Handlers for matching ResfetchResult states.
 * @template T - The success data type
 * @template R - The return type of all handlers
 */
export interface MatchHandlers<T, R> {
  /** Called when request succeeded. */
  ok: (data: T) => R
  /** Called when schema validation failed. */
  validationError: (error: ValidationError) => R
  /** Called when request failed (network error, HTTP error, etc). */
  responseError: (error: ResponseError) => R
}

/**
 * Type-safe matching for ResfetchResult, similar to Rust's match
 *
 * @example
 * ```ts
 * const message = matchResfetch(result, {
 *   ok: (data) => `Success: ${data.name}`,
 *   validationError: (error) => `Validation failed: ${error.issues.length} issues`,
 *   responseError: (error) => `Request failed: ${error.status}`,
 * });
 * ```
 */
export function matchResfetch<T, R>(result: ResfetchResult<T>, handlers: MatchHandlers<T, R>): R {
  if (result.ok) {
    return handlers.ok(result.data);
  }
  if (isValidationError(result.error)) {
    return handlers.validationError(result.error);
  }
  return handlers.responseError(result.error);
}
