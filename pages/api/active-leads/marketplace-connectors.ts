/**
 * Phase 10 — Marketplace connectors endpoint.
 *
 *   GET    ?companyId=...                          — list
 *   GET    ?companyId=...&connectorId=...&history=1 — certification history
 *
 *   POST   { companyId, action:'register', connectorSlug, displayName, vendor, version, capabilityTags, dependencyMetadata?, signedMetadata?, metadata? }
 *   POST   { companyId, action:'certify',  connectorId, newState, reason?, evidence? }
 *   POST   { companyId, action:'rollout',  connectorId, rolloutState }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listCertificationHistory,
  listMarketplaceConnectors,
  registerMarketplaceConnector,
  setConnectorRolloutState,
  updateConnectorCertification,
} from '../../../backend/services/marketplaceConnectorService';
import {
  MARKETPLACE_CERTIFICATION_STATES,
  MARKETPLACE_ROLLOUT_STATES,
  type MarketplaceCertificationState,
  type MarketplaceRolloutState,
} from '../../../backend/types/marketplaceConnector';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    if (req.query.connectorId && req.query.history) {
      const items = await listCertificationHistory(companyId, String(req.query.connectorId));
      return res.status(200).json({ items, total: items.length });
    }
    const rollout = typeof req.query.rolloutState === 'string' && MARKETPLACE_ROLLOUT_STATES.includes(req.query.rolloutState as MarketplaceRolloutState) ? (req.query.rolloutState as MarketplaceRolloutState) : undefined;
    const cert = typeof req.query.certificationState === 'string' && MARKETPLACE_CERTIFICATION_STATES.includes(req.query.certificationState as MarketplaceCertificationState) ? (req.query.certificationState as MarketplaceCertificationState) : undefined;
    const items = await listMarketplaceConnectors(companyId, { rolloutState: rollout, certificationState: cert });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[marketplace-connectors GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load marketplace connectors' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['register', 'certify', 'rollout'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ register|certify|rollout required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'register') {
      const def = await registerMarketplaceConnector({
        organizationId: companyId,
        connectorSlug: String(body.connectorSlug ?? ''),
        displayName: String(body.displayName ?? ''),
        vendor: String(body.vendor ?? ''),
        version: String(body.version ?? ''),
        capabilityTags: Array.isArray(body.capabilityTags) ? (body.capabilityTags as string[]).filter((s) => typeof s === 'string') : [],
        dependencyMetadata: (body.dependencyMetadata as Record<string, unknown>) ?? {},
        signedMetadata: (body.signedMetadata as Record<string, unknown>) ?? {},
        activatedBy: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, connector: def });
    }
    if (action === 'certify') {
      const newState = MARKETPLACE_CERTIFICATION_STATES.includes(body.newState as MarketplaceCertificationState) ? (body.newState as MarketplaceCertificationState) : null;
      if (!newState) return res.status(400).json({ error: 'valid newState required' });
      const def = await updateConnectorCertification({
        organizationId: companyId,
        marketplaceConnectorId: String(body.connectorId ?? ''),
        newState,
        reason: typeof body.reason === 'string' ? body.reason : null,
        evidence: (body.evidence as Record<string, unknown>) ?? {},
        actorUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, connector: def });
    }
    const rolloutState = MARKETPLACE_ROLLOUT_STATES.includes(body.rolloutState as MarketplaceRolloutState) ? (body.rolloutState as MarketplaceRolloutState) : null;
    if (!rolloutState) return res.status(400).json({ error: 'valid rolloutState required' });
    const def = await setConnectorRolloutState({
      organizationId: companyId,
      marketplaceConnectorId: String(body.connectorId ?? ''),
      rolloutState,
      actorUserId: ctx.userId,
    });
    return res.status(200).json({ ok: true, connector: def });
  } catch (err: any) {
    console.error('[marketplace-connectors POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'marketplace_action_failed' });
  }
}
