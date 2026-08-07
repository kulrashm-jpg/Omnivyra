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

/**
 * OR-09 — resolve the AUTHENTICATED principal that owns this idempotency record.
 *
 * `resolvePrincipal` is the repository's canonical identity entry point
 * (IdentityResolver.ts header) and the only resolver covering EVERY
 * authentication path the existing adopters use: Supabase Bearer/cookie,
 * DB-backed auth_session, and the legacy super-admin bridge. The lighter
 * `resolveAuthenticatedUser` handles only the Supabase paths and would 401 the
 * super-admin routes that make up most of the current adopters.
 *
 * This is AUTHENTICATION, not authorization — it answers "who is calling",
 * never "may they touch this tenant". That distinction is what makes caller
 * scoping possible without the async, resource-derived tenant lookup that
 * blocked the alternatives (OR-09 §Constraints).
 *
 * Imported DYNAMICALLY, following the convention lib/platform/policyGate.ts
 * established: IdentityResolver carries a module-load side-effect import
 * (`./platformCapabilities`) that THROWS on a capability-isolation violation.
 * A static import here would pull that into every module that imports this
 * middleware, including the 29 existing adopters.
 */
async function resolveCallerId(req: NextApiRequest): Promise<string | null> {
  try {
    const { resolvePrincipal } = await import('../security/IdentityResolver');
    const result = await resolvePrincipal(req);
    if (result.ok !== true) return null;

    // ── D-2: legacy bridge principals must NOT share one identity ───────────
    // legacyCookieSuperAdminBridge.ts:110 assigns every bridge principal the
    // SAME constant userId ('legacy:cookie-super-admin'), so scoping on it
    // would let two bridge operators replay each other's requests — the very
    // defect caller scoping exists to remove.
    //
    // The bridge credential is a shared env username/password, so no per-human
    // identity exists at the identity layer. The signed cookie VALUE is however
    // minted per login: stable for one operator's session, distinct between
    // operators. Hashing it yields a stable, non-shared scoping key.
    //
    // This derives an idempotency scoping key ONLY. Authentication,
    // authorization, and bridge behaviour are untouched — `principal.userId`
    // is not modified and nothing here grants or denies access.
    if (result.principal?.legacyCookieSuperAdmin === true) {
      const raw = readBridgeCookieValue(req);
      if (!raw) return null; // fail closed — no cookie, no stable identity
      return `bridge:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
    }

    const userId = result.principal?.userId;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch {
    // Fail CLOSED. A resolution failure must never degrade to an unscoped
    // lookup — that is precisely the exposure this change closes.
    return null;
  }
}

/**
 * Read the raw signed bridge cookie for D-2 scoping-key derivation.
 *
 * Deliberately NOT an authentication step and NOT a second bridge
 * implementation: `resolvePrincipal` has already authenticated the caller by
 * the time this runs. This only extracts the opaque cookie value to derive a
 * per-session scoping key, and never parses, validates or trusts it.
 */
function readBridgeCookieValue(req: NextApiRequest): string | null {
  const cookies = req.headers?.cookie || '';
  const m = cookies.match(/(?:^|; )super_admin_session=([^;]+)/);
  return m?.[1] ?? null;
}

/**
 * D-1 — legacy compatibility for records written before OR-09.
 *
 * Those rows carry `caller_id IS NULL` (no owner was recorded). Without this,
 * a key completed before deploy and retried after would MISS the caller-scoped
 * lookup and re-execute the handler — running business logic a second time for
 * no reason other than the row's age.
 *
 * Deliberately narrow:
 *   • explicitly `caller_id IS NULL` — NOT an unscoped lookup; a new,
 *     caller-owned record can never be found by this path;
 *   • `status = 'completed'` ONLY — a legacy row is a read-only replay source.
 *     It can never be claimed, locked, reclaimed, mutated, or used to block a
 *     new request, so lock and conflict semantics are untouched;
 *   • consulted ONLY after the caller-scoped lookup misses.
 *
 * ACCEPTED RESIDUAL: a pre-OR-09 completed row has no owner, so any caller
 * presenting its key with a matching payload can replay it. That is inherent —
 * ownership cannot be reconstructed for rows that never recorded it. The set is
 * finite, never grows (no new NULL rows can be written), and is confined to the
 * 29 pre-existing admin adopters.
 */
async function loadLegacyCompleted(scope: string, key: string): Promise<IdempotencyRecord | null> {
  const { data, error } = await ownedDbTable('api_idempotency_keys')
    .select('id, idempotency_key, status, request_hash, response_status, response_body, locked_at, request_id')
    .eq('scope', scope)
    .is('caller_id', null)
    .eq('idempotency_key', key)
    .eq('status', 'completed')
    .maybeSingle();

  if (error) throw new Error(`IDEMPOTENCY_LEGACY_LOOKUP_FAILED:${error.message}`);
  return (data as IdempotencyRecord | null) ?? null;
}

async function loadExisting(scope: string, callerId: string, key: string): Promise<IdempotencyRecord | null> {
  const { data, error } = await ownedDbTable('api_idempotency_keys')
    .select('id, idempotency_key, status, request_hash, response_status, response_body, locked_at, request_id')
    .eq('scope', scope)
    .eq('caller_id', callerId)
    .eq('idempotency_key', key)
    .maybeSingle();

  if (error) throw new Error(`IDEMPOTENCY_LOOKUP_FAILED:${error.message}`);
  return (data as IdempotencyRecord | null) ?? null;
}

async function createRecord(scope: string, callerId: string, key: string, requestHash: string, requestId: string): Promise<void> {
  const { error } = await ownedDbTable('api_idempotency_keys').insert({
    scope,
    caller_id: callerId,
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
  callerId: string,
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
    .eq('caller_id', callerId)
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

    // OR-09 — caller scoping. Resolved BEFORE any cache access so there is no
    // code path that reads or writes a record without an owner. An
    // unauthenticated (or unresolvable) caller is rejected outright rather than
    // falling back to an unscoped lookup: the whole point of this change is
    // that a cache entry belongs to exactly one principal.
    //
    // The handler still performs its own authentication and authorization,
    // unchanged. This resolution is solely for record ownership.
    const callerId = await resolveCallerId(req);
    if (!callerId) {
      return res.status(401).json({ error: 'Unauthorized', code: 'IDEMPOTENCY_PRINCIPAL_REQUIRED' });
    }

    const run = async () => {
      let existing = await loadExisting(scope, callerId, idempotencyKey);

      // D-1: before creating anything, honour a pre-OR-09 completed record for
      // this key. Replay-only — the legacy row is never claimed or mutated, so
      // no lock, conflict or ownership semantics change. A hash mismatch falls
      // through to the normal caller-scoped path exactly as it would today.
      if (!existing) {
        const legacy = await loadLegacyCompleted(scope, idempotencyKey);
        if (legacy && legacy.request_hash === requestHash) {
          return res
            .status(legacy.response_status ?? 200)
            .json((legacy.response_body as any) ?? { ok: true, replayed: true });
        }
      }

      if (!existing) {
        try {
          await createRecord(scope, callerId, idempotencyKey, requestHash, requestId);
          existing = await loadExisting(scope, callerId, idempotencyKey);
        } catch (error: any) {
          if (error?.code !== '23505') throw error;
          existing = await loadExisting(scope, callerId, idempotencyKey);
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
          .eq('caller_id', callerId)
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
          .eq('caller_id', callerId)
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
        await markRecord(scope, callerId, idempotencyKey, {
          status: statusCode >= 500 ? 'failed' : 'completed',
          response_status: statusCode,
          response_body: body,
          last_error: statusCode >= 500 ? JSON.stringify(body) : null,
        });
        return originalJson(body);
      };

      try {
        await markRecord(scope, callerId, idempotencyKey, { status: 'processing', last_error: null });
        await handler(req, res);
      } catch (error: any) {
        await markRecord(scope, callerId, idempotencyKey, {
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
