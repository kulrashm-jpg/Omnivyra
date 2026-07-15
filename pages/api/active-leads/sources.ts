import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 3 — Listening sources list endpoint.
 *
 *   GET /api/active-leads/sources?companyId=...
 *     Returns the org's listening_sources rows (org-scoped). Used by the
 *     Active Leads executions panel to render the "Run Now" controls.
 *
 *   POST /api/active-leads/sources
 *     Body: { companyId, sourceType, sourceIdentifier, displayName,
 *             platform?, keywords?[] }
 *     Creates a new listening source in 'inactive' state. The user
 *     promotes it via the (future) source-state-transition endpoint or
 *     via DB-side service updates. RBAC-gated.
 *
 * No state activation here — creation lands sources in 'inactive'.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  createListeningSource,
  listListeningSourcesForOrg,
} from '../../../backend/services/listeningSourceService';
import { isListeningSourceType } from '../../../backend/types/listeningSource';

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
    const items = await listListeningSourcesForOrg(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[sources GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load sources' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as {
    companyId?: string;
    sourceType?: string;
    sourceIdentifier?: string;
    displayName?: string;
    platform?: string;
    keywords?: string[];
  };
  const companyId = body.companyId || '';
  if (!companyId || !body.sourceType || !body.sourceIdentifier || !body.displayName) {
    return res.status(400).json({ error: 'companyId, sourceType, sourceIdentifier, displayName are required' });
  }
  if (!isListeningSourceType(body.sourceType)) {
    return res.status(400).json({ error: `unknown sourceType: ${body.sourceType}` });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    const platform = String(body.platform ?? '').toLowerCase() || null;
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter((k) => typeof k === 'string') : [];
    const source = await createListeningSource({
      organizationId: companyId,
      sourceType: body.sourceType,
      sourceIdentifier: body.sourceIdentifier,
      displayName: body.displayName,
      monitoringModes: ['on_demand'],
      metadata: { ...(platform ? { platform } : {}), keywords },
      createdBy: ctx.userId,
    });
    return res.status(200).json({ ok: true, source });
  } catch (err: any) {
    console.error('[sources POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Source creation failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/sources' });
