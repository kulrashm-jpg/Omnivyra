import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/prospects/:id/enrich — execute ONE planned enrichment field.
 *
 * A6. The production execution boundary the state-model, suppression and
 * executor audits established was missing. Everything below this route already
 * existed and was proven; what did not exist was a reachable caller and a
 * composition of the four real production ports.
 *
 * ─── A TRANSPORT SHELL, NOT A SECOND EXECUTOR ─────────────────────────────
 * It resolves the tenant, validates input and calls `executeProspectEnrichment`.
 * It orchestrates nothing: attempt claim, credential resolution, duplicate
 * suppression, cost authorisation, provider egress, observation persistence and
 * terminal attempt state all stay exactly where they already live, in that
 * order. The route neither reorders them nor inspects them.
 *
 * ─── THE ATTRIBUTE IS NAMED, NEVER CHOSEN ─────────────────────────────────
 * The caller states which attribute to enrich. This route will not scan a plan
 * and decide what to spend on — that is a scheduling policy, and no scheduler
 * exists. A plan that did not mark the named attribute for enrichment returns
 * 200 with the planner's own verdict, because "the planner declined" is an
 * answer, not a failure.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED ──────────────────────────────────
 * `companyId` is a query parameter validated by `requireTenantAccess` against
 * live membership, exactly as the sibling GET route does it. The prospect id in
 * the path is not authorization: the planning seam re-checks the tenant on its
 * own read, and a prospect in another tenant is unreadable there.
 *
 * ─── AND MEMBERSHIP IS NOT ENOUGH (OD-A / PI-ADR-007) ─────────────────────
 * Membership answers WHICH tenant. It does not answer WHETHER this principal
 * may spend that tenant's money. `requireTenantAccess` filters by role only
 * when `requireRoleIn` is supplied, so before OD-A every active member at any
 * of the seven canonical roles — `VIEW_ONLY` included — could cause a real,
 * billable provider call, while importing one prospect required admin-tier
 * `PROSPECT_INGEST`. Spending was easier than writing.
 *
 * The owner decided self-serve enrichment IS intended but is ADMIN-TIER ONLY,
 * so `PROSPECT_ENRICH_EXECUTE` (COMPANY_ADMIN + SUPER_ADMIN) is now required,
 * bound to the VERIFIED tenant id and checked in the order the three
 * `lead-ingestion` routes already use. `requireCapability` writes its own
 * 401/403 and audits the decision, so no refusal vocabulary is invented here.
 *
 * The second half of that decision lives one layer down: the daily provider
 * call ceiling is now REQUIRED, so a tenant with no ceiling configured is
 * refused at `authorizeCost` with `cost_denied` and zero transport. This route
 * does not implement that and must not duplicate it — see spendCeiling.ts.
 *
 * ─── WHY A DISTINCT ROUTE ─────────────────────────────────────────────────
 * `/api/prospects/[id]` is documented GET-only and answers "everything the
 * platform can say about one Prospect" — a read that scores nothing and
 * evaluates no suppression. Spending a tenant's provider quota is a different
 * kind of act and does not belong behind the same verb-switched handler.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../../backend/security/TenantGuard';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ENRICH_EXECUTE } from '../../../../shared/contracts/security';
import { executeProspectEnrichment } from '../../../../backend/apiHandlers/prospects/prospectIntelligenceRead';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const companyId = str(req.query.companyId) ?? str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  // Membership said WHICH tenant. This says WHETHER this principal may spend
  // it. Bound to the verified companyId, never to anything from the body.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ENRICH_EXECUTE,
    organizationId: companyId,
    reason: 'execute a billable provider enrichment call funded by this tenant',
  });
  if (guard.ok !== true) return;

  const prospectId = str(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!prospectId) return res.status(400).json({ error: 'prospect id is required' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const attribute = str(body.attribute);
  if (!attribute) return res.status(400).json({ error: 'attribute is required' });

  const subject = str(body.subject);
  if (subject !== 'person' && subject !== 'account') {
    return res.status(400).json({ error: "subject must be 'person' or 'account'" });
  }

  // A caller-supplied instant must be a real one; an unparseable `asOf` is
  // refused rather than quietly replaced with the current time.
  const asOf = str(body.asOf);
  if (asOf !== null && Number.isNaN(Date.parse(asOf))) {
    return res.status(400).json({ error: 'asOf is not a parseable timestamp' });
  }

  try {
    const result = await executeProspectEnrichment({
      organizationId: companyId,
      prospectId,
      attribute,
      subject,
      now: asOf ?? new Date().toISOString(),
    });
    // Both shapes are 200. `not_planned` is the planner's verdict and
    // `executed` carries the executor's own refusal taxonomy intact — a
    // `duplicate_suppressed` or `credential_missing` outcome is a successful
    // execution that correctly declined to spend, not a transport error.
    return res.status(200).json(result);
  } catch (e) {
    // The planning seam throws when the prospect is unreadable in this tenant.
    // Reported as 404 for the reason the sibling route documents: an
    // unreadable prospect must not be distinguishable from a missing one.
    const detail = e instanceof Error ? e.message : String(e);
    if (/not found in tenant/i.test(detail)) {
      return res.status(404).json({ error: 'prospect_not_found' });
    }
    return res.status(503).json({
      error: 'prospect_enrichment_unavailable',
      retryable: true,
      detail,
    });
  }
}

export default __createApiRoute(handler, { route: '/api/prospects/[id]/enrich' });
