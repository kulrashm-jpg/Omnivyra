/**
 * Reusable Supabase mock factory.
 * Provides COMPLETE chainable query builder with all standard methods.
 * Use for Jest integration tests to avoid live Supabase/network calls.
 *
 * Supported chain: .select() .insert() .update() .delete() .upsert()
 *   .eq() .neq() .in() .or() .gte() .lte()
 *   .order() .limit()
 *   .single() .maybeSingle()
 *   + .then() for await
 */

// PB-010: the `jest` package exports no `Mock` type; the mock-function type is
// `jest.Mock` from the ambient @types/jest namespace. The previous
// `import type { Mock } from 'jest'` resolved to an error type (TS2305), which
// silently degraded every `createMockFn()` call site to `any`. This is a
// type-only correction — `import type` is fully erased, so no runtime change.

// Create mock function type for use in buildChain
const createMockFn = (): jest.Mock => {
  if (typeof jest !== 'undefined' && jest.fn) {
    return jest.fn();
  }
  // Fallback for non-Jest environments
  return (() => {}) as any;
};

export type TableResponses =
  | Record<string, { data: any; error: any }>
  | ((table: string) => { data: any; error: any });

const defaultResponse = { data: [], error: null };

function buildChain(table: string, getResponse: (t: string) => { data: any; error: any }) {
  const resp = () => getResponse(table);

  const chain: any = {
    select: createMockFn().mockReturnThis(),
    insert: createMockFn().mockReturnThis(),
    update: createMockFn().mockReturnThis(),
    upsert: createMockFn().mockReturnThis(),
    delete: createMockFn().mockReturnThis(),
    eq: createMockFn().mockReturnThis(),
    neq: createMockFn().mockReturnThis(),
    in: createMockFn().mockReturnThis(),
    or: createMockFn().mockReturnThis(),
    gte: createMockFn().mockReturnThis(),
    lte: createMockFn().mockReturnThis(),
    order: createMockFn().mockReturnThis(),
    limit: createMockFn().mockReturnThis(),
    single: createMockFn().mockImplementation(() => {
      const { data, error } = resp();
      const singleData = Array.isArray(data) ? (data[0] ?? null) : data;
      return Promise.resolve({ data: singleData, error });
    }),
    maybeSingle: createMockFn().mockImplementation(() => {
      const { data, error } = resp();
      const singleData = Array.isArray(data) ? (data[0] ?? null) : data;
      return Promise.resolve({ data: singleData, error });
    }),
  };

  chain.then = function (resolve: any, reject?: any) {
    const result = resp();
    const { data } = result;
    const arrayData = Array.isArray(data) ? data : data != null ? [data] : [];
    return Promise.resolve({ ...result, data: arrayData }).then(resolve, reject);
  };

  return chain;
}

export function createSupabaseMock(responses?: TableResponses) {
  const getResponse: (table: string) => { data: any; error: any } =
    typeof responses === 'function'
      ? responses
      : (table) => (responses && responses[table]) || defaultResponse;

  const from = jest.fn((table: string) => buildChain(table, getResponse));
  const rpc = jest.fn().mockResolvedValue({ data: null, error: null });

  return { from, rpc };
}
