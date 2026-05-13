/**
 * Phase 0 — Active Leads capability surface.
 *
 *   GET  /api/active-leads/capabilities?companyId=...
 *     Returns per-platform listening state, aggregated for the UI's three
 *     buckets: Connected / Available for Listening / Listening Enabled.
 *
 *   POST /api/active-leads/capabilities
 *     Body: { companyId, platform, capability, action: 'enable'|'disable' }
 *     Enables or disables a specific capability for an org+platform. Recording
 *     a fresh consent record on enable, revoking on disable. Never auto-enables
 *     a capability — caller must explicitly request 'enable'.
 *
 * Authorization: enforceCompanyAccess gate (existing pattern).
 *
 * Does NOT start, schedule, or run any monitoring. Active listening transport
 * is out of scope for Phase 0.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import { getPlatformsWithTokensForOrg } from '../../../backend/services/platformTokenService';
import {
  enableCapability,
  disableCapability,
  listCapabilitiesForOrg,
} from '../../../backend/services/integrationCapabilityService';
import {
  INTEGRATION_CAPABILITIES,
  type IntegrationCapability,
  isIntegrationCapability,
} from '../../../backend/types/integrationCapabilities';
import type { PlatformListeningState } from '../../../backend/types/listeningState';

type CapabilityStateEntry = {
  capability: IntegrationCapability;
  enabled: boolean;
  status: 'active' | 'revoked' | 'pending';
  granted_at: string | null;
};

type PlatformBucket = {
  platform: string;
  state: PlatformListeningState;
  capabilities: CapabilityStateEntry[];
};

type GetResponse = {
  companyId: string;
  buckets: {
    connected: PlatformBucket[];
    available_for_listening: PlatformBucket[];
    listening_enabled: PlatformBucket[];
  };
  all_platforms: PlatformBucket[];
};

function classifyState(
  isConnected: boolean,
  capabilities: CapabilityStateEntry[],
): PlatformListeningState {
  const listenRow = capabilities.find((c) => c.capability === 'listen');
  if (listenRow?.enabled && listenRow?.status === 'active') {
    return 'listening_active';
  }
  if (listenRow?.status === 'active' && !listenRow.enabled) {
    // Approved historically but currently disabled.
    return 'listening_approved';
  }
  if (isConnected) return 'available_for_listening';
  return 'connected';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  let connectedPlatforms: string[];
  let capabilityRows: Awaited<ReturnType<typeof listCapabilitiesForOrg>>;
  try {
    [connectedPlatforms, capabilityRows] = await Promise.all([
      getPlatformsWithTokensForOrg(companyId),
      listCapabilitiesForOrg(companyId),
    ]);
  } catch (err: any) {
    console.error('[capabilities GET] load failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load capabilities' });
  }

  const platformSet = new Set<string>([
    ...connectedPlatforms,
    ...capabilityRows.map((r) => r.platform),
  ]);

  const buckets: PlatformBucket[] = [];

  for (const platform of platformSet) {
    const rows = capabilityRows.filter((r) => r.platform === platform);
    const capabilities: CapabilityStateEntry[] = INTEGRATION_CAPABILITIES.map((cap) => {
      const row = rows.find((r) => r.capability === cap);
      return {
        capability: cap,
        enabled: row?.enabled ?? false,
        status: (row?.status as 'active' | 'revoked' | 'pending') ?? 'pending',
        granted_at: row?.granted_at ?? null,
      };
    });

    const isConnected = connectedPlatforms.includes(platform);
    buckets.push({
      platform,
      state: classifyState(isConnected, capabilities),
      capabilities,
    });
  }

  const response: GetResponse = {
    companyId,
    buckets: {
      connected: buckets.filter((b) => b.state === 'connected' || b.state === 'available_for_listening'),
      available_for_listening: buckets.filter((b) => b.state === 'available_for_listening'),
      listening_enabled: buckets.filter((b) => b.state === 'listening_active'),
    },
    all_platforms: buckets,
  };

  return res.status(200).json(response);
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as {
    companyId?: string;
    platform?: string;
    capability?: string;
    action?: string;
    scopeSnapshot?: string[];
  };

  const companyId = body.companyId || '';
  const platform = (body.platform || '').trim();
  const capability = body.capability;
  const action = body.action;

  if (!companyId || !platform) {
    return res.status(400).json({ error: 'companyId and platform are required' });
  }
  if (!isIntegrationCapability(capability)) {
    return res.status(400).json({ error: `unknown capability: ${capability}` });
  }
  if (action !== 'enable' && action !== 'disable') {
    return res.status(400).json({ error: `action must be 'enable' or 'disable'` });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  // Phase 0 — enforce MANAGE_LISTENING_CAPABILITIES on capability mutations.
  // Read paths (GET) only require company access; flipping listening state
  // requires the new narrow capability so connecting a platform for
  // publishing alone does not let any user enable listening.
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) {
    return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  }
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    if (action === 'enable') {
      const row = await enableCapability({
        organizationId: companyId,
        platform,
        capability,
        grantedBy: ctx.userId,
        scopeSnapshot: body.scopeSnapshot ?? [],
        source: 'ui',
      });
      return res.status(200).json({ capability: row, action: 'enabled' });
    }
    const row = await disableCapability({
      organizationId: companyId,
      platform,
      capability,
      revokedBy: ctx.userId,
      source: 'ui',
    });
    return res.status(200).json({ capability: row, action: 'disabled' });
  } catch (err: any) {
    console.error('[capabilities POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Capability change failed' });
  }
}
