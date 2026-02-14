/**
 * Emerging Intent Clusters - read-only intelligence derived from qualified signals.
 *
 * Future: Feedback Reinforcement - when a cluster-driven theme becomes a campaign and converts
 * leads, increment cluster priority_weight slightly (adaptive intelligence). Requires:
 * - Tracking which themes originated from cluster_inputs
 * - Conversion event → cluster attribution → update lead_intent_clusters_v1.priority_score
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';

export type LeadCluster = {
  id: string;
  problem_domain: string;
  signal_count: number;
  regions: string[];
  platforms: string[];
  priority_score: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  avg_trend_velocity?: number;
  created_at?: string | null;
  latest_post_at?: string | null;
};

function computeClusterHash(companyId: string, problemDomain: string): string {
  const payload = companyId + (problemDomain || '').trim().toLowerCase();
  return createHash('sha1').update(payload).digest('hex');
}

export async function generateIntentClusters(companyId: string): Promise<void> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();

  const { data: signals } = await supabase
    .from('lead_signals_v1')
    .select('id, problem_domain, icp_score, urgency_score, intent_score, trend_velocity, region, platform, post_created_at, created_at')
    .eq('company_id', companyId)
    .in('status', ['ACTIVE', 'WATCHLIST', 'OUTREACH_PLANNED', 'OUTREACH_SENT', 'ENGAGED'])
    .gte('total_score', 0.6)
    .eq('risk_flag', false)
    .gte('post_created_at', fourteenDaysAgo);

  const rows = (signals ?? []) as Array<{
    id: string;
    problem_domain: string | null;
    icp_score: number;
    urgency_score: number;
    intent_score: number;
    trend_velocity: number;
    region: string | null;
    platform: string;
    post_created_at: string | null;
    created_at: string;
  }>;

  const byDomain = new Map<string, typeof rows>();
  for (const r of rows) {
    const domain = (r.problem_domain ?? 'General').trim() || 'General';
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(r);
  }

  for (const [problemDomain, group] of byDomain.entries()) {
    if (group.length < 3) continue;

    const posts = group
      .map((r) => r.post_created_at ?? r.created_at)
      .filter(Boolean) as string[];
    const clusterHash = computeClusterHash(companyId, problemDomain);
    const regions = [...new Set(group.map((r) => (r.region ?? 'GLOBAL').trim()).filter(Boolean))];
    const platforms = [...new Set(group.map((r) => (r.platform ?? '').trim()).filter(Boolean))];

    const avgIcp =
      group.reduce((s, r) => s + Number(r.icp_score ?? 0), 0) / group.length;
    const avgUrgency =
      group.reduce((s, r) => s + Number(r.urgency_score ?? 0), 0) / group.length;
    const avgIntent =
      group.reduce((s, r) => s + Number(r.intent_score ?? 0), 0) / group.length;
    const avgTrend =
      group.reduce((s, r) => s + Number(r.trend_velocity ?? 0), 0) / group.length;

    const priorityScore =
      0.35 * avgIntent +
      0.25 * avgUrgency +
      0.2 * avgIcp +
      0.2 * avgTrend;

    const earliestPostAt = posts.length > 0 ? new Date(Math.min(...posts.map((p) => new Date(p).getTime()))).toISOString() : null;
    const latestPostAt = posts.length > 0 ? new Date(Math.max(...posts.map((p) => new Date(p).getTime()))).toISOString() : null;

    const payload = {
      company_id: companyId,
      problem_domain: problemDomain,
      cluster_hash: clusterHash,
      signal_count: group.length,
      avg_icp_score: avgIcp,
      avg_urgency_score: avgUrgency,
      avg_intent_score: avgIntent,
      avg_trend_velocity: avgTrend,
      regions,
      platforms,
      earliest_post_at: earliestPostAt,
      latest_post_at: latestPostAt,
      priority_score: Math.min(1, Math.max(0, priorityScore)),
      updated_at: new Date().toISOString(),
    };

    await supabase.from('lead_intent_clusters_v1').upsert(payload, {
      onConflict: 'cluster_hash',
      ignoreDuplicates: false,
    });
  }

  const { data: recentDomains } = await supabase
    .from('lead_signals_v1')
    .select('problem_domain')
    .eq('company_id', companyId)
    .in('status', ['ACTIVE', 'WATCHLIST', 'OUTREACH_PLANNED', 'OUTREACH_SENT', 'ENGAGED'])
    .gte('post_created_at', twentyOneDaysAgo);

  const domainsWithSignals = new Set(
    (recentDomains ?? [])
      .map((r) => ((r as { problem_domain: string | null }).problem_domain ?? 'General').trim().toLowerCase())
      .filter(Boolean)
  );

  const { data: allClusters } = await supabase
    .from('lead_intent_clusters_v1')
    .select('id, problem_domain')
    .eq('company_id', companyId);

  for (const c of allClusters ?? []) {
    const domain = ((c as { problem_domain: string }).problem_domain ?? 'General').trim().toLowerCase();
    if (!domainsWithSignals.has(domain)) {
      await supabase.from('lead_intent_clusters_v1').delete().eq('id', (c as { id: string }).id);
    }
  }
}

export async function getTopClusters(companyId: string): Promise<LeadCluster[]> {
  const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('lead_intent_clusters_v1')
    .select('id, problem_domain, signal_count, regions, platforms, priority_score, avg_intent_score, avg_urgency_score, avg_trend_velocity, created_at, latest_post_at')
    .eq('company_id', companyId)
    .gte('created_at', twentyOneDaysAgo)
    .order('priority_score', { ascending: false })
    .limit(5);

  return (data ?? []).map((r) => ({
    id: r.id,
    problem_domain: r.problem_domain ?? '',
    signal_count: r.signal_count ?? 0,
    regions: Array.isArray(r.regions) ? r.regions : [],
    platforms: Array.isArray(r.platforms) ? r.platforms : [],
    priority_score: Number(r.priority_score ?? 0),
    avg_intent_score: Number(r.avg_intent_score ?? 0),
    avg_urgency_score: Number(r.avg_urgency_score ?? 0),
    avg_trend_velocity: Number((r as { avg_trend_velocity?: number }).avg_trend_velocity ?? 0),
    created_at: (r as { created_at?: string }).created_at ?? null,
    latest_post_at: (r as { latest_post_at?: string }).latest_post_at ?? null,
  }));
}
