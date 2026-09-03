import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/outreach/outcomes
 *
 * PI-P1-W09D — the operator seam for recording what actually happened after an
 * outreach task was dispatched.
 *
 * WS-3 M7 shipped the ingestion FUNCTION and said so plainly: "No route calls
 * `ingestFeedback` yet… no provider can reach it in production today." This is
 * that route, for the one source that needs no provider: a human who knows the
 * outcome and is authenticated.
 *
 * ─── IT RECORDS. IT DECIDES NOTHING. ──────────────────────────────────────
 * `ingestFeedback` remains the sole authoritative write path. This module does
 * not persist an outcome, does not look up a task, does not build an envelope
 * and does not own a single feedback rule. It authenticates, pins the fields a
 * client must never control, and hands the event to the existing seam.
 *
 * ─── TENANT TIER, NOT PLATFORM TIER ───────────────────────────────────────
 * Deliberately NOT under `/api/super-admin/`. Activating and approving outreach
 * are platform acts — they trigger real execution against an arbitrary tenant —
 * but recording that a prospect replied is tenant business data, and requiring
 * the platform tier for it would mean the one super-admin principal in
 * production is the only person who could ever record an outcome.
 *
 * `requireTenantAccess` is the canonical guard for new code and covers both
 * legitimate callers in one decision: an active member of the named tenant, and
 * a platform super-admin acting on an EXPLICITLY named tenant. Bridge
 * principals are rejected by the guard itself.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED ──────────────────────────────────
 * `companyId` arrives in the body and is NEVER trusted as authorization — the
 * guard validates it against live membership and organisation state. This is
 * the opposite of the `activeOrgId` mistake BILLING-ACTIVE-ORG-AUTHZ-SEC-001
 * closed: a context pointer is not a credential. TenantGuard is explicit that
 * there is no "active_company_id" inference and the caller must pass the exact
 * tenant they intend to act on.
 *
 * ─── TASK OWNERSHIP IS PROVED ONCE, DOWNSTREAM ────────────────────────────
 * There is no task lookup here. `ingestFeedback` already resolves
 * `getOutreachTaskById(companyId, taskId)` and answers `task_not_found` for a
 * task belonging to another tenant. A second lookup would put a second copy of
 * the ownership rule outside the ingestion path — so ownership is enforced
 * twice independently (guard: may this operator act on this tenant; ingestion:
 * does this task belong to it) without the rule being written twice.
 *
 * ─── PILOT VOCABULARY IS NARROWER THAN THE CONTRACT ───────────────────────
 * Only the four signals a human can honestly observe are accepted here. The
 * ingestion taxonomy is NOT changed; this is a subset, and a test asserts every
 * member of it is a real `FeedbackSignal` so the two cannot drift.
 *
 * ─── NO IDEMPOTENCY KEY ───────────────────────────────────────────────────
 * The database already owns it: `(company_id, task_id, outcome_type,
 * occurred_at)` is unique, and a repeat is reported as `duplicate: true` with
 * `ok: true`. That is the expected steady state, not an error, and adding an
 * application-level check in front of it would be a race, not a guarantee.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  ingestFeedback,
  type FeedbackSignal,
} from '../../../backend/services/leadOutreachExecution';

/**
 * The signals an operator may record in the pilot.
 *
 * A deliberate SUBSET of `FEEDBACK_SIGNALS`, not a new vocabulary:
 *   • `delivered` / `bounced` are the DELIVERY axis — a transport's report
 *     about a message's fate, not a human's observation of a recipient.
 *   • `opened` / `clicked` are in `UNOBSERVABLE_BUSINESS_OUTCOMES`. No
 *     transport in this platform emits them and an operator cannot honestly
 *     claim to have seen one.
 *   • `unsubscribed` is compliance-bearing and does not yet feed suppression,
 *     so accepting it would record an obligation the platform will not act on.
 *   • `rejected` is not an ingestible signal at all — WS-3 M7 excluded it
 *     because it is a human judgement, and admitting it here would change the
 *     taxonomy rather than use it.
 */
export const MANUAL_OUTCOME_SIGNALS = [
  'replied',
  'meeting_booked',
  'converted',
  'no_response',
] as const;
export type ManualOutcomeSignal = (typeof MANUAL_OUTCOME_SIGNALS)[number];

/**
 * COMPILE-TIME DRIFT GUARD. If a signal above ever stops being a real
 * `FeedbackSignal` — because the ingestion vocabulary changed — this
 * assignment fails to compile. That is the point: the pilot list is a SUBSET of
 * the contract, and a subset that silently stops being one is how a route
 * starts inventing a taxonomy.
 */
const _signalsAreRealFeedbackSignals: readonly FeedbackSignal[] = MANUAL_OUTCOME_SIGNALS;
void _signalsAreRealFeedbackSignals;

const isManualSignal = (v: unknown): v is ManualOutcomeSignal =>
  typeof v === 'string' && (MANUAL_OUTCOME_SIGNALS as readonly string[]).includes(v);

/**
 * Fields the SERVER owns. A request naming any of them is refused rather than
 * silently corrected: a caller that sends `source: 'provider_webhook'` and
 * receives a 200 would reasonably believe it was honoured, and the whole point
 * of this route is that a manual outcome is attributable to a person.
 */
const SERVER_OWNED_FIELDS = ['source', 'provider', 'providerEventId', 'derived', 'recordedByUserId'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as Record<string, unknown>;

  const companyId = str(body.companyId);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  // AUTHORIZATION FIRST, and before any other input is read. The guard writes
  // its own 401/402/403 and returns null; returning here is what stops a denied
  // request continuing into ingestion.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const supplied = SERVER_OWNED_FIELDS.filter((f) => body[f] !== undefined);
  if (supplied.length > 0) {
    return res.status(400).json({ error: 'server_owned_field', fields: supplied });
  }

  const taskId = str(body.taskId);
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });

  const occurredAt = str(body.occurredAt);
  if (!occurredAt) return res.status(400).json({ error: 'occurredAt is required' });

  // Shape only. WHETHER the timestamp parses is `ingestFeedback`'s rule and is
  // left to it, so there is one answer to "is this a valid instant".
  const signal = body.signal;
  if (!isManualSignal(signal)) {
    return res.status(400).json({ error: 'unsupported_signal', allowed: [...MANUAL_OUTCOME_SIGNALS] });
  }

  const note = str(body.note);

  const result = await ingestFeedback({
    companyId,
    taskId,
    signal,
    occurredAt,
    // Pinned. Never client-supplied.
    source: 'manual',
    // "Null for manual, import and internal sources" — a manual entry has no
    // provider and therefore no provider event to deduplicate against.
    provider: null,
    providerEventId: null,
    evidence: note ? { note } : undefined,
    // The actor comes from the guard's authenticated principal, never the body.
    // `outreach_outcomes` has no actor column and does not need one: metadata is
    // jsonb, and the platform logger already stamps user/org/correlation ids.
    metadata: { recordedByUserId: tenant.userId },
  });

  if (result.ok) return res.status(200).json(result);

  // The existing rejection vocabulary is passed through verbatim — no parallel
  // error vocabulary is invented here. Only the HTTP status is chosen.
  if (result.rejection === 'task_not_found') return res.status(404).json(result);
  if (result.rejection === 'write_failed') return res.status(500).json(result);
  return res.status(400).json(result);
}

export default __createApiRoute(handler, { route: '/api/outreach/outcomes' });
