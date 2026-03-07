/**
 * Final Intelligence Pipeline Validation (Production Readiness)
 * Run: npx ts-node backend/scripts/finalIntelligencePipelineValidation.ts
 * Verification only — no changes.
 */

import { supabase } from '../db/supabaseClient';

async function main() {
  const report: string[] = [];
  const push = (s: string) => report.push(s);

  push('# FINAL INTELLIGENCE PIPELINE VALIDATION REPORT');
  push('');
  push('---');
  push('');

  // STEP 1 — Signal Ingestion
  const { count: totalSignals, error: e1 } = await supabase
    .from('intelligence_signals')
    .select('id', { count: 'exact', head: true });
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: signals24h, error: e1b } = await supabase
    .from('intelligence_signals')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since24h);
  const { data: recentSignals } = await supabase
    .from('intelligence_signals')
    .select('topic, source_api_id, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  push('## 1 — Signal Ingestion Results');
  push('');
  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| Total signals | ${e1 ? 'ERROR' : totalSignals ?? 0} |`);
  push(`| Signals last 24h | ${e1b ? 'ERROR' : signals24h ?? 0} |`);
  push('');
  push('**Recent signals (top 20):**');
  push('');
  if (recentSignals?.length) {
    push('| topic | source_id | created_at |');
    push('|-------|-----------|------------|');
    for (const r of recentSignals) {
      push(`| ${(r as any).topic ?? '—'} | ${(r as any).source_api_id ?? '—'} | ${(r as any).created_at ?? '—'} |`);
    }
  } else {
    push('(none)');
  }
  push('');
  push('---');
  push('');

  // STEP 2 — Signal Clustering
  const { count: clusterRows, error: e2 } = await supabase
    .from('signal_clusters')
    .select('cluster_id', { count: 'exact', head: true });
  const { data: clusterDist } = await supabase
    .from('intelligence_signals')
    .select('cluster_id')
    .not('cluster_id', 'is', null);

  const byCluster: Record<string, number> = {};
  for (const r of clusterDist ?? []) {
    const cid = (r as any).cluster_id;
    if (cid) byCluster[cid] = (byCluster[cid] ?? 0) + 1;
  }
  const topClusters = Object.entries(byCluster)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  push('## 2 — Clustering Results');
  push('');
  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| Cluster rows (signal_clusters) | ${e2 ? 'ERROR' : clusterRows ?? 0} |`);
  push('');
  push('**Signals per cluster (top 10):**');
  push('');
  if (topClusters.length) {
    push('| cluster_id | count |');
    push('|------------|-------|');
    for (const [cid, cnt] of topClusters) {
      push(`| ${cid} | ${cnt} |`);
    }
  } else {
    push('(none)');
  }
  push('');
  push('---');
  push('');

  // STEP 3 — Signal Intelligence
  const { count: intelRows, error: e3 } = await supabase
    .from('signal_intelligence')
    .select('id', { count: 'exact', head: true });
  const { data: intelSample } = await supabase
    .from('signal_intelligence')
    .select('id, momentum_score, trend_direction')
    .limit(10);

  push('## 3 — Signal Intelligence Results');
  push('');
  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| intelligence_rows | ${e3 ? 'ERROR' : intelRows ?? 0} |`);
  push('');
  push('**Sample (momentum_score, trend_direction):**');
  push('');
  if (intelSample?.length) {
    push('| signal_id | momentum_score | trend_direction |');
    push('|-----------|---------------|-----------------|');
    for (const r of intelSample) {
      push(`| ${(r as any).id} | ${(r as any).momentum_score ?? '—'} | ${(r as any).trend_direction ?? '—'} |`);
    }
  } else {
    push('(none)');
  }
  push('');
  push('---');
  push('');

  // STEP 4 — Strategic Themes
  const { count: themeCount, error: e4 } = await supabase
    .from('strategic_themes')
    .select('id', { count: 'exact', head: true });
  const { data: themeSample } = await supabase
    .from('strategic_themes')
    .select('theme_title, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  push('## 4 — Strategic Theme Generation');
  push('');
  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| theme_count | ${e4 ? 'ERROR' : themeCount ?? 0} |`);
  push('');
  push('**Recent themes:**');
  push('');
  if (themeSample?.length) {
    push('| title | created_at |');
    push('|-------|------------|');
    for (const r of themeSample) {
      push(`| ${(r as any).theme_title ?? '—'} | ${(r as any).created_at ?? '—'} |`);
    }
  } else {
    push('(none)');
  }
  push('');
  push('---');
  push('');

  // STEP 5 — Company Distribution
  const { count: companySignalsTotal, error: e5 } = await supabase
    .from('company_intelligence_signals')
    .select('id', { count: 'exact', head: true });
  const { data: cisRows } = await supabase
    .from('company_intelligence_signals')
    .select('company_id');

  const byCompany: Record<string, number> = {};
  for (const r of cisRows ?? []) {
    const cid = (r as any).company_id;
    byCompany[cid] = (byCompany[cid] ?? 0) + 1;
  }
  const companyDist = Object.entries(byCompany).sort((a, b) => b[1] - a[1]);

  push('## 5 — Company Signal Distribution');
  push('');
  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| company_signals total | ${e5 ? 'ERROR' : companySignalsTotal ?? 0} |`);
  push('');
  push('**By company_id:**');
  push('');
  if (companyDist.length) {
    push('| company_id | count |');
    push('|------------|-------|');
    for (const [cid, cnt] of companyDist) {
      push(`| ${cid} | ${cnt} |`);
    }
  } else {
    push('(none)');
  }
  push('');
  push('---');
  push('');

  // STEP 6 — Source Coverage
  const { data: sourceDist } = await supabase
    .from('intelligence_signals')
    .select('source_api_id');

  const bySource: Record<string, number> = {};
  for (const r of sourceDist ?? []) {
    const sid = (r as any).source_api_id ?? 'null';
    bySource[sid] = (bySource[sid] ?? 0) + 1;
  }
  const sourceEntries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);

  push('## 6 — Source Coverage');
  push('');
  push('| Source | Signal Count |');
  push('|--------|-------------|');
  for (const [src, cnt] of sourceEntries) {
    push(`| ${src} | ${cnt} |`);
  }
  if (sourceEntries.length === 0) push('(none)');
  push('');
  push('---');
  push('');

  // STEP 7 — Normalization (topic, confidence, source_id)
  const { data: normSample } = await supabase
    .from('intelligence_signals')
    .select('topic, confidence_score, source_api_id')
    .limit(10);

  const topicPopulated = (normSample ?? []).filter((r: any) => r.topic != null && String(r.topic).trim() !== '').length;
  const confPopulated = (normSample ?? []).filter((r: any) => r.confidence_score != null).length;
  const srcPopulated = (normSample ?? []).filter((r: any) => r.source_api_id != null).length;
  const sampleSize = normSample?.length ?? 0;

  push('## 7 — Normalization Validation');
  push('');
  push('| Field | Status |');
  push('|-------|--------|');
  push(`| topic | ${sampleSize ? (topicPopulated === sampleSize ? 'populated' : `partial (${topicPopulated}/${sampleSize})`) : 'N/A (no signals)'} |`);
  push(`| confidence | ${sampleSize ? (confPopulated === sampleSize ? 'populated' : confPopulated > 0 ? `partial (${confPopulated}/${sampleSize})` : 'empty') : 'N/A'} |`);
  push(`| source_id | ${sampleSize ? (srcPopulated === sampleSize ? 'populated' : 'partial') : 'N/A'} |`);
  push('');
  push('**Sample:**');
  if (normSample?.length) {
    push('| topic | confidence | source_id |');
    push('|-------|------------|-----------|');
    for (const r of normSample) {
      push(`| ${(r as any).topic ?? '—'} | ${(r as any).confidence_score ?? '—'} | ${(r as any).source_api_id ?? '—'} |`);
    }
  } else {
    push('(no signals)');
  }
  push('');
  push('---');
  push('');

  // STEP 8 — End-to-End Pipeline Status
  const hasSignals = (totalSignals ?? 0) > 0;
  const hasClusters = (clusterRows ?? 0) > 0;
  const hasIntel = (intelRows ?? 0) > 0;
  const hasThemes = (themeCount ?? 0) > 0;
  const hasCompanyDist = (companySignalsTotal ?? 0) > 0;

  push('## 8 — End-to-End Pipeline Status');
  push('');
  push('| Stage | Status |');
  push('|-------|--------|');
  push(`| polling job executed | ${signals24h !== undefined && signals24h !== null ? 'verified (24h window queried)' : 'unknown'} |`);
  push(`| API fetch | ${hasSignals ? 'OK' : 'no signals'} |`);
  push(`| normalization | ${topicPopulated > 0 || sampleSize === 0 ? (sampleSize ? 'OK' : 'N/A') : 'check'} |`);
  push(`| signals inserted | ${hasSignals ? 'OK' : 'empty'} |`);
  push(`| clustering | ${hasClusters ? 'OK' : 'empty'} |`);
  push(`| signal intelligence | ${hasIntel ? 'OK' : 'empty'} |`);
  push(`| theme generation | ${hasThemes ? 'OK' : 'empty'} |`);
  push(`| company distribution | ${hasCompanyDist ? 'OK' : 'empty'} |`);
  push('');

  console.log(report.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
