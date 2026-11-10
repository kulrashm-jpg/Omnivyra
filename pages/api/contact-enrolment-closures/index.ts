import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * G-11 — a company admin closes a prospect to NEW journeys, or reopens it.
 *
 * Owner ruling (2026-11-07), verbatim: "new journey gets closed while prospect is closed and once
 * it is opened by admin it will be open for new journeys. only copany admin can close or reopen
 * the prospect"; and "Also a manual close".
 *
 *   GET  /api/contact-enrolment-closures?company_id=<uuid>&prospect_id=<uuid>
 *        -> { status: { closed, gate: 'optout_review' | 'manual' | null, reviewId, closureId }, closures: [history] }
 *   POST /api/contact-enrolment-closures?company_id=<uuid>   (or company_id in the body)
 *        { action: 'close', prospectId, reason }    -> 201 { closure }
 *        { action: 'reopen', prospectId, reason }   -> 200 { closure }
 *
 * TWO GATES (contactEnrolmentClosure.ts): an opt-out review that touches the prospect (pending, or
 * decided keep_closed), and a MANUAL closure. A reopen here clears the MANUAL gate only; while a
 * review still holds it is refused with 409 `closed_by_optout_review` and that review's id — a
 * review is reopened only by deciding it (/api/contact-optout-reviews/:id). Only NEW journeys are
 * gated; a run already active is not ended by a close.
 *
 * Refusals: 400 `invalid_prospect`, `reason_required` (1–500 characters), bad action/ids; 403
 * `company_admin_required`; 404 `prospect_not_found`, `not_closed`; 409 `already_closed`,
 * `closed_by_optout_review`; 503 `closure_unavailable`; 405.
 *
 * AUDIT: every close and reopen is written to execution_audit (stage `control`; `blocked` for a
 * close, `allowed` for a reopen; reason `contact_enrolment_closed` / `contact_enrolment_reopened`),
 * with the prospect and closure ids only — never the reason text or any address.
 *
 * ─── AUTHORIZATION ────────────────────────────────────────────────────────
 * Exactly as /api/contact-optout-reviews: enforceCompanyAccess, then COMPANY_ADMIN in THIS company
 * from TenantGuard.assertTenantAccess with `noPlatformBypass` (a bypass grant is refused again, and
 * a company-scoped SUPER_ADMIN role is refused). The actor is the authenticated principal.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { assertTenantAccess } from '../../../backend/security/TenantGuard';
import { normalizePermissionRole, Role } from '../../../backend/services/rbacService';
import { recordExecutionAudit } from '../../../backend/services/execution/executionAuditService';
import { durableIntelligencePort } from '../../../backend/services/orchestration/individualIntelligence';
import {
  closeProspectToJourneys, listEnrolmentClosures, readContactEnrolmentClosure, reopenProspectToJourneys, type ClosureRefusal,
} from '../../../backend/services/orchestration/contactEnrolmentClosure';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

/** As contact-optout-reviews: COMPANY_ADMIN by active membership in THIS company; no bypass. */
async function isCompanyAdmin(userId: string, companyId: string): Promise<boolean> {
  const decision = await assertTenantAccess({ userId, organizationId: companyId, options: { noPlatformBypass: true } });
  if (decision.ok !== true || decision.access.bypass) return false;
  return normalizePermissionRole(String(decision.access.role ?? '').trim().toUpperCase()) === Role.COMPANY_ADMIN;
}

const STATUS: Record<ClosureRefusal, number> = {
  invalid_prospect: 400, reason_required: 400, actor_required: 401, prospect_not_found: 404, not_closed: 404,
  already_closed: 409, closed_by_optout_review: 409, closure_unavailable: 503,
};

/** The prospect's person and canonical addresses, read through the same port enrolment uses. */
async function prospectContacts(companyId: string, prospectId: string): Promise<{ ok: boolean; personId: string | null; email: string | null; phone: string | null }> {
  const person = await durableIntelligencePort.resolvePerson(companyId, { kind: 'prospect', id: prospectId }).catch(() => ({ ok: false, personId: null }));
  if (!person.ok) return { ok: false, personId: null, email: null, phone: null };
  if (person.personId === null) return { ok: true, personId: null, email: null, phone: null };
  const contacts = await durableIntelligencePort.readPersonContacts(companyId, person.personId).catch(() => null);
  if (contacts === null) return { ok: false, personId: person.personId, email: null, phone: null };
  return { ok: true, personId: person.personId, email: contacts.email, phone: contacts.phone };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  if (!(await isCompanyAdmin(access.userId, companyId))) {
    return res.status(403).json({ error: 'only an admin of this company closes or reopens its prospects', code: 'company_admin_required' });
  }

  const prospectId = str(req.query.prospect_id) ?? str(body.prospectId);
  if (!prospectId || !UUID.test(prospectId)) return res.status(400).json({ error: 'prospectId must be a uuid', code: 'invalid_prospect' });

  if (req.method === 'GET') {
    const who = await prospectContacts(companyId, prospectId);
    const state = who.ok ? await readContactEnrolmentClosure({ organizationId: companyId, prospectId, ...who }) : null;
    const history = await listEnrolmentClosures(companyId, prospectId);
    if (state === null || state.ok !== true || history.ok !== true) {
      return res.status(503).json({ error: 'the closure state could not be read', code: 'closure_unavailable' });
    }
    return res.status(200).json({
      status: {
        closed: state.state.closed,
        gate: state.state.closed ? state.state.gate : null,
        reviewId: state.reviewHold,
        closureId: state.manualHold,
      },
      closures: history.value,
    });
  }

  const action = str(body.action);
  if (action !== 'close' && action !== 'reopen') return res.status(400).json({ error: "action is 'close' or 'reopen'", code: 'invalid_action' });

  if (action === 'close') {
    const closed = await closeProspectToJourneys({ organizationId: companyId, prospectId, reason: body.reason, actorUserId: access.userId });
    if (closed.ok !== true) return res.status(STATUS[closed.code]).json({ error: closed.reason, code: closed.code });
    await recordExecutionAudit({
      companyId, stage: 'control', decision: 'blocked', reason: 'contact_enrolment_closed', actor: access.userId,
      evidence: { prospect_id: prospectId, closure_id: closed.value.id },
    });
    return res.status(201).json({ closure: closed.value });
  }

  const who = await prospectContacts(companyId, prospectId);
  if (!who.ok) return res.status(503).json({ error: 'the prospect could not be read', code: 'closure_unavailable' });
  const reopened = await reopenProspectToJourneys({ organizationId: companyId, prospectId, reason: body.reason, actorUserId: access.userId, ...who });
  if (reopened.ok !== true) {
    return res.status(STATUS[reopened.code]).json({ error: reopened.reason, code: reopened.code, ...(reopened.reviewId ? { reviewId: reopened.reviewId } : {}) });
  }
  await recordExecutionAudit({
    companyId, stage: 'control', decision: 'allowed', reason: 'contact_enrolment_reopened', actor: access.userId,
    evidence: { prospect_id: prospectId, closure_id: reopened.value.id },
  });
  return res.status(200).json({ closure: reopened.value });
}

export default __createApiRoute(handler, { route: '/api/contact-enrolment-closures' });
