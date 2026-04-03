import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';

type CompanySignalRow = {
  signal_id: string;
  relevance_score: number | null;
  impact_score: number | null;
};

type IntelligenceSignalRow = {
  id: string;
  cluster_id: string | null;
  topic: string | null;
};

type ClusterRow = {
  cluster_id: string;
  cluster_topic: string | null;
  signal_count: number | null;
};

type SignalKeywordRow = {
  signal_id: string;
  value: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

async function loadClusterContext(companyId: string): Promise<{
  companySignals: CompanySignalRow[];
  intelligenceSignals: IntelligenceSignalRow[];
  clusters: ClusterRow[];
  signalKeywords: SignalKeywordRow[];
  companyKeywords: string[];
}> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: companySignals, error } = await supabase
    .from('company_intelligence_signals')
    .select('signal_id, relevance_score, impact_score')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .limit(500);

  if (error) {
    throw new Error(`Failed to load company intelligence signals for ${companyId}: ${error.message}`);
  }

  const signalIds = [...new Set((companySignals ?? []).map((row: any) => row.signal_id).filter(Boolean))];
  if (signalIds.length === 0) {
    return {
      companySignals: [],
      intelligenceSignals: [],
      clusters: [],
      signalKeywords: [],
      companyKeywords: [],
    };
  }

  const [intelligenceSignalsRes, keywordsRes, companyKeywordsRes] = await Promise.all([
    supabase.from('intelligence_signals').select('id, cluster_id, topic').in('id', signalIds),
    supabase.from('signal_keywords').select('signal_id, value').in('signal_id', signalIds),
    supabase
      .from('company_intelligence_keywords')
      .select('keyword')
      .eq('company_id', companyId)
      .eq('enabled', true),
  ]);

  if (intelligenceSignalsRes.error) {
    throw new Error(`Failed to load intelligence_signals for ${companyId}: ${intelligenceSignalsRes.error.message}`);
  }
  if (keywordsRes.error) {
    throw new Error(`Failed to load signal_keywords for ${companyId}: ${keywordsRes.error.message}`);
  }
  if (companyKeywordsRes.error) {
    throw new Error(`Failed to load company_intelligence_keywords for ${companyId}: ${companyKeywordsRes.error.message}`);
  }

  const clusterIds = [
    ...new Set(
      (intelligenceSignalsRes.data ?? [])
        .map((row: any) => row.cluster_id)
        .filter(Boolean)
    ),
  ];
  const clustersRes = clusterIds.length > 0
    ? await supabase.from('signal_clusters').select('cluster_id, cluster_topic, signal_count').in('cluster_id', clusterIds)
    : { data: [], error: null };

  if (clustersRes.error) {
    throw new Error(`Failed to load signal_clusters for ${companyId}: ${clustersRes.error.message}`);
  }

  return {
    companySignals: (companySignals ?? []) as CompanySignalRow[],
    intelligenceSignals: (intelligenceSignalsRes.data ?? []) as IntelligenceSignalRow[],
    clusters: (clustersRes.data ?? []) as ClusterRow[],
    signalKeywords: (keywordsRes.data ?? []) as SignalKeywordRow[],
    companyKeywords: (companyKeywordsRes.data ?? []).map((row: any) => normalize(row.keyword)).filter(Boolean),
  };
}

export async function generateContentClusterDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('contentClusterService');

  const context = await loadClusterContext(companyId);
  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'contentClusterService',
    entity_type: 'content_cluster',
    changed_by: 'system',
  });

  if (context.companySignals.length === 0 || context.intelligenceSignals.length === 0) {
    return [];
  }

  const signalMetaById = new Map(context.companySignals.map((row) => [row.signal_id, row]));
  const clusterLookup = new Map(context.clusters.map((row) => [row.cluster_id, row]));
  const keywordValuesBySignalId = new Map<string, string[]>();
  for (const row of context.signalKeywords) {
    const current = keywordValuesBySignalId.get(row.signal_id) ?? [];
    current.push(normalize(row.value));
    keywordValuesBySignalId.set(row.signal_id, current);
  }

  const clusterBuckets = new Map<string, {
    topic: string;
    signalCount: number;
    totalRelevance: number;
    totalImpact: number;
    keywordMatches: number;
  }>();

  for (const signal of context.intelligenceSignals) {
    if (!signal.cluster_id) continue;
    const cluster = clusterLookup.get(signal.cluster_id);
    if (!cluster) continue;

    const signalMeta = signalMetaById.get(signal.id);
    const topic = (cluster.cluster_topic || signal.topic || 'Untitled cluster').trim();
    const current = clusterBuckets.get(signal.cluster_id) ?? {
      topic,
      signalCount: 0,
      totalRelevance: 0,
      totalImpact: 0,
      keywordMatches: 0,
    };

    current.signalCount += 1;
    current.totalRelevance += Number(signalMeta?.relevance_score ?? 0);
    current.totalImpact += Number(signalMeta?.impact_score ?? 0);

    const signalKeywords = keywordValuesBySignalId.get(signal.id) ?? [];
    const clusterTopic = normalize(topic);
    const hasCompanyKeywordCoverage = context.companyKeywords.some((keyword) =>
      clusterTopic.includes(keyword) ||
      keyword.includes(clusterTopic) ||
      signalKeywords.some((value) => value.includes(keyword) || keyword.includes(value))
    );
    if (hasCompanyKeywordCoverage) {
      current.keywordMatches += 1;
    }

    clusterBuckets.set(signal.cluster_id, current);
  }

  const decisions = [];
  for (const [clusterId, bucket] of clusterBuckets.entries()) {
    const avgRelevance = bucket.signalCount > 0 ? bucket.totalRelevance / bucket.signalCount : 0;
    const avgImpact = bucket.signalCount > 0 ? bucket.totalImpact / bucket.signalCount : 0;
    const coverageRatio = bucket.signalCount > 0 ? bucket.keywordMatches / bucket.signalCount : 0;

    if (coverageRatio === 0 && bucket.signalCount >= 3) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'contentClusterService',
        entity_type: 'content_cluster' as const,
        entity_id: clusterId,
        issue_type: 'topic_gap',
        title: 'Content cluster is growing without tracked topic coverage',
        description: `Cluster "${bucket.topic}" is active but not covered by current tracked topics or keywords.`,
        evidence: {
          content_cluster: bucket.topic,
          cluster_id: clusterId,
          signal_count: bucket.signalCount,
          avg_relevance: Number(avgRelevance.toFixed(3)),
          avg_impact: Number(avgImpact.toFixed(3)),
          keyword_match_count: bucket.keywordMatches,
        },
        impact_traffic: clamp(40 + bucket.signalCount * 6, 0, 100),
        impact_conversion: clamp(24 + bucket.signalCount * 4, 0, 100),
        impact_revenue: clamp(20 + bucket.signalCount * 4, 0, 100),
        priority_score: clamp(42 + bucket.signalCount * 5, 0, 100),
        effort_score: 24,
        confidence_score: 0.82,
        recommendation: 'Add this cluster into the content roadmap before adjacent topics absorb the demand.',
        action_type: 'improve_content',
        action_payload: {
          content_cluster: bucket.topic,
          cluster_id: clusterId,
          optimization_focus: 'topic_gap',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (bucket.signalCount <= 2 || avgRelevance < 0.35) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'contentClusterService',
        entity_type: 'content_cluster' as const,
        entity_id: clusterId,
        issue_type: 'weak_cluster_depth',
        title: 'Cluster depth is too shallow',
        description: `Cluster "${bucket.topic}" does not yet have enough depth to sustain strong content coverage.`,
        evidence: {
          content_cluster: bucket.topic,
          cluster_id: clusterId,
          signal_count: bucket.signalCount,
          avg_relevance: Number(avgRelevance.toFixed(3)),
        },
        impact_traffic: 28,
        impact_conversion: 22,
        impact_revenue: 18,
        priority_score: 34,
        effort_score: 18,
        confidence_score: 0.73,
        recommendation: 'Build supporting examples, FAQs, and subtopics before scaling this cluster.',
        action_type: 'improve_content',
        action_payload: {
          content_cluster: bucket.topic,
          cluster_id: clusterId,
          optimization_focus: 'cluster_depth',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (bucket.signalCount >= 5 && coverageRatio < 0.5) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'contentClusterService',
        entity_type: 'content_cluster' as const,
        entity_id: clusterId,
        issue_type: 'missing_supporting_content',
        title: 'Cluster demand lacks supporting content',
        description: `Cluster "${bucket.topic}" shows demand concentration without enough supporting coverage.`,
        evidence: {
          content_cluster: bucket.topic,
          cluster_id: clusterId,
          signal_count: bucket.signalCount,
          keyword_coverage_ratio: Number(coverageRatio.toFixed(3)),
          avg_impact: Number(avgImpact.toFixed(3)),
        },
        impact_traffic: clamp(38 + bucket.signalCount * 4, 0, 100),
        impact_conversion: clamp(34 + bucket.signalCount * 5, 0, 100),
        impact_revenue: clamp(32 + bucket.signalCount * 5, 0, 100),
        priority_score: clamp(44 + bucket.signalCount * 5, 0, 100),
        effort_score: 26,
        confidence_score: 0.8,
        recommendation: 'Produce supporting pages and conversion-oriented assets around this cluster before it fragments.',
        action_type: 'improve_content',
        action_payload: {
          content_cluster: bucket.topic,
          cluster_id: clusterId,
          optimization_focus: 'supporting_content',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (decisions.length === 0) {
    return [];
  }

  return createDecisionObjects(decisions);
}
