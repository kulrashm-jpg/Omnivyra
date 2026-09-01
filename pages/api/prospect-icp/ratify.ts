import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  IcpContractError, ratifyIcpVersion, resolveIcpByKey,
} from '../../../backend/services/prospectIcp';

/**
 * D1 — RATIFY a version of the tenant's Ideal Customer Profile. Contract 16's
 * one and only door.
 *
 * POST /api/prospect-icp/ratify?company_id=<uuid>
 *   body: { icpKey, version }
 *   →  { icpId, versionId, version, ratifiedBy, supersededVersion }
 *
 * ─── WHY THE RATIFIER CANNOT BE SUPPLIED ──────────────────────────────────
 * The identity of the ratifier is `guard.principal.userId` — the principal that
 * `enforceCompanyAccess` proved is an active member of this tenant and that
 * `requireCapability` proved holds `prospect.icp.manage`. It is NEVER read from
 * the body, and a body that tries to name one is refused outright.
 *
 * That is what makes "an AI model may never ratify" structural rather than
 * aspirational. A model has no session and no user id, so it cannot become
 * `guard.principal`; and because the ratifier cannot be passed in, no caller —
 * model-driven or otherwise — can ratify on someone else's behalf. Below this
 * route, `ratifyIcpVersion` requires `ratifiedByUserId` with no default, and
 * the database requires `ratified_by` to be non-null on any ratified row. Three
 * independent layers, each of which alone would be enough.
 *
 * ─── WHAT RATIFICATION DOES ───────────────────────────────────────────────
 * It supersedes whichever version currently holds `ratified` and promotes the
 * named one. It does NOT edit anything: a ratified version is immutable by
 * database trigger, and changing the profile means proposing and ratifying a
 * NEW version. There is no "unratify" — the superseded chain is the history.
 *
 * The tenant is taken from the QUERY STRING and membership-verified, exactly as
 * in `pages/api/lead-ingestion/manual.ts`; a body naming a tenant is refused.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'];

/** Keys that would attempt to make the body the authority on WHO ratified. */
const RATIFIER_OVERRIDE_KEYS = [
  'ratifiedBy', 'ratified_by', 'ratifiedByUserId', 'userId', 'user_id', 'actorId', 'actor_id',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Errors that mean "your request was answerable but wrong", not "server broke". */
const CONFLICT_CODES = new Set([
  'already_ratified', 'version_superseded', 'concurrent_ratification', 'ratification_raced',
]);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'ratify a version of the tenant Ideal Customer Profile',
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

  for (const key of RATIFIER_OVERRIDE_KEYS) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted — the ratifier is the authenticated principal and cannot be supplied`,
        code: 'RATIFIER_NOT_SUPPLIABLE',
      });
    }
  }

  const icpKey = typeof body.icpKey === 'string' ? body.icpKey : null;
  if (!icpKey) return res.status(400).json({ error: 'icpKey is required' });

  const version = body.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return res.status(400).json({ error: 'version must be a positive integer' });
  }

  // The principal is the ratifier. There is no other source for this value.
  const ratifiedByUserId = guard.principal.userId;
  if (!ratifiedByUserId) {
    // Unreachable through requireCapability, which resolves a real principal.
    // Asserted anyway: a ratification with no ratifier must never be written.
    return res.status(403).json({
      error: 'the authenticated principal has no user id and cannot ratify',
      code: 'RATIFIER_UNRESOLVED',
    });
  }

  try {
    const icpId = await resolveIcpByKey(companyId, icpKey);
    if (!icpId) {
      return res.status(404).json({ error: 'no such ICP in this tenant', code: 'ICP_NOT_FOUND' });
    }

    const result = await ratifyIcpVersion({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      icpId,
      version,
      ratifiedByUserId,                   // the VERIFIED principal, never the body's
      ratifiedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      icpId,
      versionId: result.versionId,
      version: result.version,
      ratifiedBy: ratifiedByUserId,
      supersededVersion: result.supersededVersion,
    });
  } catch (err) {
    if (err instanceof IcpContractError) {
      if (err.code === 'version_not_found') {
        return res.status(404).json({ error: err.message, code: err.code });
      }
      // A lifecycle conflict is a 409: the request was well formed and the
      // caller's view of the ICP is simply stale. Answering 400 would suggest
      // they should fix their payload, which would not help.
      const status = CONFLICT_CODES.has(err.code) ? 409 : 400;
      return res.status(status).json({ error: err.message, code: err.code });
    }
    return res.status(400).json({ error: err instanceof Error ? err.message : 'ratification failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-icp/ratify' });
