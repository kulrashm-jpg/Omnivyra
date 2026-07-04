import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';
// BETA-ENGINE-002: evidence-derived confidence from the canonical Confidence Engine.
import { deriveDecisionConfidence, decisionConfidenceExplainability } from './evidencePlatform';
// BETA-PROVIDER-001: real backlink provider availability lifts backlink confidence to MEASURED.
import { isBacklinkProviderAvailable, backlinkProviderReliability } from './backlinkAuthorityProviderBridge';

type BacklinkRow = {
  target_url: string;
  referring_domain: string;
  anchor_text: string | null;
  domain_authority: number | null;
  link_type: string | null;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateBacklinkAuthorityDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('backlinkAuthorityIntelligenceService');

  const { data: backlinks, error: backlinksError } = await supabase
    .from('canonical_backlink_signals')
    .select('target_url, referring_domain, anchor_text, domain_authority, link_type')
    .eq('company_id', companyId)
    .gte('last_seen_at', recentSince(180))
    .order('last_seen_at', { ascending: false })
    .limit(1200);

  if (backlinksError) {
    throw new Error(`Failed to load backlink signals: ${backlinksError.message}`);
  }

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'backlinkAuthorityIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (backlinks ?? []) as BacklinkRow[];
  if (rows.length === 0) return [];

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

  // BETA-ENGINE-002: evidence-derived confidence (was hardcoded 0.82/0.78). INFERRED maturity (no
  // backlink API); scales with the backlink sample size and the share of signals carrying authority.
  // BETA-PROVIDER-001: MEASURED (with provider reliability) when a real backlink provider is connected;
  // INFERRED otherwise (unchanged — backward compatible).
  const backlinkProviderLive = isBacklinkProviderAvailable();
  const backlinkConfidence = deriveDecisionConfidence({
    maturity: backlinkProviderLive ? 'MEASURED' : 'INFERRED',
    providerReliability: backlinkProviderLive ? backlinkProviderReliability() : null,
    sampleSize: rows.length,
    completeness: rows.length > 0 ? authorityCount / rows.length : 0,
    dataPresent: rows.length > 0,
  });
  const backlinkConfExplain = decisionConfidenceExplainability(backlinkConfidence);
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
        confidence: backlinkConfExplain,
      },
      impact_traffic: clamp(42 + Math.round((1 - dofollowRatio) * 30), 0, 100),
      impact_conversion: 24,
      impact_revenue: clamp(34 + Math.round((30 - Math.min(avgAuthority, 30)) * 1.2), 0, 100),
      priority_score: clamp(56 + Math.round((20 - Math.min(uniqueRefDomains, 20)) * 1.2), 0, 100),
      effort_score: 30,
      confidence_score: backlinkConfidence.confidenceScore,
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
        confidence: backlinkConfExplain,
      },
      impact_traffic: 48,
      impact_conversion: 18,
      impact_revenue: 46,
      priority_score: clamp(58 + Math.round((35 - Math.min(avgAuthority, 35)) * 1.3), 0, 100),
      effort_score: 34,
      confidence_score: backlinkConfidence.confidenceScore,
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

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
