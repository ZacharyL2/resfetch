import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createResfetch, createSchema } from '../src';
import { isResponseError, isValidationError, ResponseError } from '../src/errors';

/**
 * Real API Tests
 * Test various scenarios for real network requests, including:
 * - Successful requests
 * - HTTP error status codes (404, 401, 500, etc.)
 * - Network errors (domain errors, HTTPS path errors)
 *
 * Run: bun test tests/real-api.test.ts
 * These tests require network connection
 */

// Save original fetch at module load time (before any mock)
const nativeFetch = globalThis.fetch;

// Check if running in CI environment or real API tests are disabled

const shouldSkip =
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SKIP_REAL_API_TESTS === 'true';

describe.skipIf(shouldSkip)('real API request tests', () => {
  // Ensure using original fetch before each test
  beforeEach(() => {
    globalThis.fetch = nativeFetch;
  });

  // JSONPlaceholder API schema
  const todoSchema = createSchema({
    '/todos/:id': {
      method: 'GET',
      params: z.object({
        id: z.number(),
      }),
      response: z.object({
        userId: z.number(),
        id: z.number(),
        title: z.string(),
        completed: z.boolean(),
      }),
    },
    '/todos': {
      method: 'GET',
      response: z.array(
        z.object({
          userId: z.number(),
          id: z.number(),
          title: z.string(),
          completed: z.boolean(),
        }),
      ),
    },
    '/posts/:id': {
      method: 'GET',
      params: z.object({
        id: z.number(),
      }),
      response: z.object({
        userId: z.number(),
        id: z.number(),
        title: z.string(),
        body: z.string(),
      }),
    },
    '/posts': {
      method: 'POST',
      body: z.object({
        title: z.string(),
        body: z.string(),
        userId: z.number(),
      }),
      response: z.object({
        id: z.number(),
        title: z.string(),
        body: z.string(),
        userId: z.number(),
      }),
    },
  });

  describe('successful request tests', () => {
    it('should successfully fetch a single todo', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: todoSchema,
      });

      const result = await fetcher('/todos/:id', {
        params: { id: 1 },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(1);
        expect(result.data.userId).toBeDefined();
        expect(result.data.title).toBeDefined();
        expect(typeof result.data.completed).toBe('boolean');
      }
    });

    it('should successfully fetch todo list', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: todoSchema,
      });

      const result = await fetcher('/todos');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it('should successfully create a post', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: todoSchema,
      });

      const result = await fetcher('/posts', {
        body: {
          title: 'Test Post',
          body: 'This is a test post body',
          userId: 1,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBeDefined();
        expect(result.data.title).toBe('Test Post');
      }
    });
  });

  describe('network error tests', () => {
    // Use request-level schema instead of global schema
    const requestSchema = {
      response: z.any(),
    };

    it('should handle non-existent domain error', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://this-domain-definitely-does-not-exist-12345.com',
      });

      const result = await fetcher('/test', { schema: requestSchema });

      expect(result.ok).toBe(false);
      if (!result.ok && isResponseError(result.error)) {
        expect(result.error).toBeInstanceOf(ResponseError);
        // Network errors typically have no status
        expect(result.error.status).toBeUndefined();
        expect(result.error.message).toBeDefined();
      }
    });

    it('should handle invalid URL format error', async () => {
      const fetcher = createResfetch({
        baseUrl: 'not-a-valid-url',
      });

      const result = await fetcher('/test', { schema: requestSchema });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ResponseError);
      }
    });

    it('should handle HTTPS certificate error (self-signed cert)', async () => {
      // Use a URL known to have certificate issues
      const fetcher = createResfetch({
        baseUrl: 'https://expired.badssl.com',
      });

      const result = await fetcher('/test', { schema: requestSchema });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ResponseError);
      }
    });

    it('should handle connection refused error', async () => {
      // Non-existent port on localhost
      const fetcher = createResfetch({
        baseUrl: 'http://localhost:59999',
      });

      const result = await fetcher('/test', { schema: requestSchema });

      expect(result.ok).toBe(false);
      if (!result.ok && isResponseError(result.error)) {
        expect(result.error).toBeInstanceOf(ResponseError);
        expect(result.error.status).toBeUndefined();
      }
    });
  });

  describe('jsonPlaceholder 404 tests', () => {
    it('should handle request for non-existent resource (very large ID)', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: todoSchema,
      });

      // JSONPlaceholder returns empty object {} for non-existent resources
      // This causes zod validation to fail due to missing required fields
      const result = await fetcher('/todos/:id', {
        params: { id: 999999999 },
      });

      // JSONPlaceholder returns {} instead of 404
      // So this will be a validation error, not ResponseError
      expect(result.ok).toBe(false);
    });
  });

  describe('response data validation tests', () => {
    it('should validate response data format correctness', async () => {
      const strictSchema = createSchema({
        '/todos/:id': {
          method: 'GET',
          params: z.object({
            id: z.number(),
          }),
          response: z.object({
            userId: z.number(),
            id: z.number(),
            title: z.string(),
            completed: z.boolean(),
            // Add a non-existent required field, should cause validation to fail
            nonExistentField: z.string(),
          }),
        },
      });

      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: strictSchema,
      });

      const result = await fetcher('/todos/:id', {
        params: { id: 1 },
      });

      // Validation should fail since response data is missing nonExistentField
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isValidationError(result.error)).toBe(true);
      }
    });
  });

  describe('timeout and abort tests', () => {
    it('should handle request abort via AbortController', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: todoSchema,
      });

      const controller = new AbortController();
      // Abort immediately
      controller.abort();

      const result = await fetcher('/todos', {
        signal: controller.signal,
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isResponseError(result.error)) {
        expect(result.error).toBeInstanceOf(ResponseError);
      }
    });

    it('should handle timeout', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: todoSchema,
        timeout: 1, // 1ms timeout - should always fail
      });

      const result = await fetcher('/todos');

      expect(result.ok).toBe(false);
      if (!result.ok && isResponseError(result.error)) {
        expect(result.error).toBeInstanceOf(ResponseError);
      }
    });
  });

  describe('query parameters tests', () => {
    const querySchema = createSchema({
      '/posts': {
        method: 'GET',
        query: z.object({
          userId: z.number().optional(),
          _limit: z.number().optional(),
        }),
        response: z.array(
          z.object({
            userId: z.number(),
            id: z.number(),
            title: z.string(),
            body: z.string(),
          }),
        ),
      },
      '/comments': {
        method: 'GET',
        query: z.object({
          postId: z.number(),
        }),
        response: z.array(
          z.object({
            postId: z.number(),
            id: z.number(),
            name: z.string(),
            email: z.string(),
            body: z.string(),
          }),
        ),
      },
    });

    it('should handle query parameters correctly', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: querySchema,
      });

      const result = await fetcher('/posts', {
        query: { userId: 1, _limit: 5 },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBeLessThanOrEqual(5);
        expect(result.data.every(post => post.userId === 1)).toBe(true);
      }
    });

    it('should handle required query parameter', async () => {
      const fetcher = createResfetch({
        baseUrl: 'https://jsonplaceholder.typicode.com',
        schema: querySchema,
      });

      const result = await fetcher('/comments', {
        query: { postId: 1 },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.every(comment => comment.postId === 1)).toBe(true);
      }
    });
  });
});
