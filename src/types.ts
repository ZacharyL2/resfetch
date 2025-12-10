import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { ResponseError, ValidationError } from './errors';

/** The native fetch function type. */
export type FetchFn = typeof fetch;

/**
 * The result type returned by resfetch.
 * - `ok: true` - Request succeeded, `data` contains the response
 * - `ok: false` - Request failed, `error` is either ValidationError or ResponseError
 *
 * @template T - The expected response data type
 *
 * @example
 * ```ts
 * const result = await resfetch('/api/users');
 * if (result.ok) {
 *   console.log(result.data);
 * } else {
 *   console.log(result.error.message);
 * }
 * ```
 */
export type ResfetchResult<T> =
  | { ok: true, data: T, error?: undefined }
  | { ok: false, error: ValidationError, data?: undefined }
  | { ok: false, error: ResponseError, data?: undefined };

// --- Internal Utility Types ---
export type KeyOf<O> = O extends unknown ? keyof O : never;

export type DistributiveOmit<
  TObject extends object,
  TKey extends KeyOf<TObject> | (string & {}),
> = TObject extends unknown ? Omit<TObject, TKey> : never;

type IsNull<T> = [T] extends [null] ? true : false;

type IsUnknown<T> = unknown extends T
  ? IsNull<T> extends false
    ? true
    : false
  : false;

/** A value that can be either sync or async. */
export type MaybePromise<T> = T | Promise<T>;

// Utility type to simplify complex intersections for better readability
export type Prettier<T> = { [K in keyof T]: T[K] } & {};

// Helper to check if a type allows undefined or empty object (effectively optional)
export type IsOptional<T> = undefined extends T
  ? true
  : // eslint-disable-next-line ts/no-empty-object-type
    {} extends T
      ? true
      : false;

// --- Serializable Types ---
type JsonPrimitive = string | number | boolean | null | undefined;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SerializableObject = Record<PropertyKey, JsonValue>;

export type SerializableArray =
  | Array<JsonPrimitive | SerializableObject | SerializableArray>
  | ReadonlyArray<
      JsonPrimitive | SerializableObject | SerializableArray
  >;

// --- Parse & Serialize Types ---

/**
 * Function to parse the response body.
 * @template TParsedData - The parsed data type
 */
type ParseResponse<TParsedData> = (
  response: Response | undefined,
  request: Request,
) => MaybePromise<TParsedData>;

/** Function to parse rejected (non-ok) responses. */
type ParseRejected = (
  response: Response | undefined,
  request: Request,
) => unknown;

/** Function to serialize the request body. */
type SerializeBody<TRawBody> = (
  body: TRawBody,
) => BodyInit | null | undefined;

/** Function to serialize query params to a URL string. */
export type SerializeParams = (params: Params) => string;

/** A single query param value. */
export type ParamValue = string | number | boolean | null | undefined;

/** Query params object. */
export type Params = Record<string, ParamValue | ParamValue[]>;

/** Headers as a plain object (alternative to Headers class). */
export type HeadersObject = Record<
  string,
  string | number | null | undefined
>;

/** HTTP method (including custom methods). */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'CONNECT'
  | 'OPTIONS'
  | 'TRACE'
  | 'HEAD'
  | (string & {});

// --- Base Options ---
type BaseOptions<TFetch extends FetchFn> = DistributiveOmit<
  NonNullable<Parameters<TFetch>[1]>,
  'body' | 'headers' | 'method'
> & {};

// --- Retry Types ---

/** Callback called before each retry attempt. */
type OnRetry = (context: {
  /** The response (if request completed). */
  response: Response | undefined
  /** The error that caused the retry. */
  error: unknown
  /** The request being retried. */
  request: Request
  /** Current retry attempt number (starts at 1). */
  attempt: number
}) => MaybePromise<void>;

/** Function to decide if a request should be retried. */
type RetryWhen = (context: {
  response: Response | undefined
  error: unknown
  request: Request
}) => MaybePromise<boolean>;

/** Number of retry attempts, or a function returning it. */
type RetryAttempts =
  | number
  | ((context: { request: Request }) => MaybePromise<number>);

/** Delay between retries in ms, or a function returning it. */
type RetryDelay =
  | number
  | ((context: {
    response: Response | undefined
    error: unknown
    request: Request
    attempt: number
  }) => MaybePromise<number>);

/** Retry configuration options. */
export interface RetryOptions {
  /** Max retry attempts. Default: 0 */
  attempts?: RetryAttempts
  /** Delay between retries in ms. Default: 0 */
  delay?: RetryDelay
  /** Function to decide if should retry. Default: retries on network errors */
  when?: RetryWhen
}

// --- Default Raw Body ---
export type DefaultRawBody =
  | BodyInit
  | SerializableObject
  | SerializableArray;

// --- Fallback Options ---
export interface FallbackOptions {
  parseRejected: ParseRejected
  parseResponse: ParseResponse<unknown>
  reject: (response: Response | undefined) => MaybePromise<boolean>
  retry: Required<RetryOptions>
  serializeParams: SerializeParams
  serializeBody: SerializeBody<DefaultRawBody>
}

// --- Type Extractors ---
export type GetDefaultParsedData<TDefaultOptions> =
  TDefaultOptions extends DefaultOptions<FetchFn, infer U, unknown>
    ? U
    : never;

export type GetDefaultRawBody<TDefaultOptions> =
  TDefaultOptions extends DefaultOptions<FetchFn, unknown, infer U>
    ? IsUnknown<U> extends true
      ? DefaultRawBody
      : U
    : never;

// --- Default Options ---
export type DefaultOptions<
  TFetchFn extends FetchFn,
  TDefaultParsedData,
  TDefaultRawBody,
> = BaseOptions<TFetchFn> & {
  baseUrl?: string
  headers?: HeadersInit | HeadersObject
  method?: HttpMethod
  onError?: (error: unknown, request: Request) => MaybePromise<void>
  onRequest?: (request: Request) => MaybePromise<void>
  onResponse?: (
    response: Response | undefined,
    request: Request,
  ) => MaybePromise<void>
  onRetry?: OnRetry
  onSuccess?: (
    data: TDefaultParsedData,
    request: Request,
  ) => MaybePromise<void>
  params?: Params
  parseRejected?: ParseRejected
  parseResponse?: ParseResponse<TDefaultParsedData>
  reject?: (response: Response) => MaybePromise<boolean>
  retry?: RetryOptions
  serializeBody?: SerializeBody<TDefaultRawBody>
  serializeParams?: SerializeParams
  signal?: AbortSignal
  timeout?: number
};

// --- Fetcher Options ---
export type FetcherOptions<
  TFetchFn extends FetchFn,
  TSchema extends StandardSchemaV1,
  TParsedData,
  TRawBody,
> = BaseOptions<TFetchFn> & {
  baseUrl?: string
  body?: NoInfer<TRawBody> | null | undefined
  headers?: HeadersInit | HeadersObject
  method?: HttpMethod
  onError?: (error: unknown, request: Request) => MaybePromise<void>
  onRequest?: (request: Request) => MaybePromise<void>
  onResponse?: (
    response: Response | undefined,
    request: Request,
  ) => MaybePromise<void>
  onRetry?: OnRetry
  onSuccess?: (
    data: NoInfer<TParsedData>,
    request: Request,
  ) => MaybePromise<void>
  params?: Params
  parseRejected?: ParseRejected
  parseResponse?: ParseResponse<TParsedData>
  reject?: (response: Response) => MaybePromise<boolean>
  retry?: RetryOptions
  schema?: TSchema
  serializeBody?: SerializeBody<TRawBody>
  serializeParams?: SerializeParams
  signal?: AbortSignal
  timeout?: number
};

// --- EnhancedFetch Type ---
export type EnhancedFetch<
  TFetchFn extends FetchFn = FetchFn,
  TDefaultOptions extends DefaultOptions<
    FetchFn,
    unknown,
    DefaultRawBody
  > = DefaultOptions<FetchFn, unknown, DefaultRawBody>,
> = <
  TParsedData = GetDefaultParsedData<TDefaultOptions>,
  TSchema extends StandardSchemaV1<
    TParsedData,
    unknown
  > = StandardSchemaV1<TParsedData>,
  TRawBody = GetDefaultRawBody<TDefaultOptions>,
>(
  input: Parameters<TFetchFn>[0],
  options?: FetcherOptions<TFetchFn, TSchema, TParsedData, TRawBody>,
) => Promise<StandardSchemaV1.InferOutput<TSchema>>;

// =====================================================
// Schema Types (for type-safe API routes)
// =====================================================

/** Any Standard Schema compatible validator (zod, valibot, arktype, etc). */
export type SchemaType = StandardSchemaV1;

/**
 * Schema definition for a single API route.
 *
 * @example
 * ```ts
 * const userSchema: FetchSchema = {
 *   body: z.object({ name: z.string() }),
 *   response: z.object({ id: z.number() }),
 *   method: 'POST',
 * };
 * ```
 */
export interface FetchSchema {
  /** Schema to validate request body. */
  body?: SchemaType
  /** Schema to validate response data. */
  response?: SchemaType
  /** Schema to validate query params. */
  query?: SchemaType
  /** Schema to validate path params (e.g. `/users/:id`). */
  params?: SchemaType
  /** HTTP method for this route. */
  method?: HttpMethod
}

/** Map of route paths to their schema definitions. */
export type FetchSchemaRoutes = Record<string, FetchSchema>;

/** Configuration for schema-based fetching. */
export interface SchemaConfig {
  /** If true, only allow defined routes. */
  strict?: boolean
  /** URL prefix for all routes. */
  prefix?: string
  /** Base URL for all requests. */
  baseURL?: string
}

/** Complete schema definition with routes and config. */
export interface Schema {
  schema: FetchSchemaRoutes
  config: SchemaConfig
}

// --- Schema Type Helpers ---

/** Infer the output type from a schema. */
export type InferOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : T extends { _output: infer O }
    ? O
    : unknown;

/** Infer the input type from a schema. */
export type InferInput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<T>
  : T extends { _input: infer I }
    ? I
    : unknown;

// --- Create Resfetch Options ---

/** Base options available for each request. */
export interface BaseResfetchOptions {
  /** HTTP method. Default: 'GET' */
  method?: HttpMethod | (string & {})
  /** Request headers. */
  headers?: HeadersInit | HeadersObject
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal
  /** Request timeout in ms. */
  timeout?: number
  /** Callback before request is sent. */
  onRequest?: (request: Request) => MaybePromise<void>
  /** Callback after response is received (before parsing). */
  onResponse?: (
    response: Response | undefined,
    request: Request,
  ) => MaybePromise<void>
  /** Callback on successful response. */
  onSuccess?: (data: unknown, request: Request) => MaybePromise<void>
  /** Callback on error. */
  onError?: (error: unknown, request: Request) => MaybePromise<void>
  /** Callback before each retry. */
  onRetry?: OnRetry
}

/** Options for createResfetch(). */
export interface CreateResfetchOption extends BaseResfetchOptions {
  /** Base URL for all requests. */
  baseUrl?: string
  /** Default request body. */
  body?: unknown
  /** Custom parser for rejected responses. */
  parseRejected?: ParseRejected
  /** Custom response parser. Default: JSON.parse */
  parseResponse?: ParseResponse<unknown>
  /** Function to determine if response should be rejected. Default: !response.ok */
  reject?: (response: Response) => MaybePromise<boolean>
  /** Retry configuration. */
  retry?: RetryOptions
  /** Custom body serializer. */
  serializeBody?: SerializeBody<unknown>
  /** Custom query params serializer. */
  serializeParams?: SerializeParams
  /** Schema definition for type-safe routes. */
  schema?: Schema
  /** Custom fetch implementation. */
  fetch?: FetchFn
}

/** Schema definition for a single request. */
export interface RequestSchema {
  /** Schema to validate request body. */
  body?: SchemaType
  /** Schema to validate response data. */
  response?: SchemaType
  /** Schema to validate query params. */
  query?: SchemaType
  /** Schema to validate path params. */
  params?: SchemaType
  /** HTTP method. */
  method?: HttpMethod
}

/** Options for individual requests. */
export type ResfetchOptions<
  Body = unknown,
  Query = unknown,
  Params = unknown,
> = BaseResfetchOptions & {
  /** Request body data. */
  body?: Body
  /** Query string params. */
  query?: Query
  /** Path params (e.g. { id: '1' } for /users/:id). */
  params?: Params
  /** Per-request schema override. */
  schema?: RequestSchema
};

// --- Schema Options Inference ---

// Extract inferred types from schema
type InferBody<T extends FetchSchema> = T['body'] extends SchemaType
  ? InferInput<T['body']>
  : never;
type InferQuery<T extends FetchSchema> = T['query'] extends SchemaType
  ? InferInput<T['query']>
  : never;
type InferParams<T extends FetchSchema> =
  T['params'] extends SchemaType
    ? InferInput<T['params']>
    : Record<string, string>;

// Helper: make field optional or required based on value type
type OptionalField<K extends string, V> = [V] extends [never]
  ? { [P in K]?: unknown }
  : IsOptional<V> extends true
    ? { [P in K]?: V }
    : { [P in K]: V };

// Internal: Build schema-specific options (body/query/params only)
type SchemaOptions<T extends FetchSchema> = OptionalField<
  'body',
  InferBody<T>
> &
OptionalField<'query', InferQuery<T>> &
OptionalField<'params', InferParams<T>>;

// Options type combining schema fields with base options
export type SimplifyOptions<
  T extends FetchSchema,
  HasGlobalSchema extends boolean = false,
> = BaseResfetchOptions &
  Prettier<SchemaOptions<T>> &
  (HasGlobalSchema extends true
    ? { schema?: never }
    : { schema?: RequestSchema });

// Helper: check if schema field is required
type IsFieldRequired<
  T extends FetchSchema,
  K extends keyof FetchSchema,
> = T[K] extends SchemaType
  ? IsOptional<InferInput<T[K]>> extends true
    ? false
    : true
  : false;

// Check if options object is required (any field is required)
export type AreOptionsRequired<T extends FetchSchema> = true extends
  | IsFieldRequired<T, 'body'>
  | IsFieldRequired<T, 'query'>
  | IsFieldRequired<T, 'params'>
  ? true
  : false;

// --- URL Inference ---

/** Infer valid URL paths from a schema. */
export type InferUrl<S extends Schema> =
  keyof S['schema'] extends string ? keyof S['schema'] : string;

// --- Main Resfetch Interface ---

/** Request options with optional schema (for fetcher without global schema). */
export interface FetchOptions extends BaseResfetchOptions {
  /** Request body data. */
  body?: unknown
  /** Query string params. */
  query?: unknown
  /** Path params. */
  params?: Record<string, unknown>
  /** Per-request schema. */
  schema?: RequestSchema
}

// Internal: Get response type from route schema
type GetResponseType<Route extends FetchSchema> = Route extends {
  response: infer O
}
  ? InferOutput<O>
  : unknown;

// Internal: Infer response type from FetchOptions (from schema.response)
type InferFetchResponse<T> = T extends {
  schema: { response: infer R }
}
  ? InferOutput<R>
  : unknown;

/** Helper type to infer schema from createRfetch options. */
export type InferSchema<T> = T extends { schema: Schema }
  ? T['schema']
  : undefined;

/**
 * Unified options type for resfetch calls.
 * Automatically determines the correct type based on schema and URL.
 */
export type ResfetchCallOptions<
  S extends Schema | undefined,
  Url extends string,
> = S extends Schema
  ? Url extends keyof S['schema']
    ? Prettier<SimplifyOptions<S['schema'][Url], true>>
    : FetchOptions
  : FetchOptions;

/**
 * Response type for resfetch calls.
 * Infers from global schema, request schema, or defaults to unknown.
 */
type ResfetchResponseType<
  S extends Schema | undefined,
  Url extends string,
  Opts,
> = S extends Schema
  ? Url extends keyof S['schema']
    ? GetResponseType<S['schema'][Url]>
    : InferFetchResponse<Opts>
  : InferFetchResponse<Opts>;

/**
 * The resfetch function type.
 * - With schema: type-safe routes + fallback for unknown URLs
 * - Without schema: accepts any URL with optional schema
 */
export interface Resfetch<S extends Schema | undefined = undefined> {
  // Call with options
  <Url extends string, Opts extends ResfetchCallOptions<S, Url>>(
    url: Url,
    options: Opts,
  ): Promise<ResfetchResult<ResfetchResponseType<S, Url, Opts>>>

  // Call without options
  <Url extends string>(url: Url): Promise<
    ResfetchResult<
      ResfetchResponseType<S, Url, ResfetchCallOptions<S, Url>>
    >
  >
}
