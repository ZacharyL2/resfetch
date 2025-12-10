import type { StandardSchemaV1 } from '@standard-schema/spec';

import type {
  DefaultOptions,
  DefaultRawBody,
  EnhancedFetch,
  FetcherOptions,
  FetchFn,
  MaybePromise,
} from './types';
import { fallbackOptions } from './fallback-options';
import {
  abortableDelay,
  isSerializable,
  mergeHeaders,
  omit,
  resolveUrl,
  validate,
  withTimeout,
} from './utils';

export function enhance<
  const TFetchFn extends FetchFn,
  const TDefaultOptions extends DefaultOptions<
    TFetchFn,
    unknown,
    DefaultRawBody
  > = DefaultOptions<TFetchFn, unknown, DefaultRawBody>,
>(fetchFn: TFetchFn, getDefaultOptions: (
  input: Parameters<TFetchFn>[0],
  fetcherOpts:
    | FetcherOptions<TFetchFn, StandardSchemaV1, unknown, DefaultRawBody>
    | undefined,
) => MaybePromise<TDefaultOptions> = () =>
  Object.create(null) as TDefaultOptions): EnhancedFetch<TFetchFn, TDefaultOptions> {
  return (async (
    input: Parameters<TFetchFn>[0],
    fetcherOpts?: FetcherOptions<
      TFetchFn,
      StandardSchemaV1,
      unknown,
      DefaultRawBody
    >,
  ) => {
    const defaultOpts = await getDefaultOptions(input, fetcherOpts);

    const options = {
      ...fallbackOptions,
      ...defaultOpts,
      ...fetcherOpts,
      body: undefined as BodyInit | null | undefined,
      retry: {
        ...fallbackOptions.retry,
        ...defaultOpts.retry,
        ...fetcherOpts?.retry,
      },
    };

    // Store original body for Content-Type detection
    const originalBody = fetcherOpts?.body;

    options.body =
      originalBody === null || originalBody === undefined
        ? originalBody
        : options.serializeBody(originalBody);

    // Set Content-Type header based on body type
    // - If body is undefined/null, don't set Content-Type
    // - If original body is FormData, let browser set Content-Type with correct boundary
    // - Otherwise, set application/json for serializable objects
    options.headers = mergeHeaders([
      options.body === undefined ||
      options.body === null ||
      originalBody instanceof FormData
        ? {}
        : isSerializable(originalBody) && typeof options.body === 'string'
          ? { 'content-type': 'application/json' }
          : {},
      defaultOpts.headers,
      fetcherOpts?.headers,
    ]);

    let attempt = 0;
    let request: Request;
    let response: Response | undefined;
    let error: unknown;

    do {
      // per-try timeout
      options.signal = withTimeout(fetcherOpts?.signal, options.timeout);

      const requestUrl =
        input instanceof Request
          ? input
          : resolveUrl(
              options.baseUrl,
              input,
              defaultOpts.params,
              fetcherOpts?.params,
              options.serializeParams,
            );

      request = new Request(requestUrl, options as RequestInit);

      try {
        await defaultOpts.onRequest?.(request);
        await fetcherOpts?.onRequest?.(request);

        response = await fetchFn(
          request,
          // do not override the request body & patch headers again
          { ...omit(options, ['body']), headers: request.headers },
        );
        error = undefined;
      } catch (e: unknown) {
        error = e;
        // continue to retry
      }

      try {
        if (
          !(await options.retry.when({ request, response, error })) ||
          ++attempt >
          (typeof options.retry.attempts === 'function'
            ? await options.retry.attempts({ request })
            : options.retry.attempts)
        ) {
          break;
        }

        const retryCtx = { attempt, request, response, error };
        await abortableDelay(
          typeof options.retry.delay === 'function'
            ? await options.retry.delay(retryCtx)
            : options.retry.delay,
          options.signal,
        );
        await defaultOpts.onRetry?.(retryCtx);
        await fetcherOpts?.onRetry?.(retryCtx);
      } catch (e: unknown) {
        error = e;
        break; // no retry
      }
      // biome-ignore lint/correctness/noConstantCondition: false
    } while (true);

    try {
      if (error) {
        throw error;
      }

      if (await options.reject(response)) {
        throw await options.parseRejected(response, request);
      }

      await defaultOpts.onResponse?.(response, request);
      await fetcherOpts?.onResponse?.(response, request);

      const parsed = await options.parseResponse(response, request);
      const schema = fetcherOpts?.schema;
      const data = schema ? await validate(schema, parsed) : parsed;
      await defaultOpts.onSuccess?.(data, request);
      await fetcherOpts?.onSuccess?.(data, request);
      return data;
    } catch (err: unknown) {
      await defaultOpts.onError?.(err, request);
      await fetcherOpts?.onError?.(err, request);
      throw err;
    }
  }) as EnhancedFetch<TFetchFn, TDefaultOptions>;
}
