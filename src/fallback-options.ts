import type { DefaultRawBody, FallbackOptions } from './types';
import { ResponseError } from './errors';
import { isSerializable } from './utils';

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

  // TODO: find a lighter way to do this with about the same amount of code
  serializeParams: params =>
    // JSON.parse(JSON.stringify(params)) recursively transforms Dates to ISO strings and strips undefined
    new URLSearchParams(
      JSON.parse(JSON.stringify(params)) as Record<string, string>,
    ).toString(),

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
