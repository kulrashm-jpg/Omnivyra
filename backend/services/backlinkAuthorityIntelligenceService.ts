import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';

type BacklinkRow = {
  target_url: string;
  referring_domain: string;
  anchor_text: string | null;
  domain_authority: number | null;
  link_type: string | null;
};

type CompetitorSignalRow = {
  competitor_name: string;
  signal_type: string;
  value: Record<string, unknown>;
  confidence: number;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateBacklinkAuthorityDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('backlinkAuthorityIntelligenceService');

  const [{ data: backlinks, error: backlinksError }, { data: competitorSignals, error: competitorError }] = await Promise.all([
    supabase
      .from('canonical_backlink_signals')
      .select('target_url, referring_domain, anchor_text, domain_authority, link_type')
      .eq('company_id', companyId)
      .gte('last_seen_at', recentSince(180))
      .order('last_seen_at', { ascending: false })
      .limit(1200),
    supabase
      .from('competitor_signals')
      .select('competitor_name, signal_type, value, confidence')
      .eq('company_id', companyId)
      .gte('detected_at', recentSince(90))
      .order('detected_at', { ascending: false })
      .limit(300),
  ]);

  if (backlinksError) {
    throw new Error(`Failed to load backlink signals: ${backlinksError.message}`);
  }
  if (competitorError) {
    throw new Error(`Failed to load competitor signals for authority engine: ${competitorError.message}`);
  }

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'backlinkAuthorityIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (backlinks ?? []) as BacklinkRow[];
  const compRows = (competitorSignals ?? []) as CompetitorSignalRow[];
  if (rows.length === 0 && compRows.length === 0) return [];

  const domainSet = new Set<string>();
  const anchorSet = new Set<string>();
  let dofollowCount = 0;
  let totalAuthority = 0;
  let authorityCount = 0;

  for (const row of rows) {
    const referring = normalizeText(row.referring_domain);
    if (referring) domainSet.add(referring);
    const anchor = normalizeText(row.anchor_text ?? '');
    if (anchor) anchorSet.add(anchor);
    if (normalizeText(row.link_type) !== 'nofollow') dofollowCount += 1;
    if (typeof row.domain_authority === 'number') {
      totalAuthority += row.domain_authority;
      authorityCount += 1;
    }
  }

  const uniqueRefDomains = domainSet.size;
  const anchorDiversity = anchorSet.size;
  const dofollowRatio = rows.length > 0 ? dofollowCount / rows.length : 0;
  const avgAuthority = authorityCount > 0 ? totalAuthority / authorityCount : 0;
  const competitorMentionPressure = compRows.filter((row) => row.signal_type === 'mention').length;
  const competitorBenchmarkPressure = compRows.filter((row) => row.signal_type === 'benchmark').length;

  const decisions = [];

  if (rows.length > 0 && (uniqueRefDomains < 20 || avgAuthority < 30 || dofollowRatio < 0.55)) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'backlinkAuthorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'weak_backlink_profile',
      title: 'Backlink profile lacks quality and diversity',
      description: 'Current backlink footprint is too shallow to reliably support organic authority gains.',
      evidence: {
        backlinks_total: rows.length,
        unique_referring_domains: uniqueRefDomains,
        avg_domain_authority: roundNumber(avgAuthority, 2),
        dofollow_ratio: roundNumber(dofollowRatio, 4),
        anchor_diversity: anchorDiversity,
      },
      impact_traffic: clamp(42 + Math.round((1 - dofollowRatio) * 30), 0, 100),
      impact_conversion: 24,
      impact_revenue: clamp(34 + Math.round((30 - Math.min(avgAuthority, 30)) * 1.2), 0, 100),
      priority_score: clamp(56 + Math.round((20 - Math.min(uniqueRefDomains, 20)) * 1.2), 0, 100),
      effort_score: 30,
      confidence_score: 0.82,
      recommendation: 'Prioritize high-authority referring domain outreach and diversify anchor usage by topic intent.',
      action_type: 'improve_content',
      action_payload: {
        optimization_focus: 'backlink_profile',
        unique_referring_domains: uniqueRefDomains,
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (rows.length > 0 && (avgAuthority < 35 || anchorDiversity < 12)) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'backlinkAuthorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'authority_gap',
      title: 'Domain authority growth is constrained',
      description: 'Authority progression is being capped by weak average backlink strength and low anchor breadth.',
      evidence: {
        avg_domain_authority: roundNumber(avgAuthority, 2),
        anchor_diversity: anchorDiversity,
        referring_domains: uniqueRefDomains,
      },
      impact_traffic: 48,
      impact_conversion: 18,
      impact_revenue: 46,
      priority_score: clamp(58 + Math.round((35 - Math.min(avgAuthority, 35)) * 1.3), 0, 100),
      effort_score: 34,
      confidence_score: 0.78,
      recommendation: 'Build authority-focused asset hubs and earn links from higher-authority publications in target niches.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'authority_gap',
        avg_domain_authority: roundNumber(avgAuthority, 2),
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (competitorMentionPressure >= 8 || competitorBenchmarkPressure >= 5) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'backlinkAuthorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'competitor_backlink_advantage',
      title: 'Competitors show external authority advantage',
      description: 'Competitor signal volume indicates stronger external authority momentum than current profile.',
      evidence: {
        competitor_mention_pressure: competitorMentionPressure,
        competitor_benchmark_pressure: competitorBenchmarkPressure,
        own_avg_domain_authority: roundNumber(avgAuthority, 2),
      },
      impact_traffic: 44,
      impact_conversion: 20,
      impact_revenue: 49,
      priority_score: clamp(60 + competitorBenchmarkPressure * 2 + Math.round(competitorMentionPressure / 2), 0, 100),
      effort_score: 32,
      confidence_score: 0.76,
      recommendation: 'Counter competitor authority gains with targeted digital PR, backlinks to core conversion pages, and cluster support links.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'competitor_backlink_advantage',
        competitor_mention_pressure: competitorMentionPressure,
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
