import type { StandardSchemaV1 } from '@standard-schema/spec';

import type {
  CreateResfetchOption,
  DefaultOptions,
  FetcherOptions,
  FetchFn,
  FetchSchema,
  FetchSchemaRoutes,
  InferSchema,
  Params,
  Resfetch,
  ResfetchOptions,
  SchemaConfig,
} from './types';
import { enhance } from './enhance';
import {
  isResponseError,
  isValidationError,
  ResponseError,
} from './errors';
import { err, ok } from './result';
import { replacePathParams, validate } from './utils';

/**
 * Create a type-safe fetch client with schema validation
 *
 * @example
 * ```ts
 * const fetcher = createResfetch({
 *   baseUrl: 'https://api.example.com',
 *   schema: mySchema,
 * });
 * ```
 */
export function createResfetch<const T extends CreateResfetchOption = CreateResfetchOption>(
  options?: T,
): Resfetch<InferSchema<T>> {
  // Separate global schema from default fetch options
  const { schema, fetch: customFetch, ...defaultOpts } = options ?? {};

  // Initialize internal enhanced fetch instance
  // Use custom fetch if provided, otherwise use global fetch
  const enhancedFetch = enhance(
    customFetch ?? fetch,
    (): DefaultOptions<FetchFn, unknown, unknown> => defaultOpts,
  );

  const fetcher = async (
    url: string,
    fetcherOptions?: ResfetchOptions,
  ) => {
    // Get global schema for this route
    const globalSchemaDef = schema?.schema?.[url];

    // If global schema is defined for this route, use it and ignore request-level schema
    // Otherwise, use request-level schema if provided
    const schemaDef: FetchSchema = globalSchemaDef ?? fetcherOptions?.schema ?? {};

    try {
      // Clone options to avoid mutating original object
      const currentOptions = { ...fetcherOptions };

      // 2. Validate Body
      if (schemaDef.body && currentOptions.body) {
        currentOptions.body = await validate(
          schemaDef.body,
          currentOptions.body,
        );
      }

      // 3. Validate Query Params
      if (schemaDef.query && currentOptions.query) {
        currentOptions.query = await validate(
          schemaDef.query,
          currentOptions.query,
        );
      }

      // 4. Validate Path Params
      if (schemaDef.params && currentOptions.params) {
        currentOptions.params = await validate(
          schemaDef.params,
          currentOptions.params,
        );
      }

      // 5. Replace Path Params in URL
      // e.g. "/user/:id" + { params: { id: "1" } } => "/user/1"
      const actualUrl = replacePathParams(url, currentOptions.params);

      // 6. Map options to enhanced fetch format
      const fetchOptions: FetcherOptions<
        FetchFn,
        StandardSchemaV1,
        unknown,
        unknown
      > = {
        ...currentOptions,
        // Enhanced fetch uses 'params' for Query String, so we map 'query' to it
        params: currentOptions.query as Params,
        // Pass the response schema to enhanced fetch for response validation
        schema: schemaDef.response
          ? schemaDef.response
          : undefined,
        // We should also forward the method if defined in schema and not overridden
        method: currentOptions.method || schemaDef.method,
      };

      // 7. Execute Request
      const data = await enhancedFetch(actualUrl, fetchOptions);

      return ok(data);
    } catch (e) {
      if (isValidationError(e)) {
        return err(e);
      }
      if (isResponseError(e)) {
        return err(e);
      }
      // Wrap unknown errors (like network errors) into ResponseError
      return err(
        new ResponseError({
          originalError: e,
          message: e instanceof Error ? e.message : '',
        }),
      );
    }
  };

  return fetcher as Resfetch<InferSchema<T>>;
}

/**
 * Default resfetch instance with no configuration.
 * Use this for simple requests without custom baseUrl or schema.
 *
 * @example
 * ```ts
 * const result = await resfetch('/api/users');
 * ```
 */
export const resfetch = createResfetch();

/**
 * Create a type-safe schema definition.
 *
 * @example
 * ```ts
 * const schema = createSchema({
 *   '/users': { response: z.array(userSchema) },
 *   '/users/:id': { response: userSchema, params: z.object({ id: z.string() }) },
 * });
 * ```
 */
export function createSchema<
  F extends FetchSchemaRoutes,
  S extends SchemaConfig = SchemaConfig,
>(schema: F, config?: S) {
  return {
    schema,
    config: config || {},
  };
}
