import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceActionRole, requireTenantScope } from './utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { buildExecutiveSummary } from '../../../backend/services/networkIntelligence/executiveSummaryService';
import { fetchPlaybookEffectiveness } from '../../../backend/services/networkIntelligence/playbookEffectivenessService';
import { buildExecutiveNarrative } from '../../../backend/services/networkIntelligence/executiveNarrativeService';
import { renderExecutiveSummaryPdf } from '../../../backend/services/export/executivePdfRenderer';

const readQueryParam = (req: NextApiRequest, key: string): string | null => {
  const value = req.query?.[key];
  return typeof value === 'string' ? value : null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
  });
  if (!roleGate) return;

  const format = (readQueryParam(req, 'format') || 'pdf').toLowerCase();
  if (format !== 'pdf') {
    return res.status(400).json({ error: 'UNSUPPORTED_FORMAT' });
  }

  const start_date = readQueryParam(req, 'start_date');
  const end_date = readQueryParam(req, 'end_date');
  const platform = readQueryParam(req, 'platform');
  const playbook_id = readQueryParam(req, 'playbook_id');

  try {
    const filters = {
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      start_date,
      end_date,
      platform,
      playbook_id,
    };
    const narrativeFilters = {
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      start_date,
      end_date,
    };
    const [summary, playbookEffectiveness, narrative] = await Promise.all([
      buildExecutiveSummary(filters),
      fetchPlaybookEffectiveness(filters),
      buildExecutiveNarrative(narrativeFilters),
    ]);
    const buffer = await renderExecutiveSummaryPdf({
      organizationName: scope.organizationId,
      summary,
      playbookPerformance: playbookEffectiveness.records,
      narrative,
      generatedAt: new Date(),
    });

    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="community-ai-executive-${dateStamp}.pdf"`
    );
    return res.status(200).send(buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'FAILED_TO_EXPORT_EXECUTIVE_SUMMARY' });
  }
}
