import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { clamp } from './intelligenceEngineUtils';

type BacklinkRow = {
  referring_domain: string;
  domain_authority: number | null;
  link_type: string | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateAuthorityIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('authorityIntelligenceService');

  const { data, error } = await supabase
    .from('canonical_backlink_signals')
    .select('referring_domain, domain_authority, link_type')
    .eq('company_id', companyId)
    .gte('last_seen_at', sinceDays(180))
    .limit(1400);

  if (error) throw new Error(`Failed to load backlink signals for authority engine: ${error.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'authorityIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as BacklinkRow[];
  if (rows.length === 0) return [];

  const uniqueDomains = new Set(rows.map((row) => row.referring_domain).filter(Boolean)).size;
  const avgAuthority = rows.length > 0
    ? rows.reduce((sum, row) => sum + Number(row.domain_authority ?? 0), 0) / rows.length
    : 0;
  const dofollowCount = rows.filter((row) => String(row.link_type || '').toLowerCase() !== 'nofollow').length;
  const dofollowRate = dofollowCount / rows.length;

  const decisions = [];

  if (uniqueDomains < 25 || dofollowRate < 0.55) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'authorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'backlink_gap',
      title: 'Backlink profile is below authority growth threshold',
      description: 'Referring domain breadth and follow-link ratio are insufficient for sustained ranking gains.',
      evidence: {
        unique_referring_domains: uniqueDomains,
        dofollow_rate: dofollowRate,
      },
      impact_traffic: 48,
      impact_conversion: 20,
      impact_revenue: 36,
      priority_score: 66,
      effort_score: 30,
      confidence_score: 0.82,
      recommendation: 'Increase quality referring domains and focus on follow-link acquisition to core pages.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'backlink_gap' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (avgAuthority < 35) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'authorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'authority_deficit',
      title: 'Average referring authority is below competitive baseline',
      description: 'Link sources are not strong enough to move high-value queries into durable rankings.',
      evidence: {
        average_domain_authority: avgAuthority,
        backlink_count: rows.length,
      },
      impact_traffic: clamp(42 + Math.round((35 - Math.min(avgAuthority, 35)) * 1.1), 0, 100),
      impact_conversion: 24,
      impact_revenue: 44,
      priority_score: 64,
      effort_score: 28,
      confidence_score: 0.8,
      recommendation: 'Prioritize links from higher-authority publishers and expert networks.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'authority_deficit' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (uniqueDomains < 20 && avgAuthority < 30) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'authorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'trust_gap',
      title: 'External authority and trust signals are too weak',
      description: 'Low-quality backlink profile is limiting both discoverability and external credibility.',
      evidence: {
        unique_referring_domains: uniqueDomains,
        average_domain_authority: avgAuthority,
      },
      impact_traffic: 34,
      impact_conversion: 46,
      impact_revenue: 48,
      priority_score: 70,
      effort_score: 26,
      confidence_score: 0.76,
      recommendation: 'Build proof-oriented authority assets and earn links from trusted domains in your category.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'authority_trust' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
