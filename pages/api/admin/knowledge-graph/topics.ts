import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '@/shared/contracts/security';
import {
  listTopicsForReview,
  getTopicsByIds,
  type ReviewFilter,
} from '@/backend/services/content/knowledgeGraph/topicReviewService';
import { findTopicCandidates } from '@/backend/services/content/knowledgeGraph/topicCandidateService';

/**
 * B7.6 — canonical topic REVIEW (read-only operator surface).
 *
 *   GET ?filter=identities|aliases|all&page=&pageSize=&search=
 *   GET ?ids=<uuid>,<uuid>            → explicit pairing lookup
 *
 * READ ONLY. This route cannot change canonical_topic_id; the B7.5 endpoints
 * (POST/DELETE /api/admin/knowledge-graph/canonical-topic) remain the sole
 * mutation authority, so UI actions cannot bypass B7.5's validation.
 *
 * Same platform-tier capability as B7.5 — INTELLIGENCE_OVERRIDE_MANAGE — so a
 * company-scoped user cannot reach this surface. No companyId is accepted from
 * the browser and none is used: platform_topic_node is tenant-less, so there is
 * no tenant data behind this route to return.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: INTELLIGENCE_OVERRIDE_MANAGE,
    reason: 'knowledge-graph topic review (GET)',
  });
  if (guard.ok !== true) return; // denied; requireCapability responded + audited

  const q = req.query;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  // B7.7 — semantic candidates for one topic. RECALL ONLY: the response carries
  // a similarity score as evidence for the operator and no decision field. The
  // B7.5 endpoints remain the sole way to act on a candidate.
  const candidatesFor = str(q.candidatesFor).trim();
  if (candidatesFor) {
    const items = await findTopicCandidates(candidatesFor);
    return res.status(200).json({ items, mode: 'candidates' });
  }

  const idsRaw = str(q.ids).trim();
  if (idsRaw) {
    const items = await getTopicsByIds(idsRaw.split(',').map((s) => s.trim()));
    return res.status(200).json({ items, mode: 'byIds' });
  }

  const rawFilter = str(q.filter);
  const filter: ReviewFilter =
    rawFilter === 'aliases' || rawFilter === 'all' || rawFilter === 'identities'
      ? rawFilter
      : 'identities';   // deterministic default; an unknown value never widens scope

  const pageResult = await listTopicsForReview({
    filter,
    page: Number(str(q.page)) || 0,
    pageSize: Number(str(q.pageSize)) || undefined,
    search: str(q.search),
  });

  return res.status(200).json({ ...pageResult, mode: 'list' });
}

export default __createApiRoute(handler, { route: '/api/admin/knowledge-graph/topics' });
