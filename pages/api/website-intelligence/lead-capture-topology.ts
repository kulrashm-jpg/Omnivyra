import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  buildTopologyDiagnostics,
  getCurrentTopology,
  getTopologyHistory,
  recordTopology,
  validAttributionModes,
  validTopologies,
  type AttributionMode,
  type TopologyKind,
} from '../../../backend/services/intelligence/leadCaptureTopologyService';

/**
 * Lead-capture topology.
 *   GET  → diagnostics by default; ?view=current | history | options-only
 *   POST → record { topologies: TopologyKind[], attribution_modes?: [], notes? }
 * RBAC + tenant-scoped. Append-only history; latest active wins.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  try {
    if (req.method === 'GET') {
      const view = typeof req.query.view === 'string' ? req.query.view : 'diagnostics';
      if (view === 'current') return res.status(200).json({ topology: await getCurrentTopology(companyId), valid: { topologies: validTopologies(), attributionModes: validAttributionModes() } });
      if (view === 'history') return res.status(200).json({ history: await getTopologyHistory(companyId) });
      return res.status(200).json(await buildTopologyDiagnostics(companyId));
    }
    if (req.method === 'POST') {
      const valid = new Set<TopologyKind>(validTopologies());
      const validModes = new Set<AttributionMode>(validAttributionModes());
      const topologies = Array.isArray(req.body?.topologies)
        ? (req.body.topologies as string[]).filter((t): t is TopologyKind => valid.has(t as TopologyKind))
        : [];
      const modes = Array.isArray(req.body?.attribution_modes)
        ? (req.body.attribution_modes as string[]).filter((m): m is AttributionMode => validModes.has(m as AttributionMode))
        : [];
      if (topologies.length === 0) return res.status(400).json({ error: 'topologies[] must contain at least one valid value' });
      return res.status(200).json(await recordTopology({
        companyId,
        topologies,
        attributionModes: modes,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
        actorUserId: roleGate.userId,
      }));
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'topology endpoint failed' });
  }
}
