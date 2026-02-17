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

export type TableResponses =
  | Record<string, { data: any; error: any }>
  | ((table: string) => { data: any; error: any });

const defaultResponse = { data: [], error: null };

function buildChain(table: string, getResponse: (t: string) => { data: any; error: any }) {
  const resp = () => getResponse(table);

  const chain: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockImplementation(() => {
      const { data, error } = resp();
      const singleData = Array.isArray(data) ? (data[0] ?? null) : data;
      return Promise.resolve({ data: singleData, error });
    }),
    maybeSingle: jest.fn().mockImplementation(() => {
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
