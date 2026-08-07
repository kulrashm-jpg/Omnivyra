import { ownedDbTable } from '../db/writeOwner';
import { recordSessionPersistence, type DbErrorClass } from './leadIntelligenceTelemetry';
import type { AttributionPayload } from './leadAttributionService';
import { buildTouchSnapshot } from './leadAttributionService';

/**
 * WS-2 M1A (1) — SESSION PERSISTENCE FAILURE TAXONOMY.
 *
 * Supabase reports failures two different ways: PostgREST errors come back as
 * `{ error }`, while transport failures (socket reset, DNS, abort, fetch
 * timeout) THROW. Handling only the first leaves the second able to escape
 * `resolveVisitorSession` and reach lead capture — which would break the one
 * thing this stack must never break. Every database interaction below is
 * therefore routed through `safeDb`, and its failure classified here.
 */
function classifyDbError(err: unknown): DbErrorClass {
  const code = String((err as { code?: string } | null)?.code ?? '');
  const message = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase();

  if (code === '23505') return 'conflict';
  if (code === '42P01') return 'missing_table'; // undefined_table — migration missing
  if (code === '42501' || code === '28000' || code === '28P01' || code.startsWith('PGRST3')) return 'permission';
  // 40001 serialization_failure · 40P01 deadlock · 25P02 aborted transaction · 08xxx connection
  if (code === '40001' || code === '40P01' || code === '25P02' || code.startsWith('08')) return 'transient';
  if (code === '57014' || message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('aborted')
  ) {
    return 'transient';
  }
  return 'unknown';
}

/** Retried once: the operation is safe to repeat and the cause is momentary. */
const RETRYABLE: ReadonlySet<DbErrorClass> = new Set<DbErrorClass>(['transient', 'timeout']);

const errorDetail = (err: unknown): string =>
  String((err as { message?: string } | null)?.message ?? err ?? 'unknown error').slice(0, 300);

/**
 * Runs one database call and NEVER throws — a thrown transport error is
 * normalized into the same `{ error }` shape PostgREST returns, so callers
 * have exactly one failure path to handle.
 */
async function safeDb<T>(
  // PromiseLike, not Promise: PostgrestBuilder is thenable but not a Promise.
  op: () => PromiseLike<{ data?: T; error?: unknown }>,
): Promise<{ data: T | null; error: unknown | null }> {
  try {
    const res = await op();
    return { data: (res?.data ?? null) as T | null, error: res?.error ?? null };
  } catch (err) {
    return { data: null, error: err ?? new Error('unknown database failure') };
  }
}

/**
 * INT-001 Phase 1 — visitor-session intelligence, computed best-effort at
 * session creation from the visitor's OWN prior sessions in the SAME tenant:
 * visit count, returning flag, first-visit timestamp. Bounded read; any
 * failure degrades to null (the session write proceeds exactly as before).
 *
 * WS-2 M1B — PRODUCTION DEFECT FIXED (found by real-database execution proof).
 *
 * This read ordered and selected `created_at`, a column `visitor_sessions` does
 * NOT have (it has `started_at`). PostgREST answered every call with 42703, and
 * because it REPORTS that as `{ error }` rather than throwing, the `catch`
 * never fired: `prior.data` was null, `rows` fell to `[]`, and the function
 * returned a fabricated **first visit ever** — `visit_count: 1`,
 * `returning_visitor: false` — for every session of every returning visitor.
 *
 * Verified against the real database:
 *   GET /visitor_sessions?select=created_at&order=created_at.asc
 *     → {"code":"42703","message":"column visitor_sessions.created_at does not exist"}
 *
 * Consequence: the durable loyalty signals WS-2 M1 consumes were never written,
 * so `visitor_loyalty` and `return_cadence` could never fire in production. This
 * is the same defect class as the `snapshotSource` ordering bug — a column that
 * does not exist, hidden by a fail-open path. The error is now inspected, and a
 * failure degrades to null rather than inventing a first visit.
 */
const VISITOR_HISTORY_CAP = 50;

async function readVisitorHistory(companyId: string, anonymousId: string, nowIso: string): Promise<Record<string, unknown> | null> {
  const prior = await safeDb<Array<{ started_at?: string }>>(() =>
    ownedDbTable('visitor_sessions')
      .select('started_at')
      .eq('company_id', companyId)
      .eq('anonymous_id', anonymousId)
      .order('started_at', { ascending: true })
      .limit(VISITOR_HISTORY_CAP),
  );

  if (prior.error) {
    // Never fabricate history: an unknown past must stay unknown, or every
    // returning visitor silently becomes a first-time one.
    recordSessionPersistence({
      outcome: 'read_failed',
      errorClass: classifyDbError(prior.error),
      detail: errorDetail(prior.error),
      companyId,
    });
    return null;
  }

  try {
    const rows = Array.isArray(prior.data) ? prior.data : [];
    return {
      visit_count: rows.length + 1,
      returning_visitor: rows.length > 0,
      first_visit_at: rows[0]?.started_at ?? nowIso,
      latest_visit_at: nowIso,
    };
  } catch {
    // Mapping a malformed payload must not escape either — fail-safe, and
    // still without fabricating a history. (Guard retained from INT-001 P1.)
    return null;
  }
}

export async function resolveVisitorSession(input: {
  companyId: string;
  websiteId?: string | null;
  attribution: AttributionPayload;
  /**
   * WS-2 M2 — visitor context parsed ONCE by the caller (per request, not per
   * event) and persisted into `visitor_sessions.metadata.device` / `.geo`,
   * exactly as M1 does for `.visitor`. Optional: a caller that cannot resolve
   * them passes nothing and the session is written exactly as before.
   */
  visitorContext?: { device?: unknown; geo?: unknown } | null;
}): Promise<{ sessionId: string | null; firstTouch: Record<string, unknown>; lastTouch: Record<string, unknown> }> {
  // Only non-empty blocks are persisted, so an unresolvable user-agent or a
  // request with no edge geography never writes an object full of nulls.
  const contextBlock: Record<string, unknown> = {};
  if (input.visitorContext?.device) contextBlock.device = input.visitorContext.device;
  if (input.visitorContext?.geo) contextBlock.geo = input.visitorContext.geo;
  const anonymousId = input.attribution.anonymous_id || input.attribution.session_id;
  const sessionKey = input.attribution.session_id || anonymousId;
  const lastTouch = input.attribution.last_touch ?? buildTouchSnapshot(input.attribution);
  if (!anonymousId || !sessionKey) return { sessionId: null, firstTouch: lastTouch, lastTouch };

  // WS-2 M1A (1): a failed lookup is NOT "no session" — it is an unknown. It is
  // reported, then the insert path runs anyway: it either creates the row or
  // hits the unique index and adopts the existing one, so the session survives
  // a read outage instead of silently forking.
  const existing = await safeDb<Record<string, unknown>>(() =>
    ownedDbTable('visitor_sessions')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('anonymous_id', anonymousId)
      .eq('session_key', sessionKey)
      .maybeSingle(),
  );
  if (existing.error) {
    recordSessionPersistence({
      outcome: 'read_failed',
      errorClass: classifyDbError(existing.error),
      detail: errorDetail(existing.error),
      companyId: input.companyId,
    });
  }

  const firstTouch = (existing.data as any)?.first_touch && Object.keys((existing.data as any).first_touch).length > 0
    ? (existing.data as any).first_touch as Record<string, unknown>
    : input.attribution.first_touch ?? lastTouch;

  if (existing.data?.id) {
    const nowIso = new Date().toISOString();
    // INT-001 Phase 1 (session continuation): merge — never replace — the
    // stored metadata, refreshing the journey snapshot and the duration.
    const existingMetadata = ((existing.data as any).metadata && typeof (existing.data as any).metadata === 'object'
      ? (existing.data as any).metadata
      : {}) as Record<string, unknown>;
    const existingVisitor = (existingMetadata.visitor && typeof existingMetadata.visitor === 'object'
      ? existingMetadata.visitor
      : {}) as Record<string, unknown>;
    // WS-2 M1B: was `created_at` — a column this table does not have — so the
    // parse was always NaN and `session_duration_ms` was always null. Measured
    // duration now actually measures.
    const startedAtMs = Date.parse(String((existing.data as any).started_at ?? ''));
    // WS-2 M1A (1): the refresh result was previously discarded. The session id
    // is still valid either way — only the journey snapshot goes stale — so
    // this reports and continues rather than degrading the id.
    const refreshed = await safeDb(() =>
      ownedDbTable('visitor_sessions')
      .update({
        website_id: input.websiteId ?? (existing.data as any).website_id ?? null,
        last_current_page: input.attribution.current_page ?? (existing.data as any).last_current_page ?? null,
        last_referrer: input.attribution.referrer ?? (existing.data as any).last_referrer ?? null,
        last_touch: lastTouch,
        consent_state: input.attribution.consent_state ?? (existing.data as any).consent_state ?? null,
        last_seen_at: nowIso,
        metadata: {
          ...existingMetadata,
          ...(input.attribution.metadata ?? {}),
          // WS-2 M2: refresh device/geo on continuation — the same visitor can
          // switch device mid-session (phone → laptop) and the latest reading
          // is the useful one. Absent context leaves the stored block intact.
          ...contextBlock,
          visitor: {
            ...existingVisitor,
            latest_visit_at: nowIso,
            session_duration_ms: Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : null,
          },
        },
      })
        .eq('id', existing.data.id),
    );
    if (refreshed.error) {
      recordSessionPersistence({
        outcome: 'refresh_failed',
        errorClass: classifyDbError(refreshed.error),
        detail: errorDetail(refreshed.error),
        companyId: input.companyId,
      });
    }
    return { sessionId: existing.data.id as string, firstTouch, lastTouch };
  }

  const nowIso = new Date().toISOString();
  const visitorStats = await readVisitorHistory(input.companyId, anonymousId, nowIso);
  const insertRow = () =>
    ownedDbTable('visitor_sessions')
    .insert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      anonymous_id: anonymousId,
      session_key: sessionKey,
      first_landing_page: input.attribution.landing_page ?? input.attribution.current_page ?? null,
      last_current_page: input.attribution.current_page ?? null,
      first_referrer: input.attribution.referrer ?? null,
      last_referrer: input.attribution.referrer ?? null,
      utm_source: input.attribution.utm_source ?? null,
      utm_medium: input.attribution.utm_medium ?? null,
      utm_campaign: input.attribution.utm_campaign ?? null,
      utm_content: input.attribution.utm_content ?? null,
      utm_term: input.attribution.utm_term ?? null,
      first_touch: firstTouch,
      last_touch: lastTouch,
      consent_state: input.attribution.consent_state ?? null,
      metadata: {
        ...(input.attribution.metadata ?? {}),
        ...contextBlock,
        ...(visitorStats ? { visitor: visitorStats } : {}),
      },
    })
      .select('id')
      .single();

  let inserted = await safeDb<{ id?: string }>(insertRow);

  /**
   * WS-2 M1A (1) — ONE bounded retry, for transient classes only.
   *
   * Unlike a tracking event, a lost session is not recoverable later: the lead
   * row keeps `visitor_session_id = null` forever, and the snapshot loader
   * keys events and sessions off that id — so the lead permanently loses its
   * entire behavioural spine over one momentary socket error. A single
   * immediate retry (no sleep, no backoff loop, so the capture path gains no
   * measurable latency) removes that permanent loss. Permission, missing-table
   * and unknown classes are NOT retried: repeating them cannot succeed.
   */
  if (inserted.error) {
    const firstClass = classifyDbError(inserted.error);
    if (RETRYABLE.has(firstClass)) {
      recordSessionPersistence({
        outcome: 'insert_retried',
        errorClass: firstClass,
        detail: errorDetail(inserted.error),
        companyId: input.companyId,
      });
      inserted = await safeDb<{ id?: string }>(insertRow);
    }
  }

  /**
   * WS-2 M1 (3) — SESSION PERSISTENCE HARDENING.
   *
   * Previously this returned `inserted.data?.id ?? null` and never inspected
   * the error, so a failed insert degraded silently to `sessionId: null` —
   * which severs the lead from its own journey (no session row, no stitch, no
   * touchpoint backfill) with nothing recorded anywhere.
   *
   * Outcomes, in order:
   *
   *  • UNIQUE VIOLATION (23505) — a concurrent request created the same
   *    (company_id, anonymous_id, session_key) between our read above and this
   *    insert. That row is exactly the one we wanted, so we re-read and adopt
   *    it. This is a normal race, not an error, and it makes duplicate session
   *    creation safe without changing the database.
   *
   *    Deliberately NOT an upsert: `uq_visitor_sessions_company_anon_session`
   *    is a PARTIAL unique index, and PostgREST's `onConflict` cannot express
   *    the index predicate, so `ON CONFLICT` would fail index inference
   *    (42P10). Read-back is the correct recovery within the frozen schema.
   *
   *  • ANY OTHER ERROR — classified and reported through the existing
   *    diagnostics seam so it is visible by failure family, then degraded
   *    exactly as before. The capture path stays fail-open: a session failure
   *    must never break a lead write, and by construction can no longer throw.
   */
  if (inserted.error) {
    const errorClass = classifyDbError(inserted.error);
    const detail = errorDetail(inserted.error);

    if (errorClass === 'conflict') {
      const readBack = () =>
        ownedDbTable('visitor_sessions')
          .select('id')
          .eq('company_id', input.companyId)
          .eq('anonymous_id', anonymousId)
          .eq('session_key', sessionKey)
          .maybeSingle();

      // WS-2 M1A (1): the conflict PROVES the row exists — only the read-back
      // stands between us and its id. A transient failure here would throw away
      // a session we know is there, so it gets the same one-shot retry as the
      // insert. (Found by M1A concurrency validation.)
      let raced = await safeDb<{ id?: string }>(readBack);
      if (raced.error && RETRYABLE.has(classifyDbError(raced.error))) {
        recordSessionPersistence({
          outcome: 'insert_retried',
          errorClass: classifyDbError(raced.error),
          detail: errorDetail(raced.error),
          companyId: input.companyId,
        });
        raced = await safeDb<{ id?: string }>(readBack);
      }
      const recoveredId = raced.data?.id ?? null;
      if (recoveredId) {
        recordSessionPersistence({ outcome: 'recovered_conflict', errorClass });
        return { sessionId: recoveredId, firstTouch, lastTouch };
      }
      recordSessionPersistence({
        outcome: 'conflict_unrecovered',
        errorClass: raced.error ? classifyDbError(raced.error) : errorClass,
        detail: raced.error ? errorDetail(raced.error) : detail,
        companyId: input.companyId,
      });
      return { sessionId: null, firstTouch, lastTouch };
    }

    recordSessionPersistence({ outcome: 'insert_failed', errorClass, detail, companyId: input.companyId });
    return { sessionId: null, firstTouch, lastTouch };
  }

  const sessionId = inserted.data?.id ?? null;
  if (!sessionId) {
    // Insert reported success but returned no id — still a lost session.
    recordSessionPersistence({
      outcome: 'missing_id',
      detail: 'insert succeeded without returning an id',
      companyId: input.companyId,
    });
  }
  return { sessionId, firstTouch, lastTouch };
}

export async function stitchSessionToLead(input: {
  leadId: string;
  companyId: string;
  visitorSessionId?: string | null;
  unifiedPersonId?: string | null;
}): Promise<void> {
  if (!input.visitorSessionId) return;
  await ownedDbTable('visitor_sessions')
    .update({
      unified_person_id: input.unifiedPersonId ?? null,
      stitched_at: new Date().toISOString(),
    })
    .eq('id', input.visitorSessionId)
    .eq('company_id', input.companyId);

  await ownedDbTable('campaign_touchpoints')
    .update({ lead_id: input.leadId })
    .eq('visitor_session_id', input.visitorSessionId)
    .eq('company_id', input.companyId)
    .is('lead_id', null);
}

export async function persistCampaignTouchpoint(input: {
  companyId: string;
  websiteId?: string | null;
  visitorSessionId?: string | null;
  leadId?: string | null;
  attribution: AttributionPayload;
  touchpointType: 'first_touch' | 'last_touch' | 'event' | 'conversion';
}): Promise<void> {
  const source = input.attribution.utm_source ?? input.attribution.referrer ?? 'direct';
  try {
    await ownedDbTable('campaign_touchpoints').insert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      visitor_session_id: input.visitorSessionId ?? null,
      lead_id: input.leadId ?? null,
      touchpoint_type: input.touchpointType,
      source,
      medium: input.attribution.utm_medium ?? null,
      campaign: input.attribution.utm_campaign ?? null,
      content: input.attribution.utm_content ?? null,
      term: input.attribution.utm_term ?? null,
      page_url: input.attribution.current_page ?? input.attribution.landing_page ?? null,
      asset_id: input.attribution.asset_id ?? null,
      variant_id: input.attribution.variant_id ?? null,
      creator_strategy_id: input.attribution.creator_strategy_id ?? null,
      metadata: {
        attribution: buildTouchSnapshot(input.attribution),
        // INT-001 Phase 1 (additive): deterministic client-side timestamp for
        // timeline ordering + the journey snapshot when the client sent one.
        captured_at: new Date().toISOString(),
        ...(input.attribution.metadata && typeof (input.attribution.metadata as Record<string, unknown>).journey === 'object'
          ? { journey: (input.attribution.metadata as Record<string, unknown>).journey }
          : {}),
      },
    });
  } catch {
    // Campaign touchpoints are best-effort until the aggregation worker owns retries.
  }
}
