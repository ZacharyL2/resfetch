import type { DefaultRawBody, FallbackOptions } from './types';
import { ResponseError } from './errors';
import { isNil, isSerializable } from './utils';

export const fallbackOptions: FallbackOptions = {
  parseResponse: async (res) => {
    if (!res) {
      return null;
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text || null;
    }
  },

  parseRejected: async (response, request) =>
    new ResponseError({
      message: response ? `[${response.status}] ${response.statusText}` : '',
      data: await fallbackOptions.parseResponse(response, request),
      response,
      request,
    }),

  serializeParams: (params) => {
    const searchParams = new URLSearchParams();

    const append = (key: string, value: unknown): void => {
      if (isNil(value)) {
        return;
      }
      if (value instanceof Date) {
        searchParams.append(key, value.toISOString());
      } else {
        searchParams.append(key, String(value));
      }
    };

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          append(key, item);
        }
      } else {
        append(key, value);
      }
    }

    return searchParams.toString();
  },

  serializeBody: (body: DefaultRawBody): BodyInit =>
    // FormData should be passed through without serialization
    // Browser will set correct Content-Type with boundary
    body instanceof FormData
      ? body
      : isSerializable(body)
        ? JSON.stringify(body)
        : body,

  reject: response => !response?.ok,

  retry: {
    when: ctx => ctx.response?.ok === false,
    attempts: 0,
    delay: 0,
  },
};
