import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  createIcpVersion, ensureIcp, IcpContractError,
} from '../../../backend/services/prospectIcp';
import { generateIcpProposal } from '../../../backend/services/prospectIcp/generator';

/**
 * D1 — PROPOSE a version of the tenant's Ideal Customer Profile.
 *
 * POST /api/prospect-icp/propose?company_id=<uuid>
 *   body: { icpKey, name?, criteria[], status?: 'draft'|'proposed',
 *           proposal?, proposedByModel?, version? }
 *   →  { icpId, versionId, version, status, outcome }
 *
 * This route creates a DRAFT or PROPOSED version and nothing else. It CANNOT
 * ratify: `createIcpVersion` refuses any status but those two, and the
 * `prospect_icp_versions_ratification_coherent` CHECK refuses a ratifier on an
 * unratified row. That is contract 16's boundary drawn at the transport edge —
 * an AI-driven caller reaching this route can propose and can go no further.
 *
 * A proposed version is NOT an input to scoring. The evaluator accepts only a
 * `RatifiedIcp`, and `getRatifiedIcp` is the only function that produces one.
 *
 * ─── THE TENANT IS NEVER TAKEN FROM THE BODY ──────────────────────────────
 * `company_id` is read from the QUERY STRING and verified by
 * `enforceCompanyAccess`, which requires an active `user_company_roles`
 * membership for the authenticated principal. The verified value is what
 * reaches the writer.
 *
 * A body carrying `organizationId` / `company_id` is REFUSED outright rather
 * than ignored. Ignoring it would be safe but silent; refusing it means a
 * caller who believes they are writing another tenant's ICP is told they are
 * not. The composite foreign key `(icp_id, organization_id)` is a second,
 * independent check: naming another tenant's ICP raises `23503`.
 *
 * This route is a transport shell. Contract 17 is enforced in
 * `backend/services/prospectIcp/criteria.ts`, not here, so the same rules apply
 * to every caller including ones that never touch HTTP.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Body keys that would attempt to make the request body the tenant authority. */
const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'];

/**
 * A tenant id is a uuid, and that is checked HERE rather than left to the
 * membership lookup — the reasoning `lead-ingestion/manual.ts` records: a
 * malformed value reaches Postgres as `22P02`, is classified `NOT_A_MEMBER`,
 * and the caller receives 403 for what is actually a malformed request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  // Membership-verified. Writes its own 400/401/403 and returns null on failure.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Membership says WHICH tenant; the capability says WHETHER this principal
  // may define that tenant's ICP. Both are required, in that order, so a
  // membership failure stays a membership failure. Bound to the VERIFIED
  // companyId. requireCapability writes its own 401/403 and audits allow and
  // deny alike to capability_audit_log.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'propose a version of the tenant Ideal Customer Profile',
  });
  if (guard.ok !== true) return;

  const body = isRecord(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ error: 'a JSON object body is required' });

  for (const key of TENANT_OVERRIDE_KEYS) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted in the body — the tenant comes from the authenticated company_id`,
      });
    }
  }

  // A proposal may never carry a ratifier. The CHECK constraint refuses it too,
  // but refusing it here names the contract instead of surfacing a SQLSTATE.
  for (const key of ['ratifiedBy', 'ratified_by', 'ratifiedAt', 'ratified_at', 'status_ratified']) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted — proposing is not ratifying. Use /api/prospect-icp/ratify.`,
        code: 'RATIFICATION_NOT_PERMITTED_HERE',
      });
    }
  }

  const icpKey = typeof body.icpKey === 'string' ? body.icpKey : null;
  if (!icpKey) return res.status(400).json({ error: 'icpKey is required' });

  const status = body.status === undefined ? 'draft' : body.status;
  if (status !== 'draft' && status !== 'proposed') {
    return res.status(400).json({
      error: "status must be 'draft' or 'proposed' — a version is never created ratified",
      code: 'STATUS_NOT_CREATABLE',
    });
  }

  // ─── A1 — AI GENERATION MODE ───────────────────────────────────────────────
  // `generate: true` derives the criteria from this tenant's Company Profile
  // instead of taking them from the body. Additive: every existing caller,
  // which supplies `criteria` and no `generate`, takes the path below unchanged.
  //
  // It is the SAME door deliberately. A separate `/generate-icp` route would be
  // a second way to create an ICP version, and the two would drift on tenant
  // verification, capability and refusal rules — all of which are already
  // settled above and apply here untouched. The generator never sees a tenant
  // id from the body: `companyId` is the value `enforceCompanyAccess` verified.
  if (body.generate === true) {
    if ('criteria' in body) {
      return res.status(400).json({
        error: "'criteria' is not accepted with generate:true — the generator derives them from the Company Profile",
        code: 'CRITERIA_NOT_SUPPLIABLE_WHEN_GENERATING',
      });
    }
    const generated = await generateIcpProposal({
      organizationId: companyId,           // the VERIFIED tenant, never the body's
      icpKey,
      name: typeof body.name === 'string' ? body.name : null,
    });
    // `ok !== true`, not `!ok`: the root tsconfig sets `strict: false`, which
    // disables union narrowing on a negated boolean discriminant. This is the
    // same idiom `requireCapability` above uses, for the same reason.
    if (generated.ok !== true) {
      // 422: the request was well formed and authorised; the EVIDENCE could not
      // support a proposal, or the model's output could not. Nothing was written.
      return res.status(422).json({
        error: generated.detail,
        code: generated.reason.toUpperCase(),
        ...(generated.diagnostics ? { refused: generated.diagnostics.dropped } : {}),
      });
    }
    return res.status(200).json({
      icpId: generated.icpId,
      versionId: generated.versionId,
      version: generated.version,
      status: 'proposed',
      generated: true,
      criteriaCount: generated.criteriaCount,
      targetCount: generated.targetCount,
      proposedByModel: generated.model,
      refused: generated.diagnostics.dropped,
      unrepresentable: generated.diagnostics.unrepresentable,
    });
  }

  if (!Array.isArray(body.criteria)) {
    return res.status(400).json({ error: 'criteria must be an array' });
  }

  try {
    const icp = await ensureIcp(companyId, icpKey, typeof body.name === 'string' ? body.name : null);

    const created = await createIcpVersion({
      organizationId: companyId,            // the VERIFIED tenant, never the body's
      icpId: icp.icpId,
      criteria: body.criteria,
      status,
      proposal: isRecord(body.proposal) ? body.proposal : undefined,
      proposedByModel: typeof body.proposedByModel === 'string' ? body.proposedByModel : null,
      version: typeof body.version === 'number' ? body.version : undefined,
    });

    return res.status(200).json({
      icpId: icp.icpId,
      icpOutcome: icp.outcome,
      versionId: created.versionId,
      version: created.version,
      status,
      outcome: created.outcome,
    });
  } catch (err) {
    // Every contract violation — an unknown attribute, a value outside a closed
    // vocabulary, a predicate contract 17 does not permit — arrives here with a
    // stable code, so a caller can correct the criterion rather than guess.
    if (err instanceof IcpContractError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return res.status(400).json({ error: err instanceof Error ? err.message : 'proposal failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-icp/propose' });
