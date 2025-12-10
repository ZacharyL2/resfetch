# resfetch

A tiny (~4KB), type-safe fetch wrapper with [Standard Schema](https://standardschema.dev/) validation, Result pattern, and zero dependencies.

## Features

- 🪶 **Tiny** - ~4KB minified, zero dependencies
- 🔒 **Type-safe** - Full TypeScript support with inferred types
- 📋 **Standard Schema** - Works with Zod, Valibot, ArkType, and any Standard Schema compliant validator
- ✅ **Result Pattern** - No try/catch needed, errors returned as values
- 🚫 **Never Throws** - All errors are wrapped in Result type, no unexpected exceptions
- ⚡ **Zero Clone** - No data cloning overhead, better performance than libs that clone body/response
- 🔄 **Retry** - Built-in retry with customizable strategy
- ⏱️ **Timeout** - Request timeout support
- 🪝 **Hooks** - `onRequest`, `onResponse`, `onSuccess`, `onError`, `onRetry`
- 🧪 **100% Test Coverage** - Battle-tested and reliable

## Install

```bash
# pnpm
pnpm add resfetch

# bun
bun add resfetch

# npm
npm install resfetch
```

## Table of Contents

- [Quick Start](#quick-start)
- [Basic Usage](#basic-usage)
- [Create Custom Client](#create-custom-client)
- [Schema Validation](#schema-validation)
- [Error Handling](#error-handling)
- [Custom Serializers](#custom-serializers)
- [Retry Strategy](#retry-strategy)
- [Hooks](#hooks)
- [API Reference](#api-reference)

## Quick Start

```ts
import { matchResfetch, resfetch } from 'resfetch';

const result = await resfetch('https://api.example.com/users');

// Option 1: if/else pattern
if (result.ok) {
  console.log(result.data);
} else {
  console.log(result.error.message);
}

// Option 2: Pattern matching (like Rust's match)
const message = matchResfetch(result, {
  ok: data => `Got ${data.length} users`,
  validationError: err => `Invalid: ${err.issues}`,
  responseError: err => `Failed: ${err.status}`,
});
```

## Basic Usage

```ts
// GET request
const result = await resfetch('/api/users');

// Path params - replace :id with actual value
const result = await resfetch('/api/users/:id', {
  params: { id: '123' },
});
// → GET /api/users/123

// Query params - appended to URL
const result = await resfetch('/api/users', {
  query: { page: 1, limit: 10 },
});
// → GET /api/users?page=1&limit=10

// POST with JSON body
const result = await resfetch('/api/users', {
  method: 'POST',
  body: { name: 'John', email: 'john@example.com' },
});

// With custom headers
const result = await resfetch('/api/users', {
  headers: { 'X-Custom-Header': 'value' },
});

// With timeout (ms)
const result = await resfetch('/api/users', {
  timeout: 5000,
});

// With AbortSignal
const controller = new AbortController();
const result = await resfetch('/api/users', {
  signal: controller.signal,
});
```

## Create Custom Client

Create a reusable client with shared configuration:

```ts
import { createResfetch } from 'resfetch';

const api = createResfetch({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  headers: { Authorization: 'Bearer token' },
  retry: { attempts: 3, delay: 1000 },
});

// All requests inherit the configuration
const result = await api('/users');
```

## Schema Validation

Works with Zod, Valibot, ArkType, and any [Standard Schema](https://standardschema.dev/) compatible library.

### Global Schema (Recommended)

Define routes upfront for full type safety:

```ts
import { createResfetch, createSchema } from 'resfetch';
import { z } from 'zod';

const User = z.object({ id: z.number(), name: z.string() });

const api = createResfetch({
  baseUrl: 'https://api.example.com',
  schema: createSchema({
    '/users': {
      response: z.array(User),
    },
    '/users/:id': {
      response: User,
      params: z.object({ id: z.string() }),
    },
    '/users/create': {
      method: 'POST',
      body: z.object({ name: z.string() }),
      response: User,
    },
  }),
});

// TypeScript knows the exact return types
const users = await api('/users'); // ResfetchResult<User[]>
const user = await api('/users/:id', {
  params: { id: '1' }, // params is type-checked
}); // ResfetchResult<User>

// Routes in global schema cannot use per-request schema
// api('/users', { schema: {...} })
```

### Per-request Schema

For routes not defined in global schema:

```ts
// Without global schema
const api = createResfetch({ baseUrl: 'https://api.example.com' });

const result = await api('/any-route', {
  schema: {
    response: z.object({ message: z.string() }),
    body: z.object({ data: z.string() }),
    query: z.object({ page: z.number() }),
    params: z.object({ id: z.string() }),
  },
});

// With global schema - only for routes NOT in schema
const apiWithSchema = createResfetch({
  baseUrl: 'https://api.example.com',
  schema: createSchema({ '/users': { response: z.array(User) } }),
});

// '/other' is not in global schema, so per-request schema is allowed
const other = await apiWithSchema('/other', {
  schema: { response: z.object({ id: z.number() }) },
});
```

## Error Handling

### Result Pattern

All errors are returned as values, no try/catch needed:

```ts
const result = await resfetch('/api/users');

if (result.ok) {
  // Success - result.data is available
  console.log(result.data);
} else {
  // Error - result.error is ValidationError | ResponseError
  console.log(result.error.message);
}
```

### Pattern Matching

Use `matchResfetch` for exhaustive error handling:

```ts
import { matchResfetch } from 'resfetch';

const message = matchResfetch(result, {
  ok: data => `Got ${data.length} users`,
  validationError: err => `Validation failed: ${err.issues}`,
  responseError: err => `HTTP ${err.status}: ${err.message}`,
});
```

### Error Type Guards

```ts
import { isResponseError, isValidationError } from 'resfetch';

if (!result.ok) {
  if (isValidationError(result.error)) {
    // Schema validation failed
    console.log(result.error.issues); // Validation issues array
    console.log(result.error.data); // Raw data that failed validation
  }

  if (isResponseError(result.error)) {
    // HTTP or network error
    console.log(result.error.status); // HTTP status code (e.g. 404)
    console.log(result.error.response); // Raw Response object
    console.log(result.error.data); // Parsed response body
    console.log(result.error.request); // Request object
    console.log(result.error.originalError); // Original error (for network errors)
  }
}
```

## Custom Serializers

Override default JSON behavior:

```ts
const api = createResfetch({
  // Parse response as text instead of JSON
  parseResponse: async response => response?.text() ?? null,

  // Parse error response body
  parseRejected: async (response) => {
    const text = await response?.text();
    return { message: text, status: response?.status };
  },

  // Custom body serialization
  serializeBody: body => JSON.stringify(body),

  // Custom query params serialization
  serializeParams: params => new URLSearchParams(params).toString(),

  // Custom rejection logic (default: !response?.ok)
  reject: response => (response?.status ?? 0) >= 400,
});
```

## Retry Strategy

```ts
const api = createResfetch({
  retry: {
    // Fixed number or dynamic function
    attempts: 3,
    // or: attempts: ({ request }) => request.url.includes('/critical') ? 5 : 2,

    // Fixed delay or exponential backoff
    delay: 1000,
    // or: delay: ({ attempt }) => Math.min(1000 * 2 ** attempt, 30000),

    // Custom retry condition (default: retries on non-ok responses)
    when: ({ response, error }) => {
      // Retry on network errors
      if (!response) {
        return true;
      }
      // Retry on 5xx errors
      return response.status >= 500;
    },
  },
});
```

## Hooks

```ts
const api = createResfetch({
  // Before request is sent
  onRequest: (request) => {
    console.log(`→ ${request.method} ${request.url}`);
  },

  // After response received (before parsing)
  onResponse: (response, request) => {
    console.log(`← ${response?.status} ${request.url}`);
  },

  // On successful response
  onSuccess: (data, request) => {
    console.log('Data received:', data);
  },

  // On any error
  onError: (error, request) => {
    console.error('Request failed:', error);
  },

  // Before each retry attempt
  onRetry: ({ response, error, request, attempt }) => {
    console.log(`Retry #${attempt} for ${request.url}`);
  },
});
```

## API Reference

### Exports

```ts
import type { MatchHandlers, ResfetchResult } from 'resfetch';
import {
  createResfetch, // Create custom client
  createSchema, // Create type-safe schema
  isResponseError,
  // Error utilities
  isValidationError,
  matchResfetch, // Pattern matching helper
  // Functions
  resfetch, // Default fetch client
  ResponseError,

  // Types
  ValidationError,
} from 'resfetch';
```

### `resfetch(url, options?)`

Default fetch client with no configuration.

### `createResfetch(options?)`

Create a custom fetch client with shared configuration.

### `createSchema(routes, config?)`

Create a type-safe schema definition.

```ts
const schema = createSchema(
  {
    '/users': { response: UserSchema },
  },
  {
    strict: true, // Only allow defined routes (future)
    prefix: '/api', // URL prefix for all routes (future)
    baseURL: '...', // Base URL (future)
  },
);
```

### `matchResfetch(result, handlers)`

Pattern matching for ResfetchResult, similar to Rust's match expression.

### Request Options

| Option    | Type                    | Default | Description                                       |
| --------- | ----------------------- | ------- | ------------------------------------------------- |
| `method`  | `string`                | `'GET'` | HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) |
| `headers` | `HeadersInit \| object` | -       | Request headers                                   |
| `body`    | `unknown`               | -       | Request body (auto-serialized to JSON by default) |
| `query`   | `object`                | -       | Query string params (appended to URL)             |
| `params`  | `object`                | -       | Path params (e.g. `{ id: '1' }` for `/users/:id`) |
| `schema`  | `RequestSchema`         | -       | Per-request schema validation                     |
| `timeout` | `number`                | -       | Request timeout in milliseconds                   |
| `signal`  | `AbortSignal`           | -       | AbortSignal to cancel request                     |
| `retry`   | `RetryOptions`          | -       | Retry configuration                               |

### Client Options (createRfetch)

All request options above, plus:

| Option            | Type                          | Default               | Description                                                            |
| ----------------- | ----------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `baseUrl`         | `string`                      | -                     | Base URL prepended to all requests                                     |
| `fetch`           | `typeof fetch`                | `globalThis.fetch`    | Custom fetch implementation                                            |
| `parseResponse`   | `(response, request) => data` | JSON or text fallback | Custom response parser (default: tries JSON.parse, falls back to text) |
| `parseRejected`   | `(response, request) => data` | -                     | Parser for rejected (error) responses                                  |
| `serializeBody`   | `(body) => BodyInit`          | `JSON.stringify`      | Custom body serializer                                                 |
| `serializeParams` | `(params) => string`          | URLSearchParams       | Custom query params serializer                                         |
| `reject`          | `(response) => boolean`       | `!response?.ok`       | Determine if response should be rejected                               |

### Retry Options

| Option     | Type                        | Default        | Description                |
| ---------- | --------------------------- | -------------- | -------------------------- |
| `attempts` | `number \| (ctx) => number` | `0`            | Max retry attempts         |
| `delay`    | `number \| (ctx) => number` | `0`            | Delay between retries (ms) |
| `when`     | `(ctx) => boolean`          | `!response?.ok` | Condition to trigger retry |

Context object (`ctx`) contains: `{ response, error, request, attempt }`

### Schema Definition

```ts
interface RequestSchema {
  body?: StandardSchema // Validate request body
  response?: StandardSchema // Validate response data
  query?: StandardSchema // Validate query params
  params?: StandardSchema // Validate path params
  method?: HttpMethod // HTTP method for this route
}
```

### Hooks

| Hook         | Signature                                        | Description                    |
| ------------ | ------------------------------------------------ | ------------------------------ |
| `onRequest`  | `(request: Request) => void`                     | Called before request is sent  |
| `onResponse` | `(response: Response \| undefined, request: Request) => void` | Called after response received |
| `onSuccess`  | `(data: unknown, request: Request) => void`      | Called on successful response  |
| `onError`    | `(error: unknown, request: Request) => void`     | Called on any error            |
| `onRetry`    | `(ctx: RetryContext) => void`                    | Called before each retry       |

RetryContext: `{ response, error, request, attempt }`

## Acknowledgments

This project is inspired by and built upon the ideas from:

- [up-fetch](https://github.com/L-Blondy/up-fetch) - Advanced fetch client builder
- [better-fetch](https://github.com/better-auth/better-fetch) - Advanced fetch wrapper for TypeScript with schema validations

## License

MIT
