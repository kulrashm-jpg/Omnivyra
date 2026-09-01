/**
 * Idempotency for `/api/bolt/execute`.
 *
 * One user action produced two campaigns and two executions 1.6 seconds apart:
 * identical title, identical company, identical user, distinct campaign rows.
 * The endpoint's only duplicate guard keys off `generatedCampaignId`, which is
 * absent when BOLT is launched from a recommendation card — so nothing stopped
 * the second submission, and the campaign id that WOULD have collided is not
 * created until the pipeline's first stage, long after both runs exist.
 *
 * The boundary is therefore the REQUEST, not the campaign: a deterministic
 * fingerprint over the fields that define what the user asked for. Two
 * submissions of the same intent produce the same fingerprint; changing any
 * meaningful parameter produces a different one.
 *
 * Scope of the guard is deliberately LIVE runs only (`started` / `running`).
 * That preserves every legitimate repeat:
 *   - a failed run does not block re-running the same strategy;
 *   - a completed run does not block deliberately running it again;
 *   - a stale run stops blocking as soon as recovery marks it failed.
 * Nothing here expires on a timer — the run's own lifecycle IS the window.
 */

import { createHash } from 'crypto';

/** Fields that define a BOLT request's identity. */
export type BoltRequestIdentity = {
  companyId: string;
  userId: string | null;
  recId: unknown;
  sourceOpportunityId: unknown;
  generatedCampaignId: unknown;
  outcomeView: unknown;
  title: unknown;
  executionConfig: unknown;
  sourceStrategicTheme: unknown;
};

/**
 * Deterministic JSON: object keys sorted at every depth so that two structurally
 * equal payloads serialize identically regardless of property order. Without
 * this, `{a:1,b:2}` and `{b:2,a:1}` would fingerprint differently and the guard
 * would silently never match.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalize);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
  return out;
}

/**
 * Reduce a strategic theme to its identity. The full object carries generated
 * prose that can differ between two renders of the SAME theme, which would make
 * an identical user action fingerprint differently and defeat the guard.
 */
function themeIdentity(theme: unknown): unknown {
  if (!theme || typeof theme !== 'object') return null;
  const t = theme as Record<string, unknown>;
  return {
    id: t.id ?? null,
    title: t.title ?? null,
    polished_title: t.polished_title ?? null,
  };
}

/**
 * Stable fingerprint of a BOLT execution request.
 *
 * Deliberately EXCLUDES anything the server derives after the request arrives
 * (`sibling_differential`, timestamps, run ids) — including any of those would
 * make every request unique and the guard inert.
 */
export function computeBoltRequestFingerprint(identity: BoltRequestIdentity): string {
  const material = canonicalize({
    v: 1,
    company_id: identity.companyId,
    user_id: identity.userId ?? null,
    rec_id: identity.recId ?? null,
    source_opportunity_id: identity.sourceOpportunityId ?? null,
    generated_campaign_id: identity.generatedCampaignId ?? null,
    outcome_view: identity.outcomeView ?? null,
    title: identity.title ?? null,
    execution_config: identity.executionConfig ?? null,
    strategic_theme: themeIdentity(identity.sourceStrategicTheme),
  });
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

/** Payload key the fingerprint is stamped under (JSONB — no schema change). */
export const BOLT_IDEMPOTENCY_PAYLOAD_KEY = 'idempotency_key';

/**
 * Does this PostgREST error represent the live-request uniqueness index
 * rejecting a concurrent duplicate?
 *
 * Only meaningful once the prepared migration is applied; before that the index
 * does not exist, this never matches, and the pre-insert check remains the only
 * layer. Written now so applying the index needs no code change.
 */
export const BOLT_LIVE_REQUEST_UNIQUE_INDEX = 'uidx_bolt_runs_live_request_fingerprint';

export function isLiveBoltRequestDuplicateViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  if (String(e.code ?? '') !== '23505') return false;
  const haystack = `${String(e.message ?? '')} ${String(e.details ?? '')}`;
  return haystack.includes(BOLT_LIVE_REQUEST_UNIQUE_INDEX);
}
