import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/prospect-identity/owned-identity-candidates — the engagement identities
 * this tenant could attest.
 *
 *   GET /api/prospect-identity/owned-identity-candidates?companyId=<uuid>[&limit=<n>]
 *
 * An administrator populating the owned-identity registry has to name a
 * `(platform, platform_user_id)` pair exactly as `engagement_authors` holds it.
 * Typing one from memory produces a row that looks right, equality-matches
 * nothing and protects nobody, which `attestedIdentityContract.ts` spends its
 * header refusing. This read is where the pair comes from instead.
 *
 * ─── A SEPARATE ROUTE, NOT A `?view=` ON THE REGISTRY ─────────────────────
 * The registry route answers with the tenant's OWN rows. This one answers with
 * identities observed on a shared, global lookup table. A query parameter
 * that flipped one projection into the other is exactly the widenable parameter
 * the sibling PI endpoints refuse: it would put "whose data is this?" in the
 * query string, where a typo, a repeated parameter or a copied URL decides it.
 * Two routes make the two projections two surfaces, each with its own
 * documented answer set.
 *
 * ─── HOW THE TENANT IS ESTABLISHED ────────────────────────────────────────
 * `companyId` arrives in the QUERY STRING ONLY and is not trusted — it is an
 * assertion. `requireTenantAccess` verifies live membership, writes its own
 * 401/403 and refuses a legacy cookie bridge principal, exactly as the sibling
 * `authority.ts` and `/api/prospects/[id]/problems` do it. Everything after the
 * guard uses the VERIFIED id and never re-reads `req.query`, because two reads
 * of a repeated parameter can diverge.
 *
 * ─── ADMINISTRATOR-ONLY, INCLUDING THIS READ ──────────────────────────────
 * Gated on `PROSPECT_INGEST`, bound to the VERIFIED `companyId`. No capability
 * is minted and no step-up is required.
 *
 * The capability is required on the READ for the same reason `authority.ts` is
 * administrator-only on every method: this is a governance control plane, and
 * its read is the input to a governance decision. It is also the sharper reason
 * — `engagement_authors` has NO tenant column and a global unique key over
 * `(platform, platform_user_id)`, so the identities listed here are third
 * parties the tenant happened to talk to. Membership alone is the wrong bar for
 * an enumeration of them.
 *
 * ─── WHAT IS NOT IN THE PROJECTION ────────────────────────────────────────
 * `display_name`, `username`, `profile_url`, `avatar_url`, `raw_payload` and
 * message content are not read and not returned. The service does not select
 * them; this route could not emit them if it tried. An administrator gets the
 * identity pair plus proof it was observed here, which is what the decision
 * needs and nothing a third party would be disclosed by.
 *
 * ─── THE READ IS BOUNDED AND `limit` ONLY NARROWS ─────────────────────────
 * `limit` defaults to 50 and clamps to 200 in the service. There is no
 * parameter that widens eligibility — no `includeAnonymous`, no `platform`
 * override, no cross-tenant switch — and `limit` is the only one accepted.
 *
 * ─── AN UNREADABLE STORE IS NOT AN EMPTY LIST ─────────────────────────────
 * 503 `owned_identity_candidates_unavailable`, never an empty 200. "There are
 * none to attest" and "we could not look" are different answers and only the
 * second is worth retrying — the same fail-closed rule the contract states for
 * the registry.
 *
 * ─── ONE UI CONSUMER: THE COMPANY-ADMIN PANEL ─────────────────────────────
 * This read is no longer API-only. `components/prospects/OwnedIdentitiesPanel`
 * calls it — once, LAZILY, only after an administrator opens the attestation
 * picker — so an administrator populating the registry picks a pair the server
 * reported instead of typing one that equality-matches nothing.
 *
 * It adds NO second API and NO new capability: the panel is the only client,
 * this route is unchanged, and `PROSPECT_INGEST` bound to the verified
 * `companyId` remains the whole authority. The panel's own gate decides
 * whether it RENDERS and never that anything is permitted — `CompanyContext`
 * defaults an empty role map to `COMPANY_ADMIN`, so a client-side role check
 * can read "admin" for a principal this route would refuse, and every
 * permission sentence the panel shows comes from a status returned HERE.
 *
 * It is mounted inside `pages/settings/company-admin-access.tsx`, the existing
 * company-admin governance page, because that page's authority axis is the one
 * this route uses. The Integration Hub was rejected: its Enrichment tab gates
 * on `requireExternalApiAccess` / `requireManage`, a DIFFERENT axis, and two
 * authorities behind one surface misleads whoever reads it.
 *
 * The laziness is part of the contract above, not a performance choice: this
 * projection enumerates third parties on a global lookup table, so nothing
 * reads it until someone asks it a question.
 *
 * ─── IT GRADES NOTHING ────────────────────────────────────────────────────
 * No number here is a verdict. `messageCount` and `threadCount` are observation
 * proof, order is chronological, and nothing is produced that an operator could
 * read as an ordering by importance.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { PROSPECT_API_VERSION } from '../../../backend/apiHandlers/prospects/prospectIntelligenceRead';
import {
  readOwnedIdentityCandidates,
  OWNED_IDENTITY_API_CONTRACT_VERSION,
} from '../../../backend/services/engagementIdentity/ownedIdentityCandidates';

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim() !== '') return v[0].trim();
  return null;
};

/**
 * A uuid is checked HERE rather than left to the membership lookup, which would
 * send a malformed value to Postgres, get a `22P02`, and have it classified as a
 * membership failure — answering 403 "access denied" for what is a malformed
 * request, and spending a round trip on unvalidated input.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every envelope leads with the API version, then this surface's own contract.
 * `PROBLEM_OBSERVATION_CONTRACT_VERSION` is deliberately NOT reused: a client
 * that pinned it would believe it had pinned a different surface's rules.
 */
const envelope = <T extends Record<string, unknown>>(body: T) =>
  ({ version: PROSPECT_API_VERSION, contract: OWNED_IDENTITY_API_CONTRACT_VERSION, ...body });

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json(envelope({ error: 'method_not_allowed' }));
  }

  // QUERY ONLY. A body never names the tenant on this surface.
  const companyId = str(req.query?.companyId) ?? str(req.query?.company_id);
  if (!companyId) return res.status(400).json(envelope({ error: 'companyId is required' }));
  if (!UUID.test(companyId)) return res.status(400).json(envelope({ error: 'companyId must be a uuid' }));

  // Membership-verified. Writes its own 401/403, audits the decision, and
  // returns null — returning here is what stops a denied request continuing.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  // Membership said WHICH tenant. This says WHETHER this principal may use the
  // tenant's identity-governance control plane. Bound to the VERIFIED companyId.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'list the engagement identities this organization could attest as its own',
    resourceId: companyId,
  });
  if (guard.ok !== true) return;

  const limitRaw = str(req.query?.limit);
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return res.status(400).json(envelope({ error: 'limit must be a positive number' }));
  }

  try {
    const result = await readOwnedIdentityCandidates({ organizationId: companyId, limit });
    // `'refusal' in result` rather than `!result.ok`: this project compiles with
    // `strict: false`, under which a boolean-literal discriminant does not
    // narrow. The `in` operator does, and it is the idiom `authority.ts` uses.
    if ('refusal' in result) {
      return res.status(503).json(envelope({
        error: 'owned_identity_candidates_unavailable', retryable: true,
      }));
    }
    return res.status(200).json(envelope({
      reason: result.reason,
      candidates: result.candidates,
      excluded: result.excluded,
    }));
  } catch {
    // Nothing from the failure reaches the caller: a store message can quote a
    // column or echo request input, and this surface enumerates third parties.
    return res.status(503).json(envelope({
      error: 'owned_identity_candidates_unavailable', retryable: true,
    }));
  }
}

export default __createApiRoute(handler, {
  route: '/api/prospect-identity/owned-identity-candidates',
});
