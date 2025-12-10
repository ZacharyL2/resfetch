import type { ResfetchResult } from '../src';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';

import {
  createResfetch,
  isResponseError,
  isValidationError,
  matchResfetch,
  ResponseError,
  ValidationError,
} from '../src';
import { enhance } from '../src/enhance';
import { fallbackOptions } from '../src/fallback-options';
import { err, ok } from '../src/result';
import {
  abortableDelay,
  isSerializable,
  mergeHeaders,
  omit,
  replacePathParams,
  resolveUrl,
  validate,
  withTimeout,
} from '../src/utils';

// Save original fetch
const originalFetch = globalThis.fetch;

// Mock data
class NonJsonifiable {
  a: number;
  constructor() {
    this.a = 1;
  }
}

class Jsonifiable {
  toJSON() {
    return { z: 26 };
  }
}

const bodyMock = {
  classJsonifiable: new Jsonifiable(),
  classNonJsonifiable: new NonJsonifiable(),
  blob: new Blob([JSON.stringify({ hello: 'world' }, null, 2)], {
    type: 'application/json',
  }),
  buffer: new ArrayBuffer(8),
  formData: (() => {
    const fd = new FormData();
    fd.append('username', 'me');
    return fd;
  })(),
  typedArray: new Int32Array(new ArrayBuffer(8)),
  dataview: (() => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setInt16(0, 256, true);
    return dv;
  })(),
  getStream: () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue('This ');
        controller.enqueue('is ');
        controller.enqueue('a ');
        controller.enqueue('slow ');
        controller.enqueue('request.');
        controller.close();
      },
    }).pipeThrough(new TextEncoderStream()),
  urlSearchParams: new URLSearchParams('a=1&b=2'),
};

// ============================================================================
// utils module tests
// ============================================================================
describe('utils module tests', () => {
  describe('mergeHeaders', () => {
    it('should merge multiple headers', () => {
      const result = mergeHeaders([
        { 'Content-Type': 'application/json' },
        { Authorization: 'Bearer token' },
      ]);
      expect(result['content-type']).toBe('application/json');
      expect(result.authorization).toBe('Bearer token');
    });

    it('should remove headers with null or undefined values', () => {
      const result = mergeHeaders([
        { 'Content-Type': 'application/json', 'X-Remove': 'null' },
      ]);
      expect(result['x-remove']).toBeUndefined();
    });

    it('should handle undefined input', () => {
      const result = mergeHeaders([
        undefined,
        { 'Content-Type': 'text/plain' },
      ]);
      expect(result['content-type']).toBe('text/plain');
    });
  });

  describe('withTimeout', () => {
    it('should return AbortSignal with timeout', () => {
      const signal = withTimeout(undefined, 1000);
      expect(signal).toBeDefined();
    });

    it('should return a signal when no timeout', () => {
      const original = new AbortController().signal;
      const result = withTimeout(original, undefined);
      expect(result).toBeDefined();
      expect(result?.aborted).toBe(false);
    });

    it('should combine signal and timeout', () => {
      const original = new AbortController().signal;
      const result = withTimeout(original, 1000);
      expect(result).toBeDefined();
    });
  });

  describe('omit', () => {
    it('should remove specified keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const result = omit(obj, ['b']);
      expect(result).toEqual({ a: 1, c: 3 });
    });

    it('should handle empty object', () => {
      const result = omit({}, ['a']);
      expect(result).toEqual({});
    });

    it('should handle undefined object', () => {
      const result = omit(undefined, ['a']);
      expect(result).toEqual({});
    });
  });

  describe('isSerializable', () => {
    it('should identify plain objects', () => {
      expect(isSerializable({ a: 1 })).toBe(true);
    });

    it('should identify arrays', () => {
      expect(isSerializable([1, 2, 3])).toBe(true);
    });

    it('should identify objects with toJSON method', () => {
      const obj = { toJSON: () => ({}) };
      expect(isSerializable(obj)).toBe(true);
    });

    it('should reject primitive values', () => {
      expect(isSerializable('string')).toBe(false);
      expect(isSerializable(123)).toBe(false);
      expect(isSerializable(null)).toBe(false);
    });

    it('should reject special objects without toJSON', () => {
      expect(isSerializable(new Date())).toBe(true); // Date has toJSON
      expect(isSerializable(new Map())).toBe(false);
    });
  });

  describe('resolveUrl', () => {
    const serializeParams = (params: Record<string, unknown>) =>
      new URLSearchParams(
        params as Record<string, string>,
      ).toString();

    it('should resolve complete URL', () => {
      const result = resolveUrl(
        'https://api.example.com',
        '/users',
        undefined,
        undefined,
        serializeParams,
      );
      expect(result).toBe('https://api.example.com/users');
    });

    it('should add query parameters', () => {
      const result = resolveUrl(
        'https://api.example.com',
        '/users',
        undefined,
        { page: '1' },
        serializeParams,
      );
      expect(result).toBe('https://api.example.com/users?page=1');
    });

    it('should handle URL with existing query parameters', () => {
      const result = resolveUrl(
        'https://api.example.com',
        '/users?existing=true',
        undefined,
        { page: '1' },
        serializeParams,
      );
      expect(result).toContain('existing=true');
      expect(result).toContain('page=1');
    });

    it('should handle absolute URL', () => {
      const result = resolveUrl(
        'https://api.example.com',
        'https://other.com/path',
        undefined,
        undefined,
        serializeParams,
      );
      expect(result).toBe('https://other.com/path');
    });

    it('should handle empty base and input', () => {
      const result = resolveUrl(
        '',
        '',
        undefined,
        undefined,
        serializeParams,
      );
      expect(result).toBe('');
    });
  });

  describe('abortableDelay', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now();
      await abortableDelay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('should reject when signal is aborted', async () => {
      const controller = new AbortController();
      const promise = abortableDelay(1000, controller.signal);

      setTimeout(() => controller.abort(new Error('Aborted')), 10);

      await expect(promise).rejects.toThrow('Aborted');
    });
  });

  describe('validate', () => {
    it('should validate passing data', async () => {
      const schema = z.object({ name: z.string() });
      const result = await validate(schema, { name: 'test' });
      expect(result).toEqual({ name: 'test' });
    });

    it('should throw ValidationError for invalid data', async () => {
      const schema = z.object({ name: z.string() });
      // @ts-expect-error - intentionally passing invalid type to test validation
      await expect(validate(schema, { name: 123 })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('replacePathParams', () => {
    it('should replace path parameters', () => {
      const result = replacePathParams('/user/:id', { id: '123' });
      expect(result).toBe('/user/123');
    });

    it('should replace multiple parameters', () => {
      const result = replacePathParams('/user/:id/post/:postId', {
        id: '1',
        postId: 'abc',
      });
      expect(result).toBe('/user/1/post/abc');
    });

    it('should ignore undefined and null values', () => {
      const result = replacePathParams('/user/:id', {
        id: undefined,
        other: null,
      });
      expect(result).toBe('/user/:id');
    });

    it('should return original path when no params', () => {
      const result = replacePathParams('/users');
      expect(result).toBe('/users');
    });
  });
});

// ============================================================================
// errors module tests
// ============================================================================
describe('errors module tests', () => {
  describe('validationError', () => {
    it('should create ValidationError', () => {
      const error = new ValidationError(
        { issues: [{ message: 'Invalid' }] },
        { name: 123 },
      );
      expect(error.name).toBe('ValidationError');
      expect(error.issues).toHaveLength(1);
      expect(error.data).toEqual({ name: 123 });
    });

    it('isValidationError should correctly identify ValidationError', () => {
      expect(isValidationError(new ValidationError({ issues: [] }, {}))).toBe(true);
      expect(isValidationError(new Error())).toBe(false);
      expect(isValidationError(null)).toBe(false);
      expect(isValidationError(undefined)).toBe(false);
      expect(isValidationError('error')).toBe(false);
    });
  });

  describe('responseError', () => {
    it('should create ResponseError', () => {
      const response = new Response('Error', { status: 500 });
      const error = new ResponseError({
        message: 'Server Error',
        response,
        data: { code: 'ERROR' },
      });
      expect(error.name).toBe('ResponseError');
      expect(error.status).toBe(500);
      expect(error.data).toEqual({ code: 'ERROR' });
    });

    it('should inherit stack from originalError', () => {
      const originalError = new Error('Original');
      const error = new ResponseError({ originalError });
      expect(error.stack).toBe(originalError.stack);
    });

    it('should use default message when no message and originalError', () => {
      const error = new ResponseError({});
      expect(error.message).toBe('');
    });

    it('should not override stack when originalError has no stack', () => {
      const originalError = { message: 'No stack' };
      const error = new ResponseError({
        originalError: originalError as Error,
      });
      expect(error.stack).toBeDefined();
    });

    it('isResponseError should correctly identify ResponseError', () => {
      expect(isResponseError(new ResponseError({ message: 'Error' }))).toBe(true);
      expect(isResponseError(new Error())).toBe(false);
      expect(isResponseError(null)).toBe(false);
      expect(isResponseError(undefined)).toBe(false);
    });
  });
});

// ============================================================================
// result type and ok/err function tests
// ============================================================================
describe('result type and ok/err function tests', () => {
  it('ok should create success result', () => {
    const result = ok({ id: 1 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: 1 });
  });

  it('err should create error result', () => {
    const error = new Error('Failed');
    const result = err(error);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
  });
});

// ============================================================================
// matchResfetch function tests
// ============================================================================
describe('matchResfetch function tests', () => {
  it('should match success result', () => {
    const result: ResfetchResult<{ id: number }> = {
      ok: true,
      data: { id: 1 },
    };

    const output = matchResfetch(result, {
      ok: data => `Success: ${data.id}`,
      validationError: error => `Validation: ${error.issues.length}`,
      responseError: error =>
        `Response: ${isResponseError(error) ? error.status : 'unknown'}`,
    });

    expect(output).toBe('Success: 1');
  });

  it('should match ValidationError', () => {
    const validationError = new ValidationError(
      { issues: [{ message: 'Required' }] },
      { name: '' },
    );
    const result: ResfetchResult<unknown> = {
      ok: false,
      error: validationError,
    };

    const output = matchResfetch(result, {
      ok: () => 'ok',
      validationError: error =>
        `Validation: ${error.issues.length} issues`,
      responseError: () => 'response',
    });

    expect(output).toBe('Validation: 1 issues');
  });

  it('should match ResponseError', () => {
    const responseError = new ResponseError({
      message: 'Not Found',
      response: new Response('', { status: 404 }),
    });
    const result: ResfetchResult<unknown> = {
      ok: false,
      error: responseError,
    };

    const output = matchResfetch(result, {
      ok: () => 'ok',
      validationError: () => 'validation',
      responseError: error =>
        `Response: ${isResponseError(error) ? error.status : 'unknown'}`,
    });

    expect(output).toBe('Response: 404');
  });
});

// ============================================================================
// fallbackOptions tests
// ============================================================================
describe('fallbackOptions tests', () => {
  describe('parseResponse', () => {
    it('should parse JSON response', async () => {
      const response = new Response(JSON.stringify({ id: 1 }));
      const result = await fallbackOptions.parseResponse(
        response,
        new Request('https://example.com'),
      );
      expect(result).toEqual({ id: 1 });
    });

    it('should fallback to text response', async () => {
      const response = new Response('plain text');
      const result = await fallbackOptions.parseResponse(
        response,
        new Request('https://example.com'),
      );
      expect(result).toBe('plain text');
    });

    it('should return null for empty response', async () => {
      const response = new Response('');
      const result = await fallbackOptions.parseResponse(
        response,
        new Request('https://example.com'),
      );
      expect(result).toBeNull();
    });

    it('should return null when response is undefined', async () => {
      const result = await fallbackOptions.parseResponse(
        undefined,
        new Request('https://example.com'),
      );
      expect(result).toBeNull();
    });
  });

  describe('parseRejected', () => {
    it('should create ResponseError', async () => {
      const response = new Response('Error', { status: 400 });
      const result = (await fallbackOptions.parseRejected(
        response,
        new Request('https://example.com'),
      )) as ResponseError;
      expect(result).toBeInstanceOf(ResponseError);
      expect(result.status).toBe(400);
    });

    it('should parse JSON error response', async () => {
      const response = new Response(
        JSON.stringify({ error: 'bad' }),
        {
          status: 400,
        },
      );
      const result = (await fallbackOptions.parseRejected(
        response,
        new Request('https://example.com'),
      )) as ResponseError;
      expect(result.data).toEqual({ error: 'bad' });
    });

    it('should parse TEXT error response', async () => {
      const response = new Response('some error text', {
        status: 400,
      });
      const result = (await fallbackOptions.parseRejected(
        response,
        new Request('https://example.com'),
      )) as ResponseError;
      expect(result.data).toBe('some error text');
    });

    it('should handle undefined response', async () => {
      const result = (await fallbackOptions.parseRejected(
        undefined,
        new Request('https://example.com'),
      )) as ResponseError;
      expect(result).toBeInstanceOf(ResponseError);
      expect(result.message).toBe('');
    });
  });

  describe('serializeParams', () => {
    it('should serialize params', () => {
      const result = fallbackOptions.serializeParams({
        a: '1',
        b: '2',
      });
      expect(result).toContain('a=1');
      expect(result).toContain('b=2');
    });
  });

  describe('serializeBody', () => {
    it('should serialize JSON object', () => {
      const result = fallbackOptions.serializeBody({ name: 'test' });
      expect(result).toBe('{"name":"test"}');
    });

    it('should return FormData directly without serialization', () => {
      const formData = new FormData();
      formData.append('test', 'value');
      const result = fallbackOptions.serializeBody(formData);
      expect(result).toBe(formData);
    });

    it('should keep non-JSON body unchanged', () => {
      const blob = new Blob(['test']);
      const result = fallbackOptions.serializeBody(blob);
      expect(result).toBe(blob);
    });
  });

  describe('reject', () => {
    it('should return true for non-ok response', () => {
      expect(
        fallbackOptions.reject(new Response('', { status: 400 })),
      ).toBe(true);
      expect(
        fallbackOptions.reject(new Response('', { status: 200 })),
      ).toBe(false);
    });
  });

  describe('retry', () => {
    it('default retry.when should return true for non-ok response', () => {
      expect(
        fallbackOptions.retry.when({
          request: new Request('https://example.com'),
          response: new Response('', { status: 500 }),
          error: undefined,
        }),
      ).toBe(true);
    });
  });
});

// ============================================================================
// enhance module core tests
// ============================================================================
describe('enhance module tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should use default empty options when no getDefaultOptions', async () => {
    globalThis.fetch = async () => Response.json({ success: true });

    const enhancedFetch = enhance(fetch);
    const result = await enhancedFetch('https://api.example.com/test');
    expect(result).toEqual({ success: true });
  });

  it('should support Request object as input', async () => {
    globalThis.fetch = async () => Response.json({ success: true });

    const enhancedFetch = enhance(fetch);
    const request = new Request('https://api.example.com/test');

    const result = await enhancedFetch(request);
    expect(result).toEqual({ success: true });
  });
});

// ============================================================================
// params related tests
// ============================================================================
describe('params tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should merge defaultOptions.params and fetcherOptions.params', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl =
        input instanceof Request
          ? input.url
          : new URL(input).toString();
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      params: { default: 'value' },
    }));

    await enhancedFetch('/', { params: { fetcher: 'param' } });

    expect(capturedUrl).toContain('default=value');
    expect(capturedUrl).toContain('fetcher=param');
  });

  it('should support removing params by setting undefined', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl =
        input instanceof Request
          ? input.url
          : new URL(input).toString();
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      params: { keep: 'value', remove: 'me' },
    }));

    await enhancedFetch('/', { params: { remove: undefined } });

    expect(capturedUrl).toContain('keep=value');
    expect(capturedUrl).not.toContain('remove=');
  });

  it('should allow fetcherOptions.serializeParams to override defaultOptions.serializeParams', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl =
        input instanceof Request
          ? input.url
          : new URL(input).toString();
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      serializeParams: () => 'from=default',
    }));

    await enhancedFetch('/', {
      params: { a: 1 },
      serializeParams: () => 'from=fetcher',
    });

    expect(capturedUrl).toContain('from=fetcher');
  });
});

// ============================================================================
// headers related tests
// ============================================================================
describe('headers tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('should auto-set content-type to application/json', () => {
    it.each([
      { body: {}, expected: true },
      { body: { a: 1 }, expected: true },
      { body: [1, 2], expected: true },
      { body: bodyMock.classJsonifiable, expected: true },
      { body: bodyMock.classNonJsonifiable, expected: false },
      { body: bodyMock.buffer, expected: false },
      { body: bodyMock.blob, expected: false },
      { body: bodyMock.formData, expected: false },
      { body: '', expected: false },
      { body: undefined, expected: false },
      { body: null, expected: false },
    ])(
      'body=$body => hasJsonHeader=$expected',
      async ({ body, expected }) => {
        let capturedContentType: string | null = null;
        globalThis.fetch = async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => {
          const req =
            input instanceof Request
              ? input
              : new Request(input, init);
          capturedContentType = req.headers.get('content-type');
          return Response.json({ success: true });
        };

        const enhancedFetch = enhance(fetch, () => ({
          baseUrl: 'https://example.com',
          method: 'POST',
          // eslint-disable-next-line ts/no-explicit-any
          serializeBody: (b: any) => JSON.stringify(b),
        }));

        // eslint-disable-next-line ts/no-explicit-any
        await enhancedFetch('/', { body } as any);

        expect(capturedContentType === 'application/json').toBe(
          expected,
        );
      },
    );
  });

  it('should merge defaultOptions.headers and fetcherOptions.headers', async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const req =
        input instanceof Request ? input : new Request(input, init);
      capturedHeaders = req.headers;
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      headers: { 'x-default': 'value' },
    }));

    await enhancedFetch('https://example.com', {
      headers: { 'x-fetcher': 'value' },
      method: 'POST',
    });

    expect(capturedHeaders!.get('x-default')).toBe('value');
    expect(capturedHeaders!.get('x-fetcher')).toBe('value');
  });

  it('should support removing header by setting undefined', async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const req =
        input instanceof Request ? input : new Request(input, init);
      capturedHeaders = req.headers;
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      headers: { 'content-type': 'text/html' },
      method: 'POST',
    }));

    await enhancedFetch('/', { headers: { 'content-type': undefined } });

    expect(capturedHeaders!.get('content-type')).toBeNull();
  });

  it('should preserve already set content-type', async () => {
    let capturedContentType: string | null = null;
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const req =
        input instanceof Request ? input : new Request(input, init);
      capturedContentType = req.headers.get('content-type');
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      headers: { 'content-type': 'text/html' },
      method: 'POST',
    }));

    await enhancedFetch('/', { body: { a: 1 } });

    expect(capturedContentType).toBe('text/html');
  });
});

// ============================================================================
// body related tests
// ============================================================================
describe('body tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should ignore body in defaultOptions', async () => {
    let capturedBody = '';
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const req =
        input instanceof Request ? input : new Request(input, init);
      capturedBody = await req.text();
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(
      fetch,
      () =>
        ({
          baseUrl: 'https://example.com',
          method: 'POST',
          body: 'default body', // should be ignored (up-fetch design ignores body in defaultOptions)
          // eslint-disable-next-line ts/no-explicit-any
        }) as any,
    );

    await enhancedFetch('/');
    expect(capturedBody).toBe('');

    // String is not isSerializable, so it's passed directly without JSON.stringify
    // Use object body to test serialization
    await enhancedFetch('/', { body: { message: 'fetcher body' } });
    expect(capturedBody).toBe('{"message":"fetcher body"}');
  });

  it('should allow fetcherOptions.serializeBody to override defaultOptions.serializeBody', async () => {
    let capturedBody = '';
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const req =
        input instanceof Request ? input : new Request(input, init);
      capturedBody = await req.text();
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      serializeBody: () => 'from=default',
    }));

    await enhancedFetch('/', {
      body: { a: 1 },
      method: 'POST',
      serializeBody: () => 'from=fetcher',
    });

    expect(capturedBody).toBe('from=fetcher');
  });
});

// ============================================================================
// reject related tests
// ============================================================================
describe('reject tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should throw ResponseError when response.ok is false by default', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 400 });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
    }));

    await expect(enhancedFetch('/')).rejects.toThrow();
  });

  it('should not throw error when reject returns false', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 400 });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
      reject: () => false,
    }));

    const result = await enhancedFetch('/');
    expect(result).toBe('Error');
  });

  it('reject should execute before parseRejected', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 400 });

    let order = 0;
    let rejectOrder = 0;
    let parseRejectedOrder = 0;

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
      reject: () => {
        rejectOrder = ++order;
        return true;
      },
      parseRejected: async (res) => {
        parseRejectedOrder = ++order;
        return res;
      },
    }));

    await enhancedFetch('/').catch(() => {});

    expect(rejectOrder).toBe(1);
    expect(parseRejectedOrder).toBe(2);
  });

  it('should support async reject function', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 400 });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
      reject: async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return true;
      },
    }));

    await expect(enhancedFetch('/')).rejects.toThrow();
  });
});

// ============================================================================
// retry related tests
// ============================================================================
describe('retry tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should retry on failure', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 3) {
        return new Response('Error', { status: 500 });
      }
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      retry: {
        attempts: 3,
        delay: 1, // use very small delay
        when: ({ response }) => response?.ok === false,
      },
    }));

    const result = await enhancedFetch('https://example.com/test');
    expect(result).toEqual({ success: true });
    expect(attempts).toBe(3);
  });

  it('should retry on network error', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Network error');
      }
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      retry: {
        attempts: 2,
        delay: 1,
        when: ({ error }) => !!error,
      },
    }));

    const result = await enhancedFetch('https://example.com/test');
    expect(result).toEqual({ success: true });
    expect(attempts).toBe(2);
  });

  it('should not call attempts or delay when retry.when returns false', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 500 });

    const attemptsSpy = vi.fn();
    const delaySpy = vi.fn();

    const enhancedFetch = enhance(fetch, () => ({
      reject: () => false,
      retry: {
        when: () => false,
        attempts: attemptsSpy,
        delay: () => {
          delaySpy();
          return 0;
        },
      },
    }));

    await enhancedFetch('https://example.com/');

    expect(attemptsSpy).not.toHaveBeenCalled();
    expect(delaySpy).not.toHaveBeenCalled();
  });

  it('should not call delay when retry.attempts returns 0', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 500 });

    const delaySpy = vi.fn();

    const enhancedFetch = enhance(fetch, () => ({
      reject: () => false,
      retry: {
        when: () => true,
        attempts: () => 0,
        delay: () => {
          delaySpy();
          return 0;
        },
      },
    }));

    await enhancedFetch('https://example.com/');

    expect(delaySpy).not.toHaveBeenCalled();
  });

  it('should call onRetry callback', async () => {
    let retryCount = 0;
    globalThis.fetch = async () => {
      if (retryCount < 1) {
        return new Response('Error', { status: 500 });
      }
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      retry: {
        attempts: 2,
        delay: 1,
        when: ({ response }) => response?.ok === false,
      },
      onRetry: () => {
        retryCount++;
      },
    }));

    await enhancedFetch('https://example.com/test');
    expect(retryCount).toBe(1);
  });

  it('should support function form of retry.attempts', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 3) {
        return new Response('Error', { status: 500 });
      }
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      retry: {
        attempts: () => 3,
        delay: 1,
        when: ({ response }) => response?.ok === false,
      },
    }));

    const result = await enhancedFetch('https://example.com/test');
    expect(result).toEqual({ success: true });
  });

  it('should support function form of retry.delay', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 2) {
        return new Response('Error', { status: 500 });
      }
      return Response.json({ success: true });
    };

    const enhancedFetch = enhance(fetch, () => ({
      retry: {
        attempts: 2,
        delay: ({ attempt }) => attempt * 1,
        when: ({ response }) => response?.ok === false,
      },
    }));

    await enhancedFetch('https://example.com/test');
  });

  it('should stop when aborted during retry delay', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return new Response('Error', { status: 500 });
    };

    const controller = new AbortController();

    const enhancedFetch = enhance(fetch, () => ({
      retry: {
        attempts: 5,
        delay: 100,
        when: ({ response }) => response?.ok === false,
      },
    }));

    const promise = enhancedFetch('https://example.com/test', {
      signal: controller.signal,
    });

    // Abort immediately after first request completes
    setTimeout(
      () => controller.abort(new Error('User cancelled')),
      10,
    );

    await expect(promise).rejects.toThrow();
    expect(attempts).toBeLessThan(5);
  });

  it('should allow fetcherOptions.retry to override defaultOptions.retry', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return new Response('Error', { status: 500 });
    };

    const enhancedFetch = enhance(fetch, () => ({
      reject: () => false,
      retry: {
        when: () => true,
        delay: 1,
        attempts: 1,
      },
    }));

    await enhancedFetch('https://example.com/', {
      retry: { attempts: 2 },
    });

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it('should handle retry.attempts function execution error', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 500 });

    const enhancedFetch = enhance(fetch, () => ({
      reject: () => false,
      retry: {
        when: () => true,
        delay: 1,
        attempts: () => {
          throw new Error('attempts error');
        },
      },
    }));

    await expect(enhancedFetch('https://example.com/')).rejects.toThrow(
      'attempts error',
    );
  });

  it('should handle retry.delay function execution error', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 500 });

    const enhancedFetch = enhance(fetch, () => ({
      reject: () => false,
      retry: {
        when: () => true,
        attempts: 1,
        delay: () => {
          throw new Error('delay error');
        },
      },
    }));

    await expect(enhancedFetch('https://example.com/')).rejects.toThrow(
      'delay error',
    );
  });

  it('should clear error state after successful request', async () => {
    globalThis.fetch = async () => Response.json({ success: true });

    let exec = 0;

    const enhancedFetch = enhance(fetch, () => ({}));

    await enhancedFetch('https://example.com/', {
      onRequest() {
        if (++exec === 1) {
          throw new Error('Generate an error for the first retry');
        }
      },
      retry: {
        when({ error, response }) {
          return !!error || !response?.ok;
        },
        attempts: 3,
        delay: 1,
      },
    });

    expect(exec).toBe(2);
  });
});

// ============================================================================
// timeout related tests
// ============================================================================
describe('timeout tests', () => {
  const majorNodeVersion = Number(
    // eslint-disable-next-line ts/no-explicit-any
    ((globalThis as any).process?.version || 'v20')
      .replace('v', '')
      .split('.')[0],
  );

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should not crash', async () => {
    globalThis.fetch = async () => Response.json({ success: true });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      timeout: 1,
    }));

    await enhancedFetch('/');
  });

  if (majorNodeVersion >= 20) {
    it('should apply defaultOptions.timeout', async () => {
      globalThis.fetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        // Check if signal is aborted
        if (init?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        // Wait until aborted or timeout
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
        return Response.json({ success: true });
      };

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        timeout: 10,
      }));

      await expect(enhancedFetch('/')).rejects.toThrow();
    });

    it('should maintain functionality with both timeout and signal', async () => {
      globalThis.fetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        if (init?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
        return Response.json({ success: true });
      };

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        timeout: 10,
      }));

      await expect(
        enhancedFetch('/', { signal: new AbortController().signal }),
      ).rejects.toThrow();
    });

    it('signal.abort should still work when timeout exists', async () => {
      globalThis.fetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        if (init?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
        return Response.json({ success: true });
      };

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        timeout: 9000,
      }));

      const controller = new AbortController();
      const promise = enhancedFetch('/', { signal: controller.signal });
      controller.abort();

      await expect(promise).rejects.toThrow();
    });
  }
});

// ============================================================================
// lifecycle callback tests
// ============================================================================
describe('lifecycle callback tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('onRequest', () => {
    it('should call onRequest callback', async () => {
      globalThis.fetch = async () => Response.json({ success: true });

      let order = 0;
      let defaultOrder = 0;
      let fetcherOrder = 0;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onRequest() {
          defaultOrder = ++order;
        },
      }));

      await enhancedFetch('/', {
        onRequest() {
          fetcherOrder = ++order;
        },
      });

      expect(defaultOrder).toBe(1);
      expect(fetcherOrder).toBe(2);
    });

    it('should provide request object to onRequest', async () => {
      globalThis.fetch = async () => Response.json({ success: true });

      let capturedUrl = '';

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onRequest(request) {
          capturedUrl = request.url;
        },
      }));

      await enhancedFetch('/test');

      expect(capturedUrl).toBe('https://example.com/test');
    });

    it('should process async onRequest in order', async () => {
      let capturedHeaders: Headers | undefined;
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const req =
          input instanceof Request ? input : new Request(input, init);
        capturedHeaders = req.headers;
        return Response.json({ success: true });
      };

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        async onRequest(request) {
          await new Promise(resolve => setTimeout(resolve, 10));
          request.headers.set('x-test-1', 'test-1');
        },
      }));

      await enhancedFetch('/', {
        async onRequest(request) {
          expect(request.headers.get('x-test-1')).toBe('test-1');
          await new Promise(resolve => setTimeout(resolve, 5));
          request.headers.set('x-test-2', 'test-2');
        },
      });

      expect(capturedHeaders!.get('x-test-1')).toBe('test-1');
      expect(capturedHeaders!.get('x-test-2')).toBe('test-2');
    });
  });

  describe('onResponse', () => {
    it('should call onResponse before parseResponse', async () => {
      globalThis.fetch = async () => Response.json({ success: true });

      let order = 0;
      let onResponseOrder = 0;
      let parseResponseOrder = 0;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onResponse() {
          onResponseOrder = ++order;
        },
      }));

      await enhancedFetch('/', {
        onResponse() {
          // fetcher onResponse
        },
        parseResponse(response) {
          parseResponseOrder = ++order;
          return response?.json() ?? null;
        },
      });

      expect(onResponseOrder).toBe(1);
      expect(parseResponseOrder).toBe(2);
    });

    it('should execute only once after all retries', async () => {
      let fetchCount = 0;
      globalThis.fetch = async () => {
        fetchCount++;
        return Response.json({ success: true });
      };

      let onResponseCount = 0;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        retry: { attempts: 3, when: () => true },
        onResponse() {
          onResponseCount++;
        },
      }));

      await enhancedFetch('/');

      expect(fetchCount).toBe(4); // 1 initial + 3 retries
      expect(onResponseCount).toBe(1);
    });
  });

  describe('onSuccess', () => {
    it('should call onSuccess on success', async () => {
      globalThis.fetch = async () => Response.json({ success: true });

      let order = 0;
      let defaultOrder = 0;
      let fetcherOrder = 0;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onSuccess() {
          defaultOrder = ++order;
        },
      }));

      await enhancedFetch('/', {
        onSuccess() {
          fetcherOrder = ++order;
        },
      });

      expect(defaultOrder).toBe(1);
      expect(fetcherOrder).toBe(2);
    });

    it('should provide validated data and request to onSuccess', async () => {
      globalThis.fetch = async () =>
        Response.json({ hello: 'world' });

      let capturedData: unknown;
      let capturedUrl = '';

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onSuccess(data, request) {
          capturedData = data;
          capturedUrl = request.url;
        },
      }));

      await enhancedFetch('/');

      expect(capturedData).toEqual({ hello: 'world' });
      expect(capturedUrl).toBe('https://example.com/');
    });

    it('should not call onSuccess when parseResponse throws error', async () => {
      globalThis.fetch = async () => Response.json({ success: true });

      let onSuccessCalled = false;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onSuccess() {
          onSuccessCalled = true;
        },
        parseResponse: () => {
          throw new Error('Parse error');
        },
      }));

      await enhancedFetch('/').catch(() => {});

      expect(onSuccessCalled).toBe(false);
    });
  });

  describe('onError', () => {
    it('should receive validation error', async () => {
      globalThis.fetch = async () =>
        Response.json({ hello: 'world' });

      let capturedError: unknown;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onError(error) {
          capturedError = error;
        },
      }));

      await enhancedFetch('/', {
        schema: z.object({ hello: z.number() }),
      }).catch(() => {});

      expect(isValidationError(capturedError)).toBe(true);
    });

    it('should receive response error', async () => {
      globalThis.fetch = async () =>
        new Response('Error', { status: 400 });

      let capturedError: unknown;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        retry: { attempts: 0 },
        onError(error) {
          capturedError = error;
        },
      }));

      await enhancedFetch('/').catch(() => {});

      expect(isResponseError(capturedError)).toBe(true);
    });

    it('should receive any error', async () => {
      globalThis.fetch = async () => Response.json({ success: true });

      let capturedError: unknown;

      const enhancedFetch = enhance(fetch, () => ({
        baseUrl: 'https://example.com',
        onError(error) {
          capturedError = error;
        },
      }));

      await enhancedFetch('/', {
        parseResponse: () => {
          throw new Error('custom error');
        },
      }).catch(() => {});

      expect((capturedError as Error).message).toBe('custom error');
    });
  });
});

// ============================================================================
// parseResponse tests
// ============================================================================
describe('parseResponse tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should parse JSON response by default', async () => {
    globalThis.fetch = async () => Response.json({ hello: 'world' });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
    }));

    const data = await enhancedFetch('/');
    expect(data).toEqual({ hello: 'world' });
  });

  it('should parse TEXT response by default', async () => {
    globalThis.fetch = async () => new Response('some text');

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
    }));

    const data = await enhancedFetch('/');
    expect(data).toBe('some text');
  });

  it('should provide response and request to parseResponse', async () => {
    globalThis.fetch = async () => new Response('some text');

    let capturedResponse: Response | undefined;
    let capturedUrl = '';

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      parseResponse(res, request) {
        capturedResponse = res;
        capturedUrl = request.url;
        return res?.text() ?? '';
      },
    }));

    await enhancedFetch('/');

    expect(capturedResponse instanceof Response).toBe(true);
    expect(capturedUrl).toBe('https://example.com/');
  });

  it('should allow fetcherOptions.parseResponse to override defaultOptions.parseResponse', async () => {
    globalThis.fetch = async () => Response.json({ hello: 'world' });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      parseResponse: () => Promise.resolve('from=default'),
    }));

    const data = await enhancedFetch('/', {
      method: 'POST',
      body: { a: 1 },
      parseResponse: () => Promise.resolve('from=fetcher'),
    });

    expect(data).toBe('from=fetcher');
  });

  it('should handle empty body response', async () => {
    globalThis.fetch = async () => new Response(null);

    let bodyWasNull = false;

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      parseResponse(res) {
        bodyWasNull = res?.body === null;
        return res?.text() ?? '';
      },
    }));

    await enhancedFetch('/');

    expect(bodyWasNull).toBe(true);
  });
});

// ============================================================================
// parseRejected tests
// ============================================================================
describe('parseRejected tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should parse JSON error response by default', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'bad' }), { status: 400 });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
    }));

    await enhancedFetch('/').catch((error) => {
      expect(error.data).toEqual({ error: 'bad' });
    });
  });

  it('should parse TEXT error response by default', async () => {
    globalThis.fetch = async () =>
      new Response('some error text', { status: 400 });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
    }));

    await enhancedFetch('/').catch((error) => {
      expect(error.data).toBe('some error text');
    });
  });

  it('should provide response and request to parseRejected', async () => {
    globalThis.fetch = async () =>
      new Response('error', { status: 400 });

    let capturedResponse: Response | undefined;
    let capturedUrl = '';

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
      parseRejected(res, request) {
        capturedResponse = res;
        capturedUrl = request.url;
        return res?.text() ?? '';
      },
    }));

    await enhancedFetch('/').catch(() => {});

    expect(capturedResponse instanceof Response).toBe(true);
    expect(capturedUrl).toBe('https://example.com/');
  });

  it('should allow fetcherOptions.parseRejected to override defaultOptions.parseRejected', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'bad' }), { status: 400 });

    const enhancedFetch = enhance(fetch, () => ({
      baseUrl: 'https://example.com',
      retry: { attempts: 0 },
      parseRejected: () => Promise.resolve('from=default'),
    }));

    await enhancedFetch('/', {
      method: 'POST',
      body: { a: 1 },
      parseRejected: () => Promise.resolve('from=fetcher'),
    }).catch((error) => {
      expect(error).toBe('from=fetcher');
    });
  });
});

// ============================================================================
// createResfetch schema priority tests
// ============================================================================
describe('createResfetch schema priority tests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = async () => Response.json({ id: 1, name: 'test' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('request-level schema should work when no global schema is defined', async () => {
    const requestOutputSchema = z.object({
      id: z.number(),
      name: z.string(),
    }).transform(data => ({
      ...data,
      transformed: true,
    }));

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
    });

    // Use request-level schema when no global schema
    const result = await fetcher('/test', {
      schema: {
        response: requestOutputSchema,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 1, name: 'test', transformed: true });
    }
  });

  it('request-level schema for body should work when no global schema is defined', async () => {
    let capturedBody: unknown;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      capturedBody = JSON.parse(await req.text());
      return Response.json({ success: true });
    };

    const requestInputSchema = z.object({
      email: z.string(),
    }).transform(data => ({
      ...data,
      addedByTransform: true,
    }));

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
    });

    const result = await fetcher('/test', {
      method: 'POST',
      body: { email: 'not-an-email' },
      schema: {
        body: requestInputSchema,
      },
    });

    expect(result.ok).toBe(true);
    expect(capturedBody).toEqual({ email: 'not-an-email', addedByTransform: true });
  });

  it('should return ValidationError when body validation fails in createResfetch', async () => {
    globalThis.fetch = async () => Response.json({ success: true });

    const bodySchema = z.object({
      email: z.string().email(),
    });

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
    });

    const result = await fetcher('/test', {
      method: 'POST',
      body: { email: 'invalid-email' },
      schema: {
        body: bodySchema,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isValidationError(result.error)).toBe(true);
    }
  });

  it('request-level schema for query should work when no global schema is defined', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input instanceof Request ? input.url : new URL(input).toString();
      return Response.json({ success: true });
    };

    const requestQuerySchema = z.object({
      page: z.coerce.number(),
    }).transform(data => ({
      page: data.page * 10,
    }));

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
    });

    await fetcher('/test', {
      query: { page: 2 },
      schema: {
        query: requestQuerySchema,
      },
    });

    expect(capturedUrl).toContain('page=20');
  });

  it('request-level schema for params should work when no global schema is defined', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input instanceof Request ? input.url : new URL(input).toString();
      return Response.json({ success: true });
    };

    const requestParamsSchema = z.object({
      id: z.coerce.string(),
    }).transform(data => ({
      id: `prefix-${data.id}`,
    }));

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
    });

    await fetcher('/user/:id', {
      params: { id: '123' },
      schema: {
        params: requestParamsSchema,
      },
    });

    expect(capturedUrl).toContain('/user/prefix-123');
  });

  it('should use global schema when defined for route', async () => {
    const globalOutputSchema = z.object({
      id: z.number(),
      name: z.string(),
    });

    const schema = {
      schema: {
        '/test': {
          response: globalOutputSchema,
        },
      },
      config: {},
    };

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      schema,
    });

    const result = await fetcher('/test');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 1, name: 'test' });
    }
  });

  it('global schema should take precedence and request-level schema should be ignored at runtime', async () => {
    const globalOutputSchema = z.object({
      id: z.number(),
      name: z.string(),
    });

    const requestOutputSchema = z.object({
      id: z.number(),
      name: z.string(),
    }).transform(data => ({
      ...data,
      overridden: true,
    }));

    const schema = {
      schema: {
        '/test': {
          response: globalOutputSchema,
        },
      },
      config: {},
    };

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      schema,
    });

    // Test runtime behavior: even if we force schema through type assertion,
    // global schema should take precedence
    // eslint-disable-next-line ts/no-explicit-any
    const result = await (fetcher as any)('/test', {
      schema: {
        response: requestOutputSchema,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should use global schema, NOT request-level schema (no 'overridden' field)
      expect(result.data).toEqual({ id: 1, name: 'test' });
    }
  });
});

// ============================================================================
// createResfetch lifecycle callback tests
// ============================================================================
describe('createResfetch lifecycle callback tests', () => {
  beforeEach(() => {
    globalThis.fetch = async () => Response.json({ success: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should call onRequest callback', async () => {
    let called = false;
    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      onRequest: () => {
        called = true;
      },
    });

    await fetcher('/test');
    expect(called).toBe(true);
  });

  it('should call onResponse callback', async () => {
    let called = false;
    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      onResponse: () => {
        called = true;
      },
    });

    await fetcher('/test');
    expect(called).toBe(true);
  });

  it('should call onSuccess callback', async () => {
    let successData: unknown;
    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      onSuccess: (data) => {
        successData = data;
      },
    });

    await fetcher('/test');
    expect(successData).toEqual({ success: true });
  });

  it('should call onError callback on error', async () => {
    globalThis.fetch = async () =>
      new Response('Error', { status: 500 });

    let errorCaught: unknown;
    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      onError: (err) => {
        errorCaught = err;
      },
    });

    await fetcher('/test');
    expect(errorCaught).toBeInstanceOf(ResponseError);
  });
});

// ============================================================================
// additional branch coverage tests
// ============================================================================
describe('additional branch coverage tests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('createResfetch non-Error exception handling', () => {
    it('should handle non-Error type exceptions', async () => {
      globalThis.fetch = async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'string error';
      };

      const fetcher = createResfetch({
        baseUrl: 'https://api.example.com',
      });

      const result = await fetcher('/test');
      expect(result.ok).toBe(false);
      if (!result.ok && isResponseError(result.error)) {
        expect(result.error.message).toBe('');
      }
    });
  });

  describe('resolveUrl URL object input', () => {
    it('should handle URL object as input', () => {
      const url = resolveUrl(
        'https://example.com',
        new URL('https://example.com/path'),
        undefined,
        undefined,
        params =>
          new URLSearchParams(
            params as Record<string, string>,
          ).toString(),
      );
      expect(url).toContain('/path');
    });
  });

  describe('withTimeout AbortSignal.any unsupported case', () => {
    it('should return original signal when AbortSignal.any does not exist', () => {
      // Save original AbortSignal.any
      const originalAny = AbortSignal.any;

      // Simulate environment without AbortSignal.any support
      // @ts-expect-error - deleting any method for testing purpose
      delete AbortSignal.any;

      const controller = new AbortController();
      const result = withTimeout(controller.signal, 1000);

      // Restore original AbortSignal.any
      AbortSignal.any = originalAny;

      expect(result).toBe(controller.signal);
    });
  });
});
