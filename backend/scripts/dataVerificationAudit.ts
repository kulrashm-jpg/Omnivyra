/**
 * Intelligence Pipeline Data Verification Audit
 * Run: npx ts-node backend/scripts/dataVerificationAudit.ts
 * Read-only. Requires: SUPABASE_*
 */

import { supabase } from '../db/supabaseClient';

async function countSince(table: string, dateCol: string, hoursAgo: number, pkCol = 'id'): Promise<number> {
  const since = new Date();
  since.setHours(since.getHours() - hoursAgo);
  const { count, error } = await supabase
    .from(table)
    .select(pkCol, { count: 'exact', head: true })
    .gte(dateCol, since.toISOString());
  if (error) return -1;
  return count ?? -1;
}

async function main() {
  const out: string[] = [];
  out.push('# Intelligence Pipeline Data Verification Audit Report');
  out.push('');
  out.push('**Date:** ' + new Date().toISOString());
  out.push('');

  // 1 - Signal Ingestion
  const { count: sigTotal } = await supabase.from('intelligence_signals').select('id', { count: 'exact', head: true });
  const sig24h = await countSince('intelligence_signals', 'created_at', 24);
  const { data: sigRecent } = await supabase
    .from('intelligence_signals')
    .select('topic, source_api_id, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  out.push('## 1 — Signal Ingestion Results');
  out.push('');
  out.push('| Metric | Value |');
  out.push('|--------|-------|');
  out.push(`| Total signals | ${sigTotal ?? -1} |`);
  out.push(`| Signals last 24h | ${sig24h} |`);
  out.push('');
  out.push('**Recent signals (topic, source_api_id, created_at):**');
  if (sigRecent?.length) {
    out.push('| topic | source_api_id | created_at |');
    out.push('|-------|---------------|------------|');
    for (const r of sigRecent.slice(0, 15)) {
      const s = r as { topic?: string; source_api_id: string; created_at: string };
      out.push(`| ${(s.topic ?? '-').slice(0, 40)} | ${s.source_api_id?.slice(0, 8)}... | ${s.created_at ?? '-'} |`);
    }
  } else out.push('*(none)*');
  out.push('');

  // 2 - Clustering
  const { count: clusterCount } = await supabase.from('signal_clusters').select('cluster_id', { count: 'exact', head: true });
  const { data: clusters } = await supabase.from('signal_clusters').select('cluster_id, cluster_topic, signal_count').order('signal_count', { ascending: false }).limit(10);
  out.push('## 2 — Clustering Results');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| signal_clusters | ${clusterCount ?? -1} |`);
  out.push('');
  out.push('**Cluster sample (cluster_id, cluster_topic, signal_count):**');
  if (clusters?.length) {
    out.push('| cluster_id | cluster_topic | signal_count |');
    out.push('|------------|---------------|--------------|');
    for (const c of clusters.slice(0, 5)) {
      const x = c as { cluster_id: string; cluster_topic?: string; signal_count?: number };
      out.push(`| ${x.cluster_id?.slice(0, 8)}... | ${(x.cluster_topic ?? '-').slice(0, 30)} | ${x.signal_count ?? 0} |`);
    }
  } else out.push('*(none)*');
  out.push('');

  // 3 - Signal Intelligence
  const { count: siCount } = await supabase.from('signal_intelligence').select('id', { count: 'exact', head: true });
  const { data: siSample } = await supabase.from('signal_intelligence').select('cluster_id, momentum_score, trend_direction').limit(10);
  out.push('## 3 — Signal Intelligence Results');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| signal_intelligence | ${siCount ?? -1} |`);
  out.push('');
  out.push('**Sample (cluster_id, momentum_score, trend_direction):**');
  if (siSample?.length) {
    out.push('| cluster_id | momentum_score | trend_direction |');
    out.push('|------------|----------------|-----------------|');
    for (const s of siSample.slice(0, 5)) {
      const x = s as { cluster_id: string; momentum_score?: number; trend_direction?: string };
      out.push(`| ${x.cluster_id?.slice(0, 8)}... | ${x.momentum_score ?? '-'} | ${x.trend_direction ?? '-'} |`);
    }
  } else out.push('*(none)*');
  out.push('');

  // 4 - Strategic Themes
  const { count: themeCount } = await supabase.from('strategic_themes').select('id', { count: 'exact', head: true });
  const { data: themeRecent } = await supabase
    .from('strategic_themes')
    .select('theme_title, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  out.push('## 4 — Strategic Theme Generation');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| strategic_themes | ${themeCount ?? -1} |`);
  out.push('');
  out.push('**Recent themes (theme_title, created_at):**');
  if (themeRecent?.length) {
    out.push('| theme_title | created_at |');
    out.push('|-------------|------------|');
    for (const t of themeRecent.slice(0, 5)) {
      const x = t as { theme_title: string; created_at: string };
      out.push(`| ${(x.theme_title ?? '-').slice(0, 50)} | ${x.created_at ?? '-'} |`);
    }
  } else out.push('*(none)*');
  out.push('');

  // 5 - Company Signal Distribution
  const { count: cisCount } = await supabase.from('company_intelligence_signals').select('id', { count: 'exact', head: true });
  const { data: cisByCo } = await supabase.from('company_intelligence_signals').select('company_id');
  const byCo: Record<string, number> = {};
  for (const r of cisByCo ?? []) {
    const c = (r as { company_id: string }).company_id;
    byCo[c] = (byCo[c] ?? 0) + 1;
  }
  out.push('## 5 — Company Signal Distribution');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| company_intelligence_signals | ${cisCount ?? -1} |`);
  out.push('');
  out.push('**Distribution by company:**');
  out.push('| company_id | count |');
  out.push('|------------|-------|');
  for (const [cid, cnt] of Object.entries(byCo).sort((a, b) => b[1] - a[1])) {
    out.push(`| ${cid.slice(0, 8)}... | ${cnt} |`);
  }
  if (Object.keys(byCo).length === 0) out.push('| *(none)* | |');
  out.push('');

  // 6 - Source Coverage
  const { data: sourceCounts } = await supabase.from('intelligence_signals').select('source_api_id');
  const bySource: Record<string, number> = {};
  const { data: sources } = await supabase.from('external_api_sources').select('id, name');
  const sourceNames = new Map((sources ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
  for (const r of sourceCounts ?? []) {
    const sid = (r as { source_api_id: string }).source_api_id;
    bySource[sid] = (bySource[sid] ?? 0) + 1;
  }
  out.push('## 6 — Source Coverage');
  out.push('');
  out.push('| Source | Signal Count |');
  out.push('|--------|--------------|');
  for (const [sid, cnt] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    out.push(`| ${sourceNames.get(sid) ?? sid.slice(0, 8)} | ${cnt} |`);
  }
  if (Object.keys(bySource).length === 0) out.push('| *(none)* | |');
  out.push('');

  // 7 - Normalization Validation
  const { data: normSample } = await supabase
    .from('intelligence_signals')
    .select('topic, confidence_score, source_api_id')
    .limit(10);
  out.push('## 7 — Normalization Validation');
  out.push('');
  out.push('| topic | confidence_score | source_api_id |');
  out.push('|-------|------------------|---------------|');
  if (normSample?.length) {
    for (const r of normSample.slice(0, 5)) {
      const x = r as { topic?: string; confidence_score?: number; source_api_id: string };
      out.push(`| ${(x.topic ?? '-').slice(0, 35)} | ${x.confidence_score ?? '-'} | ${x.source_api_id?.slice(0, 8)}... |`);
    }
  } else out.push('| *(no signals)* | | |');
  out.push('');
  out.push('| Field | Status |');
  out.push('|-------|--------|');
  const hasTopic = normSample?.some((r: { topic?: string }) => r.topic?.trim());
  const hasConf = normSample?.some((r: { confidence_score?: number }) => r.confidence_score != null);
  const hasSource = normSample?.some((r: { source_api_id?: string }) => r.source_api_id);
  out.push(`| topic | ${hasTopic ? 'populated' : 'empty/none'} |`);
  out.push(`| confidence_score | ${hasConf ? 'populated' : 'empty/none'} |`);
  out.push(`| source_api_id | ${hasSource ? 'populated' : 'empty/none'} |`);
  out.push('');

  // 8 - End-to-End Pipeline Status
  const hasSignals = (sigTotal ?? 0) > 0;
  const hasClusters = (clusterCount ?? 0) > 0;
  const hasSI = (siCount ?? 0) > 0;
  const hasThemes = (themeCount ?? 0) > 0;
  const hasCIS = (cisCount ?? 0) > 0;
  out.push('## 8 — End-to-End Pipeline Status');
  out.push('');
  out.push('| Stage | Status |');
  out.push('|-------|--------|');
  out.push('| polling job executed | ' + (hasSignals ? '✓' : '○') + ' |');
  out.push('| API fetch | ' + (hasSignals ? '✓' : '○') + ' |');
  out.push('| normalization | ' + (hasSignals ? '✓' : '○') + ' |');
  out.push('| signals inserted | ' + (hasSignals ? '✓' : '○') + ' |');
  out.push('| clustering | ' + (hasClusters ? '✓' : '○') + ' |');
  out.push('| signal intelligence | ' + (hasSI ? '✓' : '○') + ' |');
  out.push('| theme generation | ' + (hasThemes ? '✓' : '○') + ' |');
  out.push('| company distribution | ' + (hasCIS ? '✓' : '○') + ' |');
  out.push('');

  console.log(out.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
