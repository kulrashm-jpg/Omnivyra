import { AsyncLocalStorage } from 'async_hooks';
import type { NextApiRequest } from 'next';
import { randomUUID, createHash } from 'crypto';

export type RequestContext = {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  orgId?: string;
  idempotencyKey?: string;
  // Foundation Batch A (F-03) — additive optional fields; existing readers are
  // unaffected. traceId is the cross-boundary trace identifier (defaults to
  // correlationId); meta is a small request-scoped metadata bag.
  traceId?: string;
  meta?: Record<string, unknown>;
};

const requestContextStore = new AsyncLocalStorage<RequestContext>();

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

export function getOrCreateRequestId(req?: NextApiRequest): string {
  const existing =
    (req && normalizeHeaderValue(req.headers['x-request-id'])) ||
    (req && normalizeHeaderValue(req.headers['x-correlation-id'])) ||
    randomUUID();
  return existing;
}

export function deriveRequestId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStore.run(ctx, fn);
}

export function getRequestContext(): RequestContext {
  return requestContextStore.getStore() ?? {};
}

export function mergeRequestContext(patch: Partial<RequestContext>): RequestContext {
  const next = { ...getRequestContext(), ...patch };
  requestContextStore.enterWith(next);
  return next;
}

export function seedRequestContextFromRequest(
  req: NextApiRequest,
  patch: Partial<RequestContext> = {},
): RequestContext {
  const current = getRequestContext();
  const requestId = current.requestId || getOrCreateRequestId(req);
  const correlationId =
    current.correlationId ||
    normalizeHeaderValue(req.headers['x-correlation-id']) ||
    requestId;
  const idempotencyKey =
    current.idempotencyKey ||
    normalizeHeaderValue(req.headers['idempotency-key']);

  return mergeRequestContext({
    requestId,
    correlationId,
    idempotencyKey,
    ...patch,
  });
}
