import type { StandardSchemaV1 } from '@standard-schema/spec';

import type {
  DistributiveOmit,
  HeadersObject,
  KeyOf,
  Params,
  SerializableArray,
  SerializableObject,
  SerializeParams,
} from './types';
import { ValidationError } from './errors';

export function mergeHeaders(headerInits: (HeadersInit | HeadersObject | undefined)[]) {
  const res: Record<string, string> = {};
  headerInits.forEach((init) => {
    // casting `init` to `HeadersInit` because `Record<string, any>` is
    // properly transformed to `Record<string,string>` by `new Headers(init)`
    new Headers(init as HeadersInit | undefined).forEach((value, key) => {
      value === 'null' || value === 'undefined'
        ? delete res[key]
        : (res[key] = value);
    });
  });
  return res;
}

function isAbortSignal(v: unknown): v is AbortSignal {
  return v instanceof AbortSignal;
}

export function withTimeout(signal: AbortSignal | undefined, timeout: number | undefined): AbortSignal | undefined {
  return 'any' in AbortSignal
    ? AbortSignal.any(
        [signal, timeout ? AbortSignal.timeout(timeout) : undefined].filter(
          isAbortSignal,
        ),
      )
    : signal;
}

export function omit<O extends object, K extends KeyOf<O> | (string & {})>(obj?: O, keys: K[] | readonly K[] = []): DistributiveOmit<O, K> {
  const copy = { ...obj } as DistributiveOmit<O, K>;
  for (const key in copy) {
    if ((keys as readonly string[]).includes(key)) {
      delete copy[key];
    }
  }
  return copy;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === 'object' &&
    (value as object).constructor?.name === 'Object';
}

export function isSerializable(value: unknown): value is SerializableObject | SerializableArray {
  return isPlainObject(value) ||
    Array.isArray(value) ||
    (typeof value === 'object' &&
      value !== null &&
      'toJSON' in value &&
      typeof (value as { toJSON?: unknown }).toJSON === 'function');
}

export function resolveUrl(base: string | undefined = '', input: URL | string, defaultOptsParams: Params | undefined, fetcherOptsParams: Params | undefined, serializeParams: SerializeParams): string {
  const inputStr = input instanceof URL ? input.href : input;
  const qs = serializeParams({
    // Removing the 'url.searchParams.keys()' from the defaultParams
    // but not from the 'fetcherParams'. The user is responsible for not
    // specifying the params in both the "input" and the fetcher "params" option.
    ...omit(defaultOptsParams, [
      ...new URL(inputStr, 'http://a').searchParams.keys(),
    ]),
    ...fetcherOptsParams,
  });

  let url: string = /^https?:\/\//.test(inputStr)
    ? inputStr
    : !base || !inputStr
        ? base + inputStr
        : `${base.replace(/\/$/, '')}/${inputStr.replace(/^\//, '')}`;

  if (qs) {
    url += (url.includes('?') ? '&' : '?') + qs.replace(/^\?/, '');
  }
  return url;
}

export function abortableDelay(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.addEventListener('abort', handleAbort, { once: true });

    const token = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, delay);

    function handleAbort() {
      clearTimeout(token);
      reject(signal!.reason);
    }
  });
}

export async function validate<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  data: StandardSchemaV1.InferInput<TSchema>,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema['~standard'].validate(data);
  if (result.issues) {
    throw new ValidationError(result, data);
  }
  return result.value;
}

/**
 * Replaces parameters in a URL path (e.g. /user/:id) with values from a params object.
 */
export function replacePathParams(path: string, params?: unknown): string {
  if (!isPlainObject(params)) {
    return path;
  }
  let newPath = path;
  // We iterate over the params to replace occurrences in the path
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    // Replace :key with value
    // We use a global regex to replace all occurrences
    newPath = newPath.replace(new RegExp(`:${key}\\b`, 'g'), String(value));
  }
  return newPath;
}
