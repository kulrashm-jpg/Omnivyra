/**
 * HARDEN-001 — API instrumentation wrapper.
 *
 * Zero-behavior wrapper for Next.js API handlers: measures request duration,
 * status distribution, endpoint frequency, and payload sizes. It NEVER alters
 * the request/response, headers, status, or body — it only observes. Wired once
 * into the shared withContract() wrapper so a large fraction of routes are
 * covered without touching individual handlers.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { recordApi } from './metrics';
import { observabilityConfig } from './config';
import { newRequestDbStats, runWithRequestDbScope } from './requestScope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONGHEX_RE = /^[0-9a-f]{16,}$/i;

/** Collapse high-cardinality path segments (ids) to `:id` for stable series. */
export function normalizeRoute(url: string | undefined): string {
  try {
    const path = (url ?? '').split('?')[0] || '/';
    return path
      .split('/')
      .map((seg) => {
        if (!seg) return seg;
        if (UUID_RE.test(seg)) return ':id';
        if (LONGHEX_RE.test(seg)) return ':id';
        if (/^\d+$/.test(seg)) return ':id';
        return seg;
      })
      .join('/') || '/';
  } catch {
    return 'unknown';
  }
}

function reqBytes(req: NextApiRequest): number | undefined {
  const cl = req.headers['content-length'];
  const n = Array.isArray(cl) ? Number(cl[0]) : Number(cl);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Wrap a handler so each invocation is observed. Fail-safe: if instrumentation
 * setup throws, the original handler runs unwrapped.
 */
export function withApiObservability(handler: NextApiHandler, staticRoute?: string): NextApiHandler {
  if (!observabilityConfig.enabled || !observabilityConfig.api) return handler;

  return async function observedHandler(req: NextApiRequest, res: NextApiResponse) {
    let start: number;
    let route: string;
    let resBytes = 0;
    let recorded = false;
    // HARDEN-001A: per-request DB stats object, mutated by recordDb via the ALS
    // scope and read back here on finish (closure survives the event callback).
    const dbStats = newRequestDbStats();
    try {
      start = performance.now();
      route = staticRoute || normalizeRoute(req.url);

      // Tap res.json / res.send to size the body — additive, forwards verbatim.
      // W0-1 transparency: the wrapper mirrors the original function's
      // introspection state (jest mock `.mock` / `_isMockFunction`, or any
      // properties a caller stashed on res.json) so replacing the function
      // reference is invisible to code that inspects it after the call.
      const mirror = <F extends (...args: never[]) => unknown>(orig: unknown, wrapped: F): F => {
        try {
          const src = orig as Record<string, unknown>;
          const dst = wrapped as unknown as Record<string, unknown>;
          for (const key of ['mock', '_isMockFunction', 'getMockName', 'mockName']) {
            if (src && key in (src as object)) dst[key] = src[key];
          }
        } catch { /* fail-safe */ }
        return wrapped;
      };
      const origJsonFn = res.json;
      const origJson = origJsonFn.bind(res);
      (res as NextApiResponse).json = mirror(origJsonFn, ((body: unknown) => {
        try { resBytes += Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? '')); } catch { /* ignore */ }
        return origJson(body);
      }) as NextApiResponse['json']);
      const origSendFn = res.send;
      const origSend = origSendFn.bind(res);
      (res as NextApiResponse).send = mirror(origSendFn, ((body: unknown) => {
        try {
          if (typeof body === 'string') resBytes += Buffer.byteLength(body);
          else if (Buffer.isBuffer(body)) resBytes += body.length;
        } catch { /* ignore */ }
        return origSend(body);
      }) as NextApiResponse['send']);

      const finalize = (errored: boolean) => {
        if (recorded) return;
        recorded = true;
        try {
          recordApi({
            route,
            method: (req.method || 'GET').toUpperCase(),
            status: res.statusCode || (errored ? 500 : 200),
            durationMs: performance.now() - start,
            reqBytes: reqBytes(req),
            resBytes: resBytes || undefined,
            error: errored,
            db: dbStats,
          });
        } catch { /* fail-safe */ }
      };

      res.on('finish', () => finalize(false));
      res.on('close', () => finalize(false));

      // Run the handler inside the DB-profiling scope so every DB query issued
      // during this request accumulates into dbStats.
      try {
        return await runWithRequestDbScope(dbStats, () => handler(req, res));
      } catch (err) {
        finalize(true);
        throw err;
      }
    } catch {
      // Instrumentation-setup failure must never break the route.
      return handler(req, res);
    }
  };
}
