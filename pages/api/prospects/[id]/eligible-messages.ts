import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/prospects/:id/eligible-messages — the stored messages this prospect
 * could be quoted from.
 *
 * ─── WHY IT EXISTS ────────────────────────────────────────────────────────
 * `POST /api/prospects/:id/problems` with `source: { messageId }` lets the
 * server derive a problem observation from one stored message, and it refuses
 * most messages: a row with no author, an author who is not this prospect, a
 * message from a third party in the prospect's thread, no source timestamp, or
 * no text. All four refusals are correct and none of them is visible to an
 * operator looking at a thread. This endpoint shows ONLY what the server would
 * actually accept, so a pick cannot be a guess that must fail.
 *
 * It is a convenience, never a grant: the capture path re-reads and re-verifies
 * the row it is given, and listing a message here authorises nothing.
 *
 * ─── GET ONLY ─────────────────────────────────────────────────────────────
 * Nothing here records, claims or reserves anything, so there is no second verb
 * and no body. A method this surface does not serve is 405 with `Allow: GET`
 * and executes nothing — not even a membership lookup.
 *
 * ─── MEMBERSHIP ONLY, AND NO CAPABILITY IS MINTED ─────────────────────────
 * `requireTenantAccess` against live membership, bound to a `companyId` that
 * comes from the QUERY ONLY. No capability is required, and that is a decision
 * rather than an omission: there is no read-oriented prospect capability in
 * `shared/contracts/security`, NONE MAY BE MINTED for a read, and requiring the
 * admin-tier `PROSPECT_INGEST` grant in order to LOOK at which of the tenant's
 * own stored messages are quotable would be the wrong trade. The sibling
 * `GET /api/prospects/:id/problems` sets the precedent — it is gated on
 * membership alone and returns the prospect's statements in full. This read is
 * strictly WEAKER than one that already ships: it returns a capped preview of
 * messages the same tenant already stores and already reads on the engagement
 * surface, and it returns no author identity at all.
 *
 * The prospect id in the path is not authorization either: the service
 * re-resolves it under the verified tenant, through the same resolver the
 * capture path uses, and every relation read below carries either its own tenant
 * predicate or a thread id that a tenant-filtered query produced.
 *
 * ─── ELIGIBILITY IS SERVER-SIDE AND NOT WIDENABLE ─────────────────────────
 * This route accepts exactly four parameters: `companyId`/`company_id`, the path
 * `id`, `subjectType` and `limit`. Nothing else is read, so an unknown
 * parameter cannot relax a rule — there is no `includeOutbound`, no
 * `includeUndated` and no place for one to be added by accident. `limit` only
 * NARROWS, and is clamped by the service besides.
 *
 * ─── WHAT IT RETURNS, AND WHAT IT DELIBERATELY WILL NOT ───────────────────
 * Per message: the id to capture with, its thread, the channel, a capped preview
 * with an explicit `truncated` flag, the SOURCE's own instant, and the subject
 * the statement would be attributed to.
 *
 * It never returns `raw_payload` (which carries `sender_username`,
 * `sender_profile_url` and `sender_name`), never the author's name, handle,
 * profile url or avatar — publishing a third party's identity under a prospect's
 * record is a disclosure, not a feature — and never `sentiment_score`,
 * `like_count` or `reply_count`, which belong to the engagement surface and
 * would arrive here as an implied ranking.
 *
 * Excluded rows are reported as COUNTS ONLY, with no ids and no text: an
 * operator must be able to see why a list is short without the excluded rows
 * being published under the prospect's record.
 *
 * ─── WHAT THE CLIENT IS AND IS NOT TOLD ───────────────────────────────────
 * A prospect in another tenant is reported EXACTLY as an absent one — 404
 * `prospect_not_found` — so this route is not a cross-tenant existence oracle.
 * An unreadable store is 503 `eligible_messages_unavailable` and never an empty
 * 200: "there is nothing to pick" and "we could not look" are different answers
 * and only the second is worth retrying.
 *
 * `subjectType=account` is a 200 with an empty list and the reason stated: a
 * thread links to a PERSON, and one employee speaking is not the company
 * stating a problem.
 *
 * ─── IT SCORES NOTHING ────────────────────────────────────────────────────
 * No score, dimension, weight, rank or priority is produced or accepted. The
 * order is the source's own chronology, newest first.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../../backend/security/TenantGuard';
import { PROSPECT_API_VERSION } from '../../../../backend/apiHandlers/prospects/prospectIntelligenceRead';
import { PROBLEM_OBSERVATION_CONTRACT_VERSION } from '../../../../backend/services/prospectProblems/types';
import { readEligibleProspectMessages } from '../../../../backend/services/prospectProblems/eligibleProspectMessages';

/**
 * Local `str` and `UUID`, duplicated per file on purpose: that is the
 * convention on this surface (`problems.ts` and `enrich.ts` each carry their
 * own), and a shared route helper module would couple unrelated endpoints'
 * validation together.
 */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * A uuid is checked HERE rather than left to the membership lookup, which would
 * send a malformed value to Postgres, get a `22P02`, and have it classified as a
 * membership failure — answering 403 "access denied" for what is a malformed
 * request, and spending a round trip on unvalidated input.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every envelope leads with the API version, then the contract it speaks. */
const envelope = <T extends Record<string, unknown>>(body: T) =>
  ({ version: PROSPECT_API_VERSION, contract: PROBLEM_OBSERVATION_CONTRACT_VERSION, ...body });

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json(envelope({ error: 'method_not_allowed' }));
  }

  // The tenant comes from the QUERY ONLY. There is no body on this surface, and
  // no header or session value is consulted for it.
  const companyId = str(req.query.companyId) ?? str(req.query.company_id);
  if (!companyId) return res.status(400).json(envelope({ error: 'companyId is required' }));
  if (!UUID.test(companyId)) return res.status(400).json(envelope({ error: 'companyId must be a uuid' }));

  // Membership-verified. Writes its own 401/403, audits the decision, and
  // returns null — returning here is what stops a denied request continuing.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const prospectId = str(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!prospectId) return res.status(400).json(envelope({ error: 'prospect id is required' }));
  if (!UUID.test(prospectId)) return res.status(400).json(envelope({ error: 'prospect id must be a uuid' }));

  const subjectType = str(req.query.subjectType) ?? 'person';
  if (subjectType !== 'person' && subjectType !== 'account') {
    return res.status(400).json(envelope({ error: "subjectType must be 'person' or 'account'" }));
  }

  const limitRaw = str(req.query.limit);
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return res.status(400).json(envelope({ error: 'limit must be a positive number' }));
  }

  try {
    const result = await readEligibleProspectMessages({
      organizationId: companyId,          // the VERIFIED tenant, never a claim
      prospectId,
      subjectType,
      limit,
    });

    if (result.ok !== true) {
      if (result.refusal === 'store_unavailable') {
        return res.status(503).json(envelope({
          error: 'eligible_messages_unavailable', retryable: true,
        }));
      }
      // `subject_other_tenant` is answered exactly as `subject_not_found`. The
      // service keeps the distinction, in logs only.
      return res.status(404).json(envelope({ error: 'prospect_not_found' }));
    }

    return res.status(200).json(envelope({
      eligibility: result.version,
      subjectType: result.subjectType,
      subjectId: result.subjectId,
      reason: result.reason,
      messages: result.messages,
      ineligible: result.ineligible,
    }));
  } catch {
    // Nothing from the failure reaches the caller: a store message can echo
    // request input, and this route has no reason to repeat one.
    return res.status(503).json(envelope({
      error: 'eligible_messages_unavailable', retryable: true,
    }));
  }
}

export default __createApiRoute(handler, { route: '/api/prospects/[id]/eligible-messages' });
