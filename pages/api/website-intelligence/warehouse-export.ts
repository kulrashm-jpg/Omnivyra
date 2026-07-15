import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildExportSchedule, runWarehouseExport, type ExportDataset } from '../../../backend/services/intelligence/analyticsWarehouseExportService';

const DATASETS: ExportDataset[] = ['customer_journeys', 'attribution', 'revenue', 'cohorts', 'replay_lineage'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  if (req.method === 'GET') {
    try { return res.status(200).json(await buildExportSchedule(companyId)); }
    catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' }); }
  }
  if (req.method === 'POST') {
    const dataset = req.body?.dataset as string | undefined;
    if (!dataset || !(DATASETS as string[]).includes(dataset)) {
      return res.status(400).json({ error: `dataset must be one of: ${DATASETS.join(', ')}` });
    }
    const windowEnd = typeof req.body?.window_end === 'string' ? req.body.window_end : new Date().toISOString();
    const windowStart = typeof req.body?.window_start === 'string'
      ? req.body.window_start
      : new Date(Date.parse(windowEnd) - 86_400_000).toISOString();
    try {
      const result = await runWarehouseExport({
        companyId, dataset: dataset as ExportDataset, windowStart, windowEnd,
      });
      const code = result.status === 'failed' ? 500 : 200;
      return res.status(code).json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/warehouse-export' });
