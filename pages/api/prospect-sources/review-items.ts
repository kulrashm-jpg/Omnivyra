import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { registerBuiltInLeadSources } from '../../../backend/services/leadIngestion';
import { registerDiscoveryAdapters } from '../../../backend/services/prospectDiscovery/adapters';
import {
  decideReviewItems,
  listReviewItems,
  ReviewDecisionRefused,
} from '../../../backend/services/prospectImportReview/repository';
import { candidateView } from '../../../backend/services/prospectImportReview/display';

/**
 * PI R3: the tenant's import review list.
 *
 *   GET  /api/prospect-sources/review-items?companyId=<uuid>
 *          pending held candidates, oldest first, plus queue size and age.
 *   POST /api/prospect-sources/review-items?companyId=<uuid>
 *          body: { source: 'apollo', providerRecordIds: string[] (<=100), decision: 'import' | 'skip' }
 *
 * Owner decision (2026-11-10): weakly-matched discovered leads are reviewed by
 * TENANT USERS; held items expire after 30 days as "not imported".
 *
 * NEVER MERGES. IMPORT replays the held provider record through the normal
 * ingestion path (the tenant's ingestion gate applies there too); SKIP clears
 * the held record. Nothing here links two persons.
 *
 * Tenant: TenantGuard binds the caller to `companyId`. The repository checks
 * the deciding user's ACTIVE membership again at the write, because that check
 * is what stands in for the absent `decided_by` foreign key (GOV-H). A
 * platform super-admin bypass therefore cannot decide: it is not a member.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = (req.query?.companyId ?? req.query?.company_id) as string | undefined;
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;
  const org = String(companyId);
  const now = new Date().toISOString();

  try {
    if (method === 'GET') {
      const out = await listReviewItems(org, now);
      return res.status(200).json({
        items: out.items.map((i) => ({
          source: i.source,
          providerRecordId: i.providerRecordId,
          reason: i.reason,
          matchedPersonIds: i.matchedPersonIds,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          candidate: candidateView(i.candidate, i.reason),
        })),
        queue: { pendingRows: out.pendingRows, oldestCreatedAt: out.oldestCreatedAt },
      });
    }

    const body = (req.body ?? {}) as { source?: unknown; providerRecordIds?: unknown; decision?: unknown };
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const decision = body.decision === 'import' || body.decision === 'skip' ? body.decision : null;
    const ids = Array.isArray(body.providerRecordIds) ? body.providerRecordIds.filter((x): x is string => typeof x === 'string') : [];
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(source) || !decision || ids.length === 0 || ids.length > 100) {
      return res.status(400).json({ error: 'INVALID_REVIEW_DECISION' });
    }
    // The held record is replayed through its source's own translator.
    registerBuiltInLeadSources();
    registerDiscoveryAdapters();
    const outcomes = await decideReviewItems({
      organizationId: org, userId: tenant.userId, source, providerRecordIds: ids, decision, now,
    });
    return res.status(200).json({ outcomes });
  } catch (err: unknown) {
    if (err instanceof ReviewDecisionRefused) {
      return res.status(err.code === 'invalid_input' ? 400 : 403).json({ error: 'REVIEW_DECISION_REFUSED', code: err.code });
    }
    // Message only, never the request body: it can name held candidates.
    console.error('[prospect-sources/review-items]', { method, message: err instanceof Error ? err.message : 'error' });
    return res.status(500).json({ error: 'REVIEW_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-sources/review-items' });
