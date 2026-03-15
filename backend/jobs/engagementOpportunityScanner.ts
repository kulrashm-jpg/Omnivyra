/**
 * Engagement Opportunity Scanner Job
 * Runs every 4 hours. Scans campaign_activity_engagement_signals from last 24h,
 * runs detection engine, inserts into opportunity_radar.
 */

import { supabase } from '../db/supabaseClient';
import {
  scanSignalsForOpportunities,
  type DetectedOpportunity,
  type EngagementSignalInput,
} from '../services/engagementOpportunityEngine';
import { evaluateOpportunityStrength } from '../services/opportunityForecastEngine';
import { generateCampaignProposal } from '../services/campaignProposalGenerator';

const SIGNAL_WINDOW_HOURS = 24;
const RECENCY_FACTOR_24H = 0.7;

async function persistScannerError(
  errorMessage: string,
  stackTrace?: string | null,
  organizationId?: string | null
): Promise<void> {
  try {
    await supabase.from('opportunity_engine_errors').insert({
      organization_id: organizationId ?? null,
      error_message: errorMessage,
      stack_trace: stackTrace ?? null,
    });
  } catch {
    // Avoid breaking scanner if error table insert fails
  }
}

export type EngagementOpportunityScannerResult = {
  signals_processed: number;
  opportunities_detected: number;
  opportunities_inserted: number;
  proposals_created: number;
  organizations_processed: number;
  processing_errors: string[];
  last_scan_time: string;
};

export async function runEngagementOpportunityScanner(): Promise<EngagementOpportunityScannerResult> {
  const result: EngagementOpportunityScannerResult = {
    signals_processed: 0,
    opportunities_detected: 0,
    opportunities_inserted: 0,
    proposals_created: 0,
    organizations_processed: 0,
    processing_errors: [],
    last_scan_time: new Date().toISOString(),
  };

  const windowStart = new Date(Date.now() - SIGNAL_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: signals, error: signalsError } = await supabase
    .from('campaign_activity_engagement_signals')
    .select('id, campaign_id, activity_id, platform, content, signal_type, engagement_score, detected_at, organization_id')
    .gte('detected_at', windowStart)
    .order('detected_at', { ascending: false });

  if (signalsError) {
    const msg = `Signals fetch: ${signalsError.message}`;
    result.processing_errors.push(msg);
    await persistScannerError(msg, signalsError.details ?? null, null);
    return result;
  }

  const rawSignals = (signals || []) as Array<{
    id: string;
    campaign_id: string;
    activity_id: string;
    platform: string;
    content?: string | null;
    signal_type?: string | null;
    engagement_score?: number;
    detected_at?: string | null;
    organization_id?: string | null;
  }>;

  result.signals_processed = rawSignals.length;

  if (rawSignals.length === 0) {
    return result;
  }

  const inputSignals: EngagementSignalInput[] = rawSignals.map((s) => ({
    id: s.id,
    campaign_id: s.campaign_id,
    activity_id: s.activity_id,
    platform: s.platform,
    content: s.content,
    signal_type: s.signal_type,
    engagement_score: s.engagement_score,
    detected_at: s.detected_at,
  }));

  let opportunities: DetectedOpportunity[] = [];
  try {
    opportunities = await scanSignalsForOpportunities(inputSignals);
  } catch (err) {
    const e = err as Error;
    const msg = `Detection engine: ${e.message}`;
    result.processing_errors.push(msg);
    await persistScannerError(msg, e.stack ?? null, null);
    return result;
  }

  result.opportunities_detected = opportunities.length;

  const orgSignals = new Map<string, typeof rawSignals>();
  for (const s of rawSignals) {
    const orgId = s.organization_id || s.campaign_id;
    if (!orgSignals.has(orgId)) {
      orgSignals.set(orgId, []);
    }
    orgSignals.get(orgId)!.push(s);
  }

  result.organizations_processed = orgSignals.size;

  const campaignToOrg = new Map<string, string>();
  if (rawSignals.some((s) => !s.organization_id)) {
    const campaignIds = [...new Set(rawSignals.map((s) => s.campaign_id))];
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, company_id')
      .in('id', campaignIds);
    for (const c of campaigns || []) {
      const camp = c as { id: string; company_id?: string };
      if (camp.company_id) campaignToOrg.set(camp.id, camp.company_id);
    }
  }

  for (const opp of opportunities) {
    const sampleSignal = inputSignals.find((s) => s.id === opp.signal_ids[0]);
    const raw = sampleSignal ? rawSignals.find((r) => r.id === sampleSignal.id) : null;
    const orgId = raw?.organization_id || (raw?.campaign_id ? campaignToOrg.get(raw.campaign_id) : undefined);
    const organizationId = orgId || opp.related_campaign_id || '';
    if (!organizationId) continue;

    const recencyFactor = 0.7; // simplified: 0.7 for 24h window
    const opportunityScore =
      opp.signal_count * 0.4 + (opp.engagement_score_avg / 10) * 0.3 + recencyFactor * 0.3;

    const row = {
      organization_id: organizationId,
      opportunity_type: opp.opportunity_type,
      source: 'campaign_engagement',
      title: opp.title,
      description: opp.description,
      confidence_score: opp.confidence_score,
      signal_count: opp.signal_count,
      engagement_score_avg: opp.engagement_score_avg,
      topic_keywords: opp.topic_keywords,
      related_campaign_id: opp.related_campaign_id || null,
      opportunity_score: opportunityScore,
      status: 'new',
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from('opportunity_radar')
      .insert(row)
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        // unique violation - skip duplicate
        continue;
      }
      const msg = `Insert ${opp.title}: ${insertError.message}`;
      result.processing_errors.push(msg);
      await persistScannerError(msg, insertError.details ?? null, organizationId);
      continue;
    }
    result.opportunities_inserted++;

    const opportunityId = insertedRow?.id as string | undefined;
    if (!opportunityId) continue;

    try {
      const evaluation = evaluateOpportunityStrength({
        signal_count: opp.signal_count,
        confidence_score: opp.confidence_score,
        engagement_score_avg: opp.engagement_score_avg,
        recency_factor: RECENCY_FACTOR_24H,
      });

      if (evaluation.recommended_action === 'campaign_recommended') {
        const proposal = generateCampaignProposal({
          title: opp.title,
          description: opp.description,
          opportunity_type: opp.opportunity_type,
          topic_keywords: opp.topic_keywords,
        });

        const { error: proposalError } = await supabase.from('campaign_proposals').insert({
          organization_id: organizationId,
          opportunity_id: opportunityId,
          proposal_title: proposal.campaign_title,
          proposal_data: proposal,
          proposal_strength: evaluation.opportunity_strength,
          status: 'draft',
        });

        if (proposalError) {
          if (proposalError.code === '23505') {
            // unique on opportunity_id - skip duplicate
          } else {
            const msg = `Proposal insert ${opp.title}: ${proposalError.message}`;
            result.processing_errors.push(msg);
          }
        } else {
          result.proposals_created++;
        }
      }
    } catch (proposalErr) {
      const e = proposalErr as Error;
      result.processing_errors.push(`Proposal generation ${opp.title}: ${e.message}`);
    }
  }

  return result;
}
