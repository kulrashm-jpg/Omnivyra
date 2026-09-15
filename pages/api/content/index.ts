import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enforceContentWriteRole } from '@/backend/services/content/contentWriteAuthz';
import { createContent, listContent, type CreateContentInput } from '@/backend/services/content/contentService';
import type { CanonicalContentType } from '@/lib/content/canonicalContent';
import { resolveCampaignCompanyId } from '@/backend/services/campaignAccessService';
import { resolveCompanyId, respondServiceError } from '@/lib/content/contentApiHelpers';

/**
 * Canonical content collection endpoint (Wave 1, item 10).
 *
 *   POST /api/content        → createContent(input)          → 201 { content }
 *   GET  /api/content?...     → listContent(companyId, filter) → 200 { items }
 *
 * Company-scoped. Every write/read is authorized against the resolved
 * companyId via enforceCompanyAccess (canonical tenant guard). This is a NEW
 * route; no existing endpoint is modified. Operates on the canonical content
 * object only — no disconnected copies.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string; // guaranteed non-empty once access passes

  // SEC-91 W2-G (STEP 3AH-91, W2G-1) — creating content (including its initial
  // `lifecycleStatus`) requires a content authoring role
  // (PERMISSIONS.CREATE_CAMPAIGN) in the company authorized above; VIEW_ONLY and
  // its aliases stay read-only. GET is unchanged. See contentWriteAuthz.ts.
  if (req.method === 'POST' && !(await enforceContentWriteRole({ req, res, companyId: scopedCompanyId }))) return;

  if (req.method === 'POST') {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      // contentType is required by the canonical model (companyId comes from the
      // authorized scope, not the body).
      const contentType = String(body.contentType ?? body.content_type ?? '').trim().toLowerCase();
      if (!contentType) {
        return res.status(400).json({ error: 'contentType is required' });
      }
      // B4.1 — campaignId is an OWNERSHIP claim, so it is never taken from the
      // body on trust. It is pulled out of the spread below and re-added only
      // after the campaign is proven to belong to the already-authorized
      // company. Omitted ⇒ null; nothing is inferred from title/topic/user.
      const rawCampaignId = String(body.campaignId ?? body.campaign_id ?? '').trim();
      let campaignId: string | null = null;
      if (rawCampaignId) {
        // Resolve through the SAME authority campaign routes authorize with
        // (campaign_versions.company_id — see resolveCampaignCompanyId).
        const owningCompanyId = await resolveCampaignCompanyId(rawCampaignId);
        if (!owningCompanyId) {
          return res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
        }
        if (owningCompanyId !== scopedCompanyId) {
          // Established vocabulary: TenantGuard 404s when it cannot resolve an
          // owner and 403s on a cross-tenant mismatch. Mirrored exactly.
          return res.status(403).json({ error: 'FORBIDDEN', code: 'CROSS_TENANT_CAMPAIGN' });
        }
        campaignId = rawCampaignId;
      }
      // Strip transport-only control keys; forward the rest as the create input.
      // SEC-91 W2-A (STEP 3AH-91, W2A-5) — authorship is NOT client input: the
      // body's createdBy / created_by used to be forwarded, so any member could
      // create content (and its first revision) attributed to another user.
      // created_by is the authorized principal (null for the synthetic
      // content-architect principal, which has no users row).
      const {
        company_id: _c1, companyId: _c2, content_type: _c3, contentType: _c4,
        campaignId: _c5, campaign_id: _c6, createdBy: _c7, created_by: _c8, ...rest
      } = body;
      const createdBy = access.userId && access.userId !== 'content_architect' ? access.userId : null;
      const content = await createContent({
        ...rest,
        companyId: scopedCompanyId,
        contentType: contentType as CanonicalContentType,
        campaignId,
        createdBy,
      } as CreateContentInput);
      return res.status(201).json({ content });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to create content');
    }
  }

  if (req.method === 'GET') {
    try {
      // Pass through whitelisted query filters (everything except companyId keys).
      const {
        companyId: _q1, company_id: _q2, campaignId: _q3, campaign_id: _q4, ...rawFilter
      } = (req.query || {}) as Record<string, unknown>;
      // B4.1 — campaign narrowing. No ownership check is needed on the READ
      // path: listContent applies `company_id = scopedCompanyId` first, so a
      // foreign campaignId simply matches nothing. It cannot widen the result
      // set and yields no existence oracle (unknown and foreign ids are both
      // empty). Normalised here so the service receives a string | undefined.
      const rawCampaignId = String(req.query.campaignId ?? req.query.campaign_id ?? '').trim();
      const filterInput: Record<string, unknown> = { ...rawFilter };
      if (rawCampaignId) filterInput.campaignId = rawCampaignId;
      const filter = Object.keys(filterInput).length > 0 ? filterInput : undefined;
      const items = await listContent(scopedCompanyId, filter as never);
      return res.status(200).json({ items });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to list content');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content' });
