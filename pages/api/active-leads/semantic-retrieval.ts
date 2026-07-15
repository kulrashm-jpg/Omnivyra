import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 9 — Hybrid semantic retrieval endpoint.
 *
 *   POST { companyId, query, mode?='hybrid', sourceKind?, topK?, lexicalWeight?, semanticWeight?, useCache?=true }
 *     Runs the hybrid retrieval and returns ranked hits + explanation.
 *
 *   GET  ?companyId=... — recent retrieval explanations (audit trail).
 *
 * Auth: enforceCompanyAccess. Any role can query (read-only).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  listRecentExplanations,
  retrieveHybrid,
} from '../../../backend/services/hybridSemanticRetrievalService';
import {
  RETRIEVAL_MODES,
  type RetrievalMode,
} from '../../../backend/types/semanticRetrievalExplanation';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const items = await listRecentExplanations(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[semantic-retrieval GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load retrieval history' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as {
    companyId?: string;
    query?: string;
    mode?: string;
    sourceKind?: string;
    topK?: number;
    lexicalWeight?: number;
    semanticWeight?: number;
    useCache?: boolean;
  };
  const companyId = body.companyId || '';
  const query = (body.query || '').trim();
  if (!companyId || !query) return res.status(400).json({ error: 'companyId and query required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const mode: RetrievalMode = RETRIEVAL_MODES.includes(body.mode as RetrievalMode) ? (body.mode as RetrievalMode) : 'hybrid';
  try {
    const result = await retrieveHybrid({
      organizationId: companyId,
      query,
      mode,
      sourceKind: body.sourceKind as never,
      topK: body.topK,
      lexicalWeight: body.lexicalWeight,
      semanticWeight: body.semanticWeight,
      requestedBy: ctx.userId,
      useCache: body.useCache,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[semantic-retrieval POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'retrieval_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/semantic-retrieval' });
