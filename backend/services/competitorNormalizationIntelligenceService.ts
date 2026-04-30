import {
  archiveDecisionSourceEntityType,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';

export async function generateCompetitorNormalizationDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('competitorNormalizationIntelligenceService');

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'competitorNormalizationIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  return [];
}
