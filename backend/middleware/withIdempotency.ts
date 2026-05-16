import { createHash } from 'crypto';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { getOrCreateRequestId, runWithRequestContext } from '../services/requestContext';
import { ownedDbTable } from '../db/writeOwner';

type IdempotencyRecord = {
  id: string;
  idempotency_key: string;
  status: 'processing' | 'completed' | 'failed';
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  locked_at: string | null;
  request_id: string | null;
};

type Options = {
  methods?: string[];
  scope?: string;
  /**
   * A `processing` row whose `locked_at` is older than this many milliseconds
   * is considered abandoned (the handler that set it crashed/was killed
   * before finalizing). The next request for the same key reclaims the lock
   * via a guarded UPDATE instead of returning 409 forever. Defaults to
   * IDEMPOTENCY_STALE_LOCK_MS env (or 10 minutes). Replay protection is
   * unaffected — COMPLETED rows still short-circuit before this branch, and
   * the financial ledger's UNIQUE idempotency_key remains the real
   * double-settlement guard.
   */
  staleLockMs?: number;
};

const DEFAULT_STALE_LOCK_MS = Number(process.env.IDEMPOTENCY_STALE_LOCK_MS ?? '') || 10 * 60 * 1000;

function parseBody(req: NextApiRequest): unknown {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return req.body;
    }
  }
  return req.body ?? null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function buildRequestHash(req: NextApiRequest, scope: string): string {
  const payload = {
    scope,
    method: req.method ?? 'GET',
    query: req.query,
    body: parseBody(req),
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

async function loadExisting(scope: string, key: string): Promise<IdempotencyRecord | null> {
  const { data, error } = await ownedDbTable('api_idempotency_keys')
    .select('id, idempotency_key, status, request_hash, response_status, response_body, locked_at, request_id')
    .eq('scope', scope)
    .eq('idempotency_key', key)
    .maybeSingle();

  if (error) throw new Error(`IDEMPOTENCY_LOOKUP_FAILED:${error.message}`);
  return (data as IdempotencyRecord | null) ?? null;
}

async function createRecord(scope: string, key: string, requestHash: string, requestId: string): Promise<void> {
  const { error } = await ownedDbTable('api_idempotency_keys').insert({
    scope,
    idempotency_key: key,
    request_hash: requestHash,
    status: 'processing',
    request_id: requestId,
    locked_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function markRecord(
  scope: string,
  key: string,
  patch: Partial<{
    status: 'processing' | 'completed' | 'failed';
    response_status: number;
    response_body: unknown;
    last_error: string | null;
  }>,
): Promise<void> {
  const { error } = await ownedDbTable('api_idempotency_keys')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      locked_at: patch.status === 'processing' ? new Date().toISOString() : null,
    })
    .eq('scope', scope)
    .eq('idempotency_key', key);
  if (error) throw new Error(`IDEMPOTENCY_UPDATE_FAILED:${error.message}`);
}

export function withIdempotency(
  handler: NextApiHandler,
  options: Options = {},
): NextApiHandler {
  const methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()));
  const scope = options.scope ?? 'default';
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;

  return async (req: NextApiRequest, res: NextApiResponse) => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (!methods.has(method)) {
      const requestId = getOrCreateRequestId(req);
      res.setHeader('X-Request-Id', requestId);
      return runWithRequestContext({ requestId, correlationId: requestId }, () => handler(req, res));
    }

    const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header required', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }

    const requestId = getOrCreateRequestId(req);
    const requestHash = buildRequestHash(req, scope);
    res.setHeader('X-Request-Id', requestId);

    const run = async () => {
      let existing = await loadExisting(scope, idempotencyKey);
      if (!existing) {
        try {
          await createRecord(scope, idempotencyKey, requestHash, requestId);
          existing = await loadExisting(scope, idempotencyKey);
        } catch (error: any) {
          if (error?.code !== '23505') throw error;
          existing = await loadExisting(scope, idempotencyKey);
        }
      }

      if (!existing) {
        return res.status(500).json({ error: 'Failed to initialize idempotency state' });
      }

      if (existing.request_hash !== requestHash) {
        return res.status(409).json({ error: 'Idempotency key reused with different payload', code: 'IDEMPOTENCY_CONFLICT' });
      }

      if (existing.status === 'completed') {
        return res
          .status(existing.response_status ?? 200)
          .json((existing.response_body as any) ?? { ok: true, replayed: true });
      }

      if (existing.status === 'processing') {
        // Ownership short-circuit: if THIS request created the row (its
        // request_id is on the row), the lock is ours — proceed to execute.
        // This is what lets a brand-new request run: createRecord() stamps
        // the row with our requestId, loadExisting() reads it back, and we
        // recognize it as our own rather than treating it as a concurrent
        // in-flight request.
        if (existing.request_id && existing.request_id === requestId) {
          // fall through to handler execution
        } else {
        // Is the in-flight holder provably dead? A `processing` row whose
        // `locked_at` is older than the stale window means the handler that
        // set it crashed/was killed before finalizing. Reclaim the lock via
        // a guarded UPDATE so a fresh request is not blocked forever.
        const lockedAtMs = existing.locked_at ? Date.parse(existing.locked_at) : NaN;
        const isStale =
          !existing.locked_at ||
          (Number.isFinite(lockedAtMs) && Date.now() - lockedAtMs > staleLockMs);

        if (!isStale) {
          // A genuinely active request holds the lock — correct to reject.
          return res.status(409).json({
            error: 'Request with this Idempotency-Key is already in progress',
            code: 'IDEMPOTENCY_IN_PROGRESS',
          });
        }

        // Stale-lock takeover. The WHERE clause re-asserts status='processing'
        // AND the same stale `locked_at`, so exactly one concurrent reclaimer
        // can win; the loser falls through to the 409 below. Replay
        // protection is unaffected: COMPLETED rows already short-circuited
        // above, and the ledger's UNIQUE idempotency_key prevents double
        // settlement even if a takeover races a late-finishing original.
        const staleCutoffIso = new Date(Date.now() - staleLockMs).toISOString();
        let takeover = ownedDbTable('api_idempotency_keys')
          .update({
            status: 'processing',
            request_id: requestId,
            request_hash: requestHash,
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_error: 'stale_lock_reclaimed',
          })
          .eq('scope', scope)
          .eq('idempotency_key', idempotencyKey)
          .eq('status', 'processing');
        // Only reclaim rows that are actually stale (older than cutoff) OR
        // have a null lock timestamp. This prevents stealing a lock that was
        // refreshed between our read and this write.
        takeover = existing.locked_at
          ? takeover.lt('locked_at', staleCutoffIso)
          : takeover.is('locked_at', null);

        const { data: reclaimed, error: takeoverErr } = await takeover
          .select('id')
          .maybeSingle();

        if (takeoverErr) {
          return res.status(500).json({ error: 'Failed to reclaim stale idempotency lock' });
        }
        if (!reclaimed) {
          // Another concurrent request won the takeover, or the original
          // finished and finalized the row between our read and write.
          return res.status(409).json({
            error: 'Request with this Idempotency-Key is already in progress',
            code: 'IDEMPOTENCY_IN_PROGRESS',
          });
        }
        // We own the lock now — fall through to execute the handler.
        } // end else (not our own freshly-created lock)
      }

      if (existing.status === 'failed') {
        const { data: updated, error } = await ownedDbTable('api_idempotency_keys')
          .update({
            status: 'processing',
            request_id: requestId,
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('scope', scope)
          .eq('idempotency_key', idempotencyKey)
          .eq('status', 'failed')
          .select('id')
          .maybeSingle();
        if (error) {
          return res.status(500).json({ error: 'Failed to resume idempotent request' });
        }
        if (!updated) {
          return res.status(409).json({ error: 'Request with this Idempotency-Key is already in progress', code: 'IDEMPOTENCY_IN_PROGRESS' });
        }
      }

      const originalStatus = res.status.bind(res);
      const originalJson = res.json.bind(res);

      let statusCode = 200;
      let capturedBody: unknown;

      (res as any).status = (code: number) => {
        statusCode = code;
        return originalStatus(code);
      };

      (res as any).json = async (body: unknown) => {
        capturedBody = body;
        await markRecord(scope, idempotencyKey, {
          status: statusCode >= 500 ? 'failed' : 'completed',
          response_status: statusCode,
          response_body: body,
          last_error: statusCode >= 500 ? JSON.stringify(body) : null,
        });
        return originalJson(body);
      };

      try {
        await markRecord(scope, idempotencyKey, { status: 'processing', last_error: null });
        await handler(req, res);
      } catch (error: any) {
        await markRecord(scope, idempotencyKey, {
          status: 'failed',
          response_status: statusCode >= 400 ? statusCode : 500,
          response_body: capturedBody ?? { error: 'Internal server error' },
          last_error: error?.message ?? String(error),
        });
        throw error;
      }
    };

    return runWithRequestContext(
      {
        requestId,
        correlationId: requestId,
        idempotencyKey,
      },
      run,
    );
  };
}
