/**
 * INT-003 Wave 1 — GET /api/leads/:id/intelligence
 *
 * Authenticated, tenant-scoped, STRICTLY READ-ONLY exposure of the persisted
 * Lead Intelligence envelope (INT-002). Serves the normalized Phase 6 DTO:
 * intent, persona, qualification, segments, recommendations (incl. channels),
 * timeline, planning layers, confidence, freshness and version metadata
 * (engine/schema/generation/fingerprint/generatedAt). Absent intelligence
 * returns the `never_generated` DTO — this route NEVER generates, never
 * invokes the orchestrator, never loads snapshots, never writes.
 *
 * Authorization: SEC-001 standard — resolveCompanyAccess writes its own
 * 400 (missing company) / 401 (unauthenticated) / 403 (foreign tenant).
 * Tenant isolation is enforced twice: membership here, and the read mapper's
 * defense-in-depth company check (INT-001A F5).
 */

import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../backend/services/contentArchitectService';
import { createLeadIntelligenceReadApi } from '../../../../backend/services/leadIntelligenceReadApi';

const MAX_ID_LENGTH = 128;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const leadId = req.query.id;
  if (typeof leadId !== 'string' || leadId.trim() === '' || leadId.length > MAX_ID_LENGTH) {
    return res.status(400).json({ error: 'Invalid lead id' });
  }

  if (Array.isArray(req.query.company_id)) {
    return res.status(400).json({ error: 'company_id must be a single value' });
  }
  const companyId = req.query.company_id as string | undefined;
  const access = await resolveCompanyAccess(req, res, companyId ?? null);
  if (!access) return;

  try {
    const readApi = createLeadIntelligenceReadApi();
    const view = await readApi.getLeadIntelligenceView(companyId as string, leadId.trim());
    return res.status(200).json(view);
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/leads/:id/intelligence',
  policy: { v: 1, category: 'company-scoped', companyIdFrom: 'query.company_id' },
});
