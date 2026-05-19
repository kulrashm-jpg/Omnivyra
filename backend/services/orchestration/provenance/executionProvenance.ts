/**
 * executionProvenance — Phase-2 Step-16 read API.
 * READ-ONLY: reads the persisted provenance off the canonical execution
 * item's content blob (no mutation, no I/O beyond the canonical adapter).
 */

import { getExecutionItem, getExecutionItems } from '../canonicalExecutionAdapter';
import { deriveProvenanceFromContent } from './provenanceMapper';
import { provenanceDiagnostics } from './provenanceDiagnostics';
import type { CampaignProvenanceSummary, ExecutionProvenance } from './provenanceTypes';

function legacyRaw(item: { metadata?: Record<string, unknown> } | null): Record<string, unknown> | null {
  const lr = item?.metadata?.__legacy_raw;
  return lr && typeof lr === 'object' && !Array.isArray(lr) ? (lr as Record<string, unknown>) : null;
}

export async function getExecutionProvenance(
  campaignId: string,
  executionId: string,
): Promise<ExecutionProvenance | null> {
  if (!campaignId || !executionId) return null;
  try {
    const item = await getExecutionItem(campaignId, executionId);
    if (!item) return null;
    const reconciled = Boolean(item.metadata?.reconciled_with_blueprint);
    const { provenance, hybrid } = deriveProvenanceFromContent(
      executionId,
      legacyRaw(item),
      { stage: 'WEEKLY', reconciledWithBlueprint: reconciled },
    );
    provenanceDiagnostics.provenance({
      campaign_id: campaignId,
      execution_id: executionId,
      generation_source: provenance.generation_source,
      generation_mode: provenance.generation_mode,
      fallback_active: provenance.fallback_active,
      rollback_triggered: provenance.rollback_triggered,
      authoritative_confidence: provenance.authoritative_confidence,
    });
    if (hybrid) provenanceDiagnostics.hybrid({ campaign_id: campaignId, execution_id: executionId });
    if (provenance.lineage && Object.keys(provenance.lineage).length > 0) {
      provenanceDiagnostics.lineage({ campaign_id: campaignId, execution_id: executionId, lineage: provenance.lineage });
    }
    return provenance;
  } catch {
    return null;
  }
}

export async function getCampaignProvenanceSummary(
  campaignId: string,
): Promise<CampaignProvenanceSummary> {
  const resolved_at = new Date().toISOString();
  const empty: CampaignProvenanceSummary = {
    campaign_id: campaignId,
    total: 0,
    authoritative_coverage: 0,
    legacy_coverage: 0,
    hybrid_coverage: 0,
    fallback_coverage: 0,
    rollback_coverage: 0,
    generation_mode_distribution: {},
    generation_stage_distribution: {},
    resolved_at,
  };
  if (!campaignId) return empty;
  try {
    const items = await getExecutionItems(campaignId);
    if (items.length === 0) return empty;
    let auth = 0, legacy = 0, hybrid = 0, fb = 0, rb = 0;
    const modeDist: Record<string, number> = {};
    const stageDist: Record<string, number> = {};
    for (const it of items) {
      const reconciled = Boolean(it.metadata?.reconciled_with_blueprint);
      const { provenance } = deriveProvenanceFromContent(
        it.execution_id, legacyRaw(it), { reconciledWithBlueprint: reconciled },
      );
      if (provenance.generation_source === 'AUTHORITATIVE') auth += 1;
      else if (provenance.generation_source === 'HYBRID') hybrid += 1;
      else legacy += 1;
      if (provenance.fallback_active) fb += 1;
      if (provenance.rollback_triggered) rb += 1;
      modeDist[provenance.generation_mode] = (modeDist[provenance.generation_mode] ?? 0) + 1;
      stageDist[provenance.generation_stage] = (stageDist[provenance.generation_stage] ?? 0) + 1;
    }
    const total = items.length;
    const summary: CampaignProvenanceSummary = {
      campaign_id: campaignId,
      total,
      authoritative_coverage: +(auth / total).toFixed(3),
      legacy_coverage: +(legacy / total).toFixed(3),
      hybrid_coverage: +(hybrid / total).toFixed(3),
      fallback_coverage: +(fb / total).toFixed(3),
      rollback_coverage: +(rb / total).toFixed(3),
      generation_mode_distribution: modeDist,
      generation_stage_distribution: stageDist,
      resolved_at,
    };
    provenanceDiagnostics.provenance({
      campaign_id: campaignId, summary: true, total,
      authoritative_coverage: summary.authoritative_coverage,
      legacy_coverage: summary.legacy_coverage,
      hybrid_coverage: summary.hybrid_coverage,
    });
    return summary;
  } catch {
    return empty;
  }
}

export const executionProvenanceService = {
  getExecutionProvenance,
  getCampaignProvenanceSummary,
};
