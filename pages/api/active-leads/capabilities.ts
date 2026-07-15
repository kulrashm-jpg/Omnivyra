import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
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
import {
  enableCapability,
  disableCapability,
} from '../../../backend/services/integrationCapabilityService';
import {
  type IntegrationCapability,
  isIntegrationCapability,
} from '../../../backend/types/integrationCapabilities';
import type { PlatformListeningState } from '../../../backend/types/listeningState';
import { getCachedCapabilityAggregate } from '../../../backend/services/capabilityCacheService';
import {
  buildCapabilityHealthReport,
  summarisePlatformHealth,
  type HealthSeverity,
  type HealthFindingCode,
} from '../../../backend/services/capabilityHealthService';

type CapabilityStateEntry = {
  capability: IntegrationCapability;
  enabled: boolean;
  status: 'active' | 'revoked' | 'pending';
  granted_at: string | null;
  consent_record_age_days: number | null;
};

type PlatformBucket = {
  platform: string;
  state: PlatformListeningState;
  capabilities: CapabilityStateEntry[];
  monitoring_ready: boolean;
  monitoring_blockers: string[];
  health: {
    severity: HealthSeverity;
    codes: HealthFindingCode[];
  } | null;
  readiness_snapshot?: {
    consent_freshness_score: number;
    scope_sufficiency: 'sufficient' | 'insufficient' | 'not_required';
    source_ready: boolean;
    orchestration_eligible: boolean;
  };
};

type GetResponse = {
  companyId: string;
  generated_at: string;
  buckets: {
    connected: PlatformBucket[];
    available_for_listening: PlatformBucket[];
    listening_enabled: PlatformBucket[];
  };
  all_platforms: PlatformBucket[];
  health: {
    rollups: { info: number; warning: number; error: number };
    findings: Array<{
      code: HealthFindingCode;
      severity: HealthSeverity;
      platform: string | null;
      detail: string;
    }>;
  };
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  // Phase 1 — single deterministic aggregate (cached, tenant-scoped). One
  // round trip to the cache (or 4 to the DB on miss) instead of the
  // previous N read fan-out across platformTokenService + capability list.
  let aggregate;
  try {
    aggregate = await getCachedCapabilityAggregate(companyId);
  } catch (err: any) {
    console.error('[capabilities GET] aggregate load failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load capabilities' });
  }

  const healthReport = buildCapabilityHealthReport(aggregate);
  const platformHealth = summarisePlatformHealth(healthReport);

  const buckets: PlatformBucket[] = aggregate.platforms.map((p) => {
    const capabilities: CapabilityStateEntry[] = p.capabilities.map((cap) => ({
      capability: cap.capability,
      enabled: cap.enabled,
      status: cap.status,
      granted_at: cap.granted_at,
      consent_record_age_days: cap.consent_record_age_days,
    }));
    return {
      platform: p.platform,
      state: p.state,
      capabilities,
      monitoring_ready: p.monitoring_ready,
      monitoring_blockers: p.monitoring_blockers,
      health: platformHealth[p.platform] ?? null,
      readiness_snapshot: p.readiness_snapshot,
    };
  });

  const response: GetResponse = {
    companyId,
    generated_at: aggregate.generated_at,
    buckets: {
      connected: buckets.filter((b) => b.state === 'connected' || b.state === 'available_for_listening'),
      available_for_listening: buckets.filter((b) => b.state === 'available_for_listening'),
      listening_enabled: buckets.filter((b) => b.state === 'listening_active'),
    },
    all_platforms: buckets,
    health: {
      rollups: healthReport.rollups,
      findings: healthReport.findings,
    },
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/capabilities' });
