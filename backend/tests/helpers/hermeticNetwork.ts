/**
 * Hermetic network seam for unit suites whose code paths reach external providers.
 *
 * WHY THIS EXISTS. DG-001 moved Report 1's SERP request from `axios.get` to `fetch`
 * (backend/services/serp/canonicalSerpClient.ts). Suites that still mocked `axios`
 * silently stopped intercepting that request and began calling serpapi.com for real.
 * A mock of one HTTP client is not a network boundary; this is.
 *
 * Two outbound paths exist in the code these suites exercise, and both are closed:
 *
 *   1. global `fetch` — replaced by {@link installHermeticFetch}. A request is answered
 *      by the suite's `route` function; anything the route does not claim REJECTS, the
 *      way an unreachable network would, and is recorded in `refused`.
 *   2. `lib/security/safeFetch` — it issues requests through undici directly, so a
 *      global `fetch` stub never sees them. {@link hermeticSafeFetchModule} is the
 *      `jest.mock` factory body that makes every call through it reject.
 *
 * Neither path ever reaches a socket.
 */

export type HermeticRequest = {
  readonly url: URL;
  readonly init: RequestInit | undefined;
};

/** What a route returns for a request it claims. `undefined` = not claimed (refused). */
export type HermeticReply = { status?: number; body: unknown };

export type HermeticRoute = (
  request: HermeticRequest,
) => HermeticReply | Promise<HermeticReply> | undefined;

export type HermeticFetchHandle = {
  /** Every request the route claimed, in order. */
  readonly answered: HermeticRequest[];
  /** Every request nothing claimed — each one was rejected, never sent. */
  readonly refused: string[];
  /** Put the original `fetch` back. */
  restore(): void;
};

export class HermeticNetworkError extends Error {
  constructor(target: string) {
    super(`hermetic-network: ${target} is unreachable from this test suite`);
    this.name = 'HermeticNetworkError';
  }
}

const describeTarget = (url: URL): string => `${url.protocol}//${url.host}${url.pathname}`;

/**
 * Replace global `fetch` for the calling suite. `route` decides what is answered; a
 * route that throws makes the request reject with that error, which is how a suite
 * simulates a transport failure.
 */
export function installHermeticFetch(route: HermeticRoute): HermeticFetchHandle {
  const original = globalThis.fetch;
  const answered: HermeticRequest[] = [];
  const refused: string[] = [];

  const stub = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : String((input as { url?: string })?.url ?? input);
    const url = new URL(raw);
    const signal = init?.signal ?? null;
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');

    const request: HermeticRequest = { url, init };
    const reply = await route(request);
    if (reply === undefined) {
      refused.push(describeTarget(url));
      throw new HermeticNetworkError(describeTarget(url));
    }
    answered.push(request);
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    } as unknown as Response;
  };

  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  return {
    answered,
    refused,
    restore: () => { globalThis.fetch = original; },
  };
}

/**
 * `jest.mock('<path>/lib/security/safeFetch', () => hermeticSafeFetchModule())`.
 *
 * Keeps the module's real non-network exports (errors, URL validation types) and
 * replaces the two functions that open connections with ones that reject.
 */
export function hermeticSafeFetchModule(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const actual = jest.requireActual('../../../lib/security/safeFetch') as Record<string, unknown>;
  const refuse = async (rawUrl: unknown): Promise<never> => {
    let target = String(rawUrl);
    try { target = describeTarget(new URL(target)); } catch { /* keep the raw string */ }
    throw new HermeticNetworkError(target);
  };
  return { ...actual, safeFetch: refuse, safeFetchBuffer: refuse };
}
