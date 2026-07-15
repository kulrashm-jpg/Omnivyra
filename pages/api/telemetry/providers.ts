import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/telemetry/providers?companyId=<id>&scope=mastery
 *
 * Canonical consumption endpoint: returns the requested surface's
 * TelemetryProviderResult set for an org. This is how client surfaces (the
 * Command Center data layer) consume telemetry — providerId → provider →
 * ProviderResult — without reaching into telemetry storage.
 *
 * Fail-soft: while the telemetry table is unprovisioned each provider returns
 * { supported:true, available:false, value:0 }, so the caller falls back to its
 * existing proxy metric and nothing regresses.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  resolveTelemetrySignals,
  MASTERY_PROVIDER_IDS,
} from '../../../backend/services/telemetry/telemetryConsumption';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) || (req.query.company_id as string) || '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim() });
  if (!access) return;

  const scope = String(req.query.scope ?? 'mastery');
  // Only the mastery surface is wired today; other scopes resolve the same
  // canonical set until they are activated.
  const ids = scope === 'mastery' ? MASTERY_PROVIDER_IDS : MASTERY_PROVIDER_IDS;

  // Cumulative-adoption surfaces read the lifetime window (matches proxy counts).
  const signals = await resolveTelemetrySignals(companyId.trim(), ids, { window: 'lifetime' });

  return res.status(200).json({ scope, signals });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/telemetry/providers' });
