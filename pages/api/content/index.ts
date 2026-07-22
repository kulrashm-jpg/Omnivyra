import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { createContent, listContent, type CreateContentInput } from '@/backend/services/content/contentService';
import type { CanonicalContentType } from '@/lib/content/canonicalContent';
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

  if (req.method === 'POST') {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      // contentType is required by the canonical model (companyId comes from the
      // authorized scope, not the body).
      const contentType = String(body.contentType ?? body.content_type ?? '').trim().toLowerCase();
      if (!contentType) {
        return res.status(400).json({ error: 'contentType is required' });
      }
      // Strip transport-only control keys; forward the rest as the create input.
      const { company_id: _c1, companyId: _c2, content_type: _c3, contentType: _c4, ...rest } = body;
      const content = await createContent({
        ...rest,
        companyId: scopedCompanyId,
        contentType: contentType as CanonicalContentType,
      } as CreateContentInput);
      return res.status(201).json({ content });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to create content');
    }
  }

  if (req.method === 'GET') {
    try {
      // Pass through whitelisted query filters (everything except companyId keys).
      const { companyId: _q1, company_id: _q2, ...rawFilter } = (req.query || {}) as Record<string, unknown>;
      const filter = Object.keys(rawFilter).length > 0 ? rawFilter : undefined;
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
