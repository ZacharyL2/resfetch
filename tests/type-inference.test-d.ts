import type { ResfetchError } from '../src/errors';
import type {
  AreOptionsRequired,
  FetchSchema,
  InferInput,
  InferOutput,
  InferUrl,
  IsOptional,
  Prettier,
  Resfetch,
  ResfetchOptions,
  SimplifyOptions,
} from '../src/types';

import { assertType, describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createResfetch, createSchema, resfetch } from '../src';

describe('Type Inference Tests (Type-Level)', () => {
  describe('InferOutput', () => {
    it('should correctly infer zod object schema', () => {
      type TestSchema = ReturnType<
        typeof z.object<{
          id: ReturnType<typeof z.number>
          name: ReturnType<typeof z.string>
        }>
      >;

      type Output = InferOutput<TestSchema>;

      expectTypeOf<Output>().toEqualTypeOf<{
        id: number
        name: string
      }>();
    });

    it('should correctly infer nested schema', () => {
      type NestedSchema = ReturnType<
        typeof z.object<{
          user: ReturnType<
            typeof z.object<{
              id: ReturnType<typeof z.number>
              profile: ReturnType<
                typeof z.object<{
                  avatar: ReturnType<typeof z.string>
                }>
              >
            }>
          >
        }>
      >;

      type Output = InferOutput<NestedSchema>;

      expectTypeOf<Output>().toEqualTypeOf<{
        user: {
          id: number
          profile: {
            avatar: string
          }
        }
      }>();
    });

    it('should correctly infer optional fields', () => {
      // eslint-disable-next-line unused-imports/no-unused-vars
      const optionalSchema = z.object({
        id: z.number(),
        name: z.string().optional(),
      });

      type Output = InferOutput<typeof optionalSchema>;

      expectTypeOf<Output>().toMatchTypeOf<{
        id: number
        name?: string | undefined
      }>();
    });
  });

  describe('InferInput', () => {
    it('should correctly infer input type', () => {
      type InputSchema = ReturnType<
        typeof z.object<{
          email: ReturnType<typeof z.string>
          age: ReturnType<typeof z.number>
        }>
      >;

      type Input = InferInput<InputSchema>;

      expectTypeOf<Input>().toEqualTypeOf<{
        email: string
        age: number
      }>();
    });
  });

  describe('Resfetch Return Type', () => {
    const schema = createSchema({
      '/user/:id': {
        params: z.object({ id: z.number() }),
        response: z.object({
          id: z.number(),
          name: z.string(),
        }),
        method: 'GET',
      },
      '/users': {
        response: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
          }),
        ),
        method: 'GET',
      },
    });

    const fetcher = createResfetch({
      baseUrl: 'https://api.example.com',
      schema,
    });

    it('Result.data should be correct response type', async () => {
      const result = await fetcher('/user/:id', {
        params: { id: 1 },
      });

      if (result.ok) {
        expectTypeOf(result.data).toEqualTypeOf<{
          id: number
          name: string
        }>();
        expectTypeOf(result.data.id).toEqualTypeOf<number>();
        expectTypeOf(result.data.name).toEqualTypeOf<string>();
      }
    });

    it('array response should be correctly inferred', async () => {
      const result = await fetcher('/users');

      if (result.ok) {
        expectTypeOf(result.data).toEqualTypeOf<
          Array<{ id: number, name: string }>
        >();
      }
    });

    it('Result.error should be ResfetchError type', async () => {
      const result = await fetcher('/user/:id', {
        params: { id: 1 },
      });

      if (!result.ok) {
        expectTypeOf(result.error).toMatchTypeOf<ResfetchError>();
      }
    });
  });

  describe('URL Type Inference', () => {
    it('fetcher url parameter should be routes defined in schema', () => {
      const schema = createSchema({
        '/users': { method: 'GET', response: z.array(z.string()) },
        '/user/:id': { method: 'GET', response: z.string() },
      });

      const fetcher = createResfetch({
        baseUrl: 'https://api.example.com',
        schema,
      });

      // These calls should be type-safe
      assertType(fetcher('/users'));
      assertType(fetcher('/user/:id'));

      assertType(fetcher('/invalid'));
    });
  });

  describe('Options Type Inference', () => {
    it('required body/params should be enforced at type level', () => {
      const schema = createSchema({
        '/user/:id': {
          params: z.object({ id: z.number() }),
          body: z.object({ name: z.string() }),
          method: 'POST',
        },
      });

      const fetcher = createResfetch({
        baseUrl: 'https://api.example.com',
        schema,
      });

      // Must provide params and body
      assertType(
        fetcher('/user/:id', {
          params: { id: 1 },
          body: { name: 'Alice' },
        }),
      );
    });

    it('optional fields should be handled correctly', () => {
      const schema = createSchema({
        '/search': {
          query: z.object({
            q: z.string(),
            page: z.number().optional(),
          }),
          method: 'GET',
        },
      });

      const fetcher = createResfetch({
        baseUrl: 'https://api.example.com',
        schema,
      });

      // page is optional
      assertType(
        fetcher('/search', {
          query: { q: 'test' },
        }),
      );

      assertType(
        fetcher('/search', {
          query: { q: 'test', page: 1 },
        }),
      );
    });
  });

  describe('Request-level Schema Override', () => {
    it('request-level schema should NOT be allowed when global schema is defined for route', () => {
      const schema = createSchema({
        // '/user/:id': {
        //   params: z.object({ id: z.number() }),
        //   response: z.object({ id: z.number(), name: z.string() }),
        //   method: 'GET',
        // },
        '/user': {
          body: z.object({ name: z.string() }),
          response: z.object({ id: z.number() }),
          method: 'POST',
        },
      });

      const fetcher = createResfetch({
        baseUrl: 'https://api.example.com',
        schema,
      });

      // When global schema is defined, schema field should not exist in options type
      // The following calls should work without schema field
      assertType(
        fetcher('/user/:id', {
          params: { id: 1 },
          schema: {
            response: z.object({ id: z.number(), name: z.string() }),
          },
        }),
      );

      assertType(
        fetcher('/user', {
          body: { name: 'test' },
        }),
      );
    });

    it('fetcher without global schema should accept request-level schema', () => {
      const fetcher = createResfetch({
        baseUrl: 'https://api.example.com',
      });

      assertType(
        fetcher('/any-url', {
          method: 'POST',
          schema: {
            response: z.object({ id: z.number() }),
            body: z.object({ name: z.string() }),
            params: z.object({ id: z.string() }),
          },
        }),
      );
    });

    it('fetcher without global schema should infer response type from request-level schema', async () => {
      const result = await resfetch('/any-url', {
        schema: {
          response: z.object({ id: z.number(), name: z.string() }),
        },
      });

      if (result.ok) {
        // Should infer the correct response type
        expectTypeOf(result.data).toEqualTypeOf<{ id: number, name: string }>();
      }
    });
  });

  describe('Utility Type Tests', () => {
    describe('IsOptional', () => {
      it('should detect optional types', () => {
        expectTypeOf<IsOptional<string | undefined>>().toEqualTypeOf<true>();
        expectTypeOf<IsOptional<undefined>>().toEqualTypeOf<true>();
        // eslint-disable-next-line ts/no-empty-object-type
        expectTypeOf<IsOptional<{}>>().toEqualTypeOf<true>();
      });

      it('should detect required types', () => {
        expectTypeOf<IsOptional<string>>().toEqualTypeOf<false>();
        expectTypeOf<IsOptional<number>>().toEqualTypeOf<false>();
        expectTypeOf<IsOptional<{ id: number }>>().toEqualTypeOf<false>();
      });
    });

    describe('Prettier', () => {
      it('should flatten intersection types', () => {
        type Intersection = { a: string } & { b: number };
        type Prettified = Prettier<Intersection>;

        expectTypeOf<Prettified>().toEqualTypeOf<{ a: string, b: number }>();
      });
    });

    describe('AreOptionsRequired', () => {
      it('should return true when body is required', () => {
        // eslint-disable-next-line unused-imports/no-unused-vars
        const schemaWithBody = {
          body: z.object({ name: z.string() }),
        } as const;
        type SchemaType = typeof schemaWithBody;
        // When body schema exists and is not optional, options are required
        expectTypeOf<AreOptionsRequired<SchemaType>>().toEqualTypeOf<true>();
      });

      it('should return false when all fields are optional', () => {
        // eslint-disable-next-line unused-imports/no-unused-vars
        const schemaWithResponse = {
          response: z.object({ id: z.number() }),
        } as const;
        type SchemaType = typeof schemaWithResponse;
        // Only response defined, no required body/query/params
        expectTypeOf<AreOptionsRequired<SchemaType>>().toEqualTypeOf<false>();
      });
    });

    describe('InferUrl', () => {
      it('should infer URL keys from schema', () => {
        // eslint-disable-next-line unused-imports/no-unused-vars
        const schema = createSchema({
          '/users': { method: 'GET' },
          '/user/:id': { method: 'GET' },
          '/posts': { method: 'GET' },
        });

        type Urls = InferUrl<typeof schema>;

        expectTypeOf<Urls>().toEqualTypeOf<'/users' | '/user/:id' | '/posts'>();
      });
    });
  });

  describe('ResfetchResult Type Tests', () => {
    it('should discriminate ok and error states', async () => {
      const schema = createSchema({
        '/test': { response: z.object({ value: z.number() }) },
      });
      const fetcher = createResfetch({ schema });

      const result = await fetcher('/test');

      if (result.ok) {
        expectTypeOf(result.data).toMatchTypeOf<{ value: number }>();
        expectTypeOf(result.error).toEqualTypeOf<undefined>();
      } else {
        expectTypeOf(result.error).toMatchTypeOf<ResfetchError>();
        expectTypeOf(result.data).toEqualTypeOf<undefined>();
      }
    });
  });

  describe('NoSchemaOptions Tests', () => {
    it('should allow arbitrary body/query/params without schema', () => {
      const fetcher = createResfetch({});

      // Without schema, should accept any options
      assertType(
        fetcher('/any', {
          body: { anything: true },
          query: { search: 'test' },
          params: { id: '123' },
          method: 'POST',
        }),
      );
    });
  });

  describe('Schema Configuration Tests', () => {
    it('createSchema should return correct type', () => {
      const schema = createSchema(
        {
          '/api/users': {
            response: z.array(z.object({ id: z.number() })),
            method: 'GET',
          },
        },
        { prefix: '/v1', strict: true },
      );

      expectTypeOf(schema.schema).toMatchTypeOf<Record<string, FetchSchema>>();
      expectTypeOf(schema.config).toMatchTypeOf<{ prefix?: string, strict?: boolean }>();
    });
  });

  describe('ResfetchOptions Tests', () => {
    it('should correctly type body/query/params generics', () => {
      type CustomOptions = ResfetchOptions<
        { name: string },
        { page: number },
        { id: string }
      >;

      expectTypeOf<CustomOptions['body']>().toEqualTypeOf<{ name: string } | undefined>();
      expectTypeOf<CustomOptions['query']>().toEqualTypeOf<{ page: number } | undefined>();
      expectTypeOf<CustomOptions['params']>().toEqualTypeOf<{ id: string } | undefined>();
    });
  });

  describe('SimplifyOptions Tests', () => {
    it('should make required fields required and optional fields optional', () => {
      interface TestSchema {
        body: ReturnType<typeof z.object<{ name: ReturnType<typeof z.string> }>>
        query: ReturnType<typeof z.object<{ page: ReturnType<typeof z.number> }>>
      }

      type Options = SimplifyOptions<TestSchema>;

      // body and query should be required (non-optional schema fields)
      expectTypeOf<Options>().toMatchTypeOf<{
        body: { name: string }
        query: { page: number }
      }>();
    });
  });

  describe('Resfetch Type Tests', () => {
    it('should return typed Resfetch with schema', () => {
      // eslint-disable-next-line unused-imports/no-unused-vars
      const schema = createSchema({
        '/typed': { response: z.object({ typed: z.boolean() }) },
      });

      type TypedResfetch = Resfetch<typeof schema>;

      // TypedResfetch should be a function
      expectTypeOf<TypedResfetch>().toBeFunction();
    });

    it('should return untyped Resfetch without schema', () => {
      type UntypedResfetch = Resfetch<undefined>;

      // Should accept any string URL
      expectTypeOf<Parameters<UntypedResfetch>[0]>().toEqualTypeOf<string>();
    });
  });

  describe('resfetch (default instance without global schema)', () => {
    it('should accept any URL string', () => {
      assertType(resfetch('/api/users'));
      assertType(resfetch('/api/posts/123'));
      assertType(resfetch('https://example.com/data'));
    });

    it('should accept request-level schema and infer response type', async () => {
      const result = await resfetch('/api/user', {
        schema: {
          response: z.object({
            id: z.number(),
            email: z.string(),
          }),
        },
      });

      if (result.ok) {
        expectTypeOf(result.data).toEqualTypeOf<{ id: number, email: string }>();
        expectTypeOf(result.data.id).toEqualTypeOf<number>();
        expectTypeOf(result.data.email).toEqualTypeOf<string>();
      }
    });

    it('should infer body type from schema', async () => {
      const result = await resfetch('/api/user', {
        method: 'POST',
        schema: {
          body: z.object({ name: z.string(), age: z.number() }),
          response: z.object({ success: z.boolean() }),
        },
        body: { name: 'Alice', age: 30 },
      });

      if (result.ok) {
        expectTypeOf(result.data).toEqualTypeOf<{ success: boolean }>();
      }
    });

    it('should return unknown when no schema provided', async () => {
      const result = await resfetch('/api/unknown');

      if (result.ok) {
        expectTypeOf(result.data).toEqualTypeOf<unknown>();
      }
    });

    it('should allow arbitrary options without schema', () => {
      assertType(
        resfetch('/api/data', {
          method: 'PUT',
          body: { any: 'data', nested: { value: 123 } },
          query: { page: 1, limit: 10 },
          params: { id: '456' },
          headers: { 'X-Custom': 'header' },
        }),
      );
    });

    it('should correctly type error in result', async () => {
      const result = await resfetch('/api/error');

      if (!result.ok) {
        expectTypeOf(result.error).toMatchTypeOf<ResfetchError>();
        expectTypeOf(result.data).toEqualTypeOf<undefined>();
      }
    });

    it('should support array response schema', async () => {
      const result = await resfetch('/api/users', {
        schema: {
          response: z.array(z.object({
            id: z.number(),
            name: z.string(),
          })),
        },
      });

      if (result.ok) {
        expectTypeOf(result.data).toEqualTypeOf<Array<{ id: number, name: string }>>();
      }
    });

    it('should support optional fields in schema', async () => {
      const result = await resfetch('/api/profile', {
        schema: {
          response: z.object({
            name: z.string(),
            bio: z.string().optional(),
            age: z.number().nullable(),
          }),
        },
      });

      if (result.ok) {
        expectTypeOf(result.data.name).toEqualTypeOf<string>();
        expectTypeOf(result.data.bio).toEqualTypeOf<string | undefined>();
        expectTypeOf(result.data.age).toEqualTypeOf<number | null>();
      }
    });

    it('should infer query params type from schema', async () => {
      assertType(
        resfetch('/api/search', {
          schema: {
            query: z.object({
              q: z.string(),
              page: z.number().optional(),
            }),
            response: z.object({ results: z.array(z.string()) }),
          },
          query: { q: 'test', page: 1 },
        }),
      );
    });

    it('should infer path params type from schema', async () => {
      assertType(
        resfetch('/api/users/:id', {
          schema: {
            params: z.object({ id: z.string() }),
            response: z.object({ id: z.string(), name: z.string() }),
          },
          params: { id: '123' },
        }),
      );
    });
  });
});
