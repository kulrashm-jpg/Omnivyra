import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 7 — Bounded search endpoint.
 *
 *   GET ?companyId=...&q=...&kinds=opportunity,note&since=...&until=...
 *   GET ?companyId=...&q=...&semantic=1   — lexical retrieval over semantic chunks
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  SEARCH_KINDS,
  searchIntelligence,
  type SearchKind,
} from '../../../backend/services/intelligenceSearchService';
import { retrieveSemanticChunks } from '../../../backend/services/semanticRetrievalService';
import {
  SEMANTIC_SOURCE_KINDS,
  type SemanticSourceKind,
} from '../../../backend/types/semanticIndex';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  const q = String(req.query.q ?? '');
  if (!companyId || q.trim().length < 2) {
    return res.status(400).json({ error: 'companyId and q (>=2 chars) required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.semantic === '1' || req.query.semantic === 'true') {
      const sourceKind = typeof req.query.sourceKind === 'string' && SEMANTIC_SOURCE_KINDS.includes(req.query.sourceKind as SemanticSourceKind)
        ? (req.query.sourceKind as SemanticSourceKind)
        : undefined;
      const items = await retrieveSemanticChunks({ organizationId: companyId, query: q, sourceKind });
      return res.status(200).json({ items, total: items.length, mode: 'semantic_lexical_fallback' });
    }
    const kinds = typeof req.query.kinds === 'string'
      ? req.query.kinds.split(',').map((s) => s.trim()).filter((s) => SEARCH_KINDS.includes(s as SearchKind)) as SearchKind[]
      : undefined;
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const until = typeof req.query.until === 'string' ? req.query.until : null;
    const result = await searchIntelligence({
      organizationId: companyId,
      query: q,
      kinds,
      since,
      until,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[search GET] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Search failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/search' });
