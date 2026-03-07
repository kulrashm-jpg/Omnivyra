/**
 * Full Intelligence System Verification Audit
 * Run: npx ts-node backend/scripts/fullIntelligenceSystemVerification.ts
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL)
 */

import { supabase } from '../db/supabaseClient';

async function countSince(
  table: string,
  dateCol: string,
  hoursAgo: number,
  pkCol: string = 'id'
): Promise<number> {
  const since = new Date();
  since.setHours(since.getHours() - hoursAgo);
  const { count, error } = await supabase
    .from(table)
    .select(pkCol, { count: 'exact', head: true })
    .gte(dateCol, since.toISOString());
  if (error) return -1;
  return count ?? -1;
}

async function safeCount(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (error) return -1;
  return count ?? -1;
}

async function main() {
  const results: Record<string, unknown> = {};

  // SECTION 1 — Intelligence Signals
  results.section1 = {
    total_signals: await safeCount('intelligence_signals'),
    signals_last_24h: await countSince('intelligence_signals', 'created_at', 24),
    signals_last_7d: await countSince('intelligence_signals', 'created_at', 168),
  };

  const { data: templates } = await supabase
    .from('intelligence_query_templates')
    .select('id')
    .eq('enabled', true);
  results.query_templates_count = templates?.length ?? 0;

  const { data: apiSources } = await supabase
    .from('external_api_sources')
    .select('id, name, is_active')
    .order('id');
  results.external_api_sources = apiSources ?? [];

  // SECTION 2 — Signal Clusters (uses cluster_id PK)
  const { count: clusterTotal, error: clusterErr } = await supabase
    .from('signal_clusters')
    .select('cluster_id', { count: 'exact', head: true });
  const cluster24h =
    clusterErr == null
      ? await countSince('signal_clusters', 'created_at', 24, 'cluster_id')
      : -1;
  results.section2 = {
    total_clusters: clusterErr ? -1 : (clusterTotal ?? -1),
    clusters_last_24h: cluster24h,
  };

  results.signal_intelligence_count = await safeCount('signal_intelligence');

  const themesTotal = await safeCount('strategic_themes');
  const themes24h = await countSince('strategic_themes', 'created_at', 24);
  results.strategic_themes = { total: themesTotal, last_24h: themes24h };

  // SECTION 3 — Company Intelligence
  const cisTotal = await safeCount('company_intelligence_signals');
  const { data: cisRows } = await supabase.from('company_intelligence_signals').select('company_id');
  const rows = cisRows ?? [];
  const byCompany = rows.reduce((acc: Record<string, number>, r: { company_id: string }) => {
    const c = r.company_id;
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  const counts = Object.values(byCompany);
  const avgCis = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  const { count: withScore } = await supabase
    .from('company_intelligence_signals')
    .select('id', { count: 'exact', head: true })
    .not('signal_score', 'is', null);
  const { count: withPriority } = await supabase
    .from('company_intelligence_signals')
    .select('id', { count: 'exact', head: true })
    .not('priority_level', 'is', null);

  results.section3 = {
    company_intelligence_signals_total: cisTotal,
    companies_with_signals: Object.keys(byCompany).length,
    avg_signals_per_company: Math.round(avgCis * 100) / 100,
    rows_with_signal_score: withScore ?? 0,
    rows_with_priority_level: withPriority ?? 0,
  };

  // SECTION 5 — Company Config
  const configTables = [
    'company_intelligence_topics',
    'company_intelligence_competitors',
    'company_intelligence_products',
    'company_intelligence_regions',
    'company_intelligence_keywords',
  ];
  const configCompanyIds = new Set<string>();
  for (const t of configTables) {
    const { data } = await supabase.from(t).select('company_id').eq('enabled', true);
    for (const r of data ?? []) configCompanyIds.add((r as { company_id: string }).company_id);
  }
  results.section5 = {
    companies_with_active_config: configCompanyIds.size,
    config_tables_checked: configTables,
  };

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
