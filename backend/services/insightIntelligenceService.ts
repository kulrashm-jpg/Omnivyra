/**
 * Insight Intelligence Service
 *
 * Generates canonical decision objects from engagement opportunity trends.
 */

import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionScope,
  listDecisionObjects,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';

const INSIGHT_TYPES = [
  { type: 'competitor_complaints_increase', oppType: 'competitor_complaint', label: 'Competitor complaints' },
  { type: 'buying_intent_detected', oppType: 'buying_intent', label: 'Buying intent' },
  { type: 'recommendation_trend', oppType: 'recommendation_request', label: 'Recommendation requests' },
  { type: 'problem_discussion_spike', oppType: 'problem_discussion', label: 'Problem discussions' },
] as const;

export type InsightWithEvidence = PersistedDecisionObject;

async function countOpportunities(
  organizationId: string,
  oppType: string,
  start: string,
  end: string
): Promise<number> {
  const { count, error } = await supabase
    .from('engagement_opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('opportunity_type', oppType)
    .gte('detected_at', start)
    .lt('detected_at', end);

  if (error) return 0;
  return count ?? 0;
}

function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function buildRecommendation(type: string): string {
  switch (type) {
    case 'competitor_complaints_increase':
      return 'Create competitor-switch messaging and acquisition campaigns while complaint volume is elevated.';
    case 'buying_intent_detected':
      return 'Route buying-intent conversations into lead capture and direct response offers immediately.';
    case 'recommendation_trend':
      return 'Publish recommendation-led assets that answer repeated buyer questions directly.';
    case 'problem_discussion_spike':
      return 'Turn repeated pain-point discussions into solution-first content and conversion paths.';
    default:
      return 'Review the demand signal and convert it into an executable growth action.';
  }
}

function buildActionType(type: string): string {
  switch (type) {
    case 'competitor_complaints_increase':
      return 'launch_campaign';
    case 'buying_intent_detected':
      return 'capture_leads';
    case 'recommendation_trend':
      return 'improve_content';
    case 'problem_discussion_spike':
      return 'improve_content';
    default:
      return 'launch_campaign';
  }
}

async function getPlatformForThread(threadId: string): Promise<string | null> {
  const { data } = await supabase
    .from('engagement_threads')
    .select('platform')
    .eq('id', threadId)
    .maybeSingle();
  return (data as { platform?: string })?.platform ?? null;
}

export async function generateInsights(organizationId: string): Promise<{
  created: number;
  errors: string[];
}> {
  assertBackgroundJobContext('insightIntelligenceService');
  const errors: string[] = [];
  const now = new Date();
  const last7End = new Date(now);
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prev7End = last7Start;
  const prev7Start = new Date(prev7End.getTime() - 7 * 24 * 60 * 60 * 1000);

  const last7StartIso = last7Start.toISOString();
  const last7EndIso = last7End.toISOString();
  const prev7StartIso = prev7Start.toISOString();
  const prev7EndIso = prev7End.toISOString();

  const pendingDecisions = [];

  for (const { type, oppType, label } of INSIGHT_TYPES) {
    try {
      const current = await countOpportunities(organizationId, oppType, last7StartIso, last7EndIso);
      const previous = await countOpportunities(organizationId, oppType, prev7StartIso, prev7EndIso);
      const change = changePercent(current, previous);
      const title = type === 'buying_intent_detected'
        ? `${label} detected in ${current} discussions`
        : `${label} up ${change ?? 0}% this week`;
      const summary = `Last 7 days: ${current}. Previous 7 days: ${previous}.`;

      const { data: opportunities } = await supabase
        .from('engagement_opportunities')
        .select('id, source_thread_id, source_message_id, platform')
        .eq('organization_id', organizationId)
        .eq('opportunity_type', oppType)
        .gte('detected_at', last7StartIso)
        .lt('detected_at', last7EndIso)
        .limit(10);

      const evidenceRows = (opportunities ?? []) as Array<{
        id: string;
        source_thread_id: string;
        source_message_id: string;
        platform?: string;
      }>;
      const messageIds = evidenceRows.map((row) => row.source_message_id);
      const { data: messages } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, content, author_id')
        .in('id', messageIds);

      const authorIds = [...new Set((messages ?? []).map((row: { author_id?: string }) => row.author_id).filter(Boolean))];
      const { data: authors } = await supabase
        .from('engagement_authors')
        .select('id, username, display_name')
        .in('id', authorIds);
      const authorMap = new Map(
        (authors ?? []).map((author: { id: string; username?: string; display_name?: string }) => [
          author.id,
          author.display_name ?? author.username ?? 'Unknown',
        ])
      );

      const evidence = [];
      for (const msg of messages ?? []) {
        const message = msg as { id: string; thread_id: string; content?: string; author_id?: string };
        const authorName = message.author_id ? authorMap.get(message.author_id) ?? null : null;
        const opportunity = evidenceRows.find((row) => row.source_message_id === message.id);
        const platform = opportunity?.platform ?? (await getPlatformForThread(message.thread_id)) ?? 'unknown';
        evidence.push({
          thread_id: message.thread_id,
          message_id: message.id,
          author_name: authorName,
          platform,
          text_snippet: (message.content ?? '').toString().slice(0, 200),
        });
      }

      pendingDecisions.push({
        company_id: organizationId,
        report_tier: 'growth' as const,
        source_service: 'insightIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: type,
        title,
        description: summary,
        evidence: {
          metric_value: current,
          previous_value: previous,
          change_percentage: change,
          evidence,
          opportunity_type: oppType,
        },
        impact_traffic: Math.min(100, Math.max(5, current * 5)),
        impact_conversion: Math.min(100, Math.max(10, current * 7)),
        impact_revenue: Math.min(100, Math.max(10, current * 6)),
        priority_score: Math.min(100, Math.max(15, current * 6)),
        effort_score: 20,
        confidence_score: evidence.length > 0 ? 0.9 : 0.65,
        recommendation: buildRecommendation(type),
        action_type: buildActionType(type),
        action_payload: {
          opportunity_type: oppType,
          current,
          previous,
          change_percentage: change,
        },
        status: 'open' as const,
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (pendingDecisions.length === 0) {
    await archiveDecisionScope({
      company_id: organizationId,
      report_tier: 'growth',
      source_service: 'insightIntelligenceService',
      entity_type: 'global',
      entity_id: null,
      changed_by: 'system',
    });
    return { created: 0, errors };
  }

  const persisted = await replaceDecisionObjectsForSource(pendingDecisions);
  return { created: persisted.length, errors };
}

export async function getInsights(organizationId: string): Promise<InsightWithEvidence[]> {
  return listDecisionObjects({
    viewName: 'growth_view',
    companyId: organizationId,
    sourceService: 'insightIntelligenceService',
    entityType: 'global',
    entityId: null,
    status: ['open'],
    limit: 20,
  });
}
