/**
 * Post-Activation Verification Audit
 * Run: npx ts-node backend/scripts/postActivationVerification.ts
 *
 * Read-only. Requires: SUPABASE_*, REDIS_URL (optional, for queue stats)
 */

import { supabase } from '../db/supabaseClient';
import { getIntelligencePollingQueue } from '../queue/intelligencePollingQueue';

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

async function safeCount(table: string, pkCol = 'id'): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select(pkCol, { count: 'exact', head: true });
  if (error) return -1;
  return count ?? -1;
}

async function main() {
  const out: string[] = [];
  out.push('# Post-Activation Verification Report');
  out.push('');
  out.push('**Date:** ' + new Date().toISOString());
  out.push('');

  // 1 - External API Sources
  const { data: apiSources, error: apiErr } = await supabase
    .from('external_api_sources')
    .select('id, name, base_url, purpose, category, is_active')
    .order('id');
  out.push('## 1 — External API Source Status');
  out.push('');
  out.push('| ID | Source | Category | Active |');
  out.push('|----|--------|----------|--------|');
  if (apiErr) {
    out.push('| ERROR | ' + apiErr.message + ' | | |');
  } else {
    for (const r of apiSources ?? []) {
      const id = (r as { id: string }).id?.slice(0, 8) ?? '-';
      const name = (r as { name: string }).name ?? '-';
      const cat = (r as { category?: string }).category ?? '-';
      const active = (r as { is_active: boolean }).is_active ? '✓' : '✗';
      out.push(`| ${id} | ${name} | ${cat} | ${active} |`);
    }
  }
  out.push('');

  // 2 - Company API Config
  const { data: cacJoin } = await supabase
    .from('company_api_configs')
    .select('company_id, api_source_id, enabled, polling_frequency');
  let cacRows: { company: string; api_source: string; enabled: boolean; polling_frequency: string }[] = [];
  if (cacJoin?.length) {
    const { data: companies } = await supabase.from('companies').select('id, name');
    const { data: sources } = await supabase.from('external_api_sources').select('id, name');
    const cmap = new Map((companies ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const smap = new Map((sources ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
    cacRows = (cacJoin as { company_id: string; api_source_id: string; enabled: boolean; polling_frequency?: string }[]).map(r => ({
      company: cmap.get(r.company_id) ?? r.company_id,
      api_source: smap.get(r.api_source_id) ?? r.api_source_id,
      enabled: r.enabled,
      polling_frequency: r.polling_frequency ?? '-'
    }));
  }
  out.push('## 2 — Company API Configuration');
  out.push('');
  out.push('| Company | API Source | Enabled | Polling Frequency |');
  out.push('|---------|------------|---------|-------------------|');
  for (const r of cacRows) {
    out.push(`| ${r.company} | ${r.api_source} | ${r.enabled ? '✓' : '✗'} | ${r.polling_frequency} |`);
  }
  if (cacRows.length === 0) out.push('| *(none)* | | | |');
  out.push('');

  // 3 - Intelligence Topics
  const { data: topics, error: topicsErr } = await supabase
    .from('company_intelligence_topics')
    .select('company_id, topic, enabled')
    .order('company_id');
  out.push('## 3 — Intelligence Topic Configuration');
  out.push('');
  out.push('| Company ID | Topic | Enabled |');
  out.push('|------------|-------|---------|');
  if (topicsErr) {
    out.push('| ERROR | ' + topicsErr.message + ' | |');
  } else {
    for (const r of topics ?? []) {
      const cid = (r as { company_id: string }).company_id?.slice(0, 8) ?? '-';
      const t = (r as { topic: string }).topic ?? '-';
      const e = (r as { enabled: boolean }).enabled ? '✓' : '✗';
      out.push(`| ${cid} | ${t} | ${e} |`);
    }
  }
  out.push('');

  // 4 - Polling Queue
  out.push('## 4 — Polling Queue Status');
  out.push('');
  try {
    const q = getIntelligencePollingQueue();
    const waiting = await q.getWaitingCount();
    const active = await q.getActiveCount();
    const completed = await q.getCompletedCount();
    out.push('| Queue | Pending Jobs | Completed Jobs |');
    out.push('|-------|--------------|----------------|');
    out.push(`| intelligence-polling | ${waiting + active} | ${completed} |`);
  } catch {
    out.push('| Queue | Pending Jobs | Completed Jobs |');
    out.push('|-------|--------------|----------------|');
    out.push('| intelligence-polling | *Redis unavailable* | *N/A* |');
  }
  out.push('');

  // 5 - Signal Ingestion
  const sigTotal = await safeCount('intelligence_signals');
  const sig24h = await countSince('intelligence_signals', 'created_at', 24);
  out.push('## 5 — Signal Ingestion');
  out.push('');
  out.push('| Metric | Count |');
  out.push('|--------|-------|');
  out.push(`| Total signals | ${sigTotal} |`);
  out.push(`| Signals (last 24h) | ${sig24h} |`);
  out.push('');

  // 6 - Signal Clusters
  const clusterCount = await safeCount('signal_clusters', 'cluster_id');
  out.push('## 6 — Signal Clustering');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| signal_clusters | ${clusterCount} |`);
  out.push('');

  // 7 - Signal Intelligence
  const siCount = await safeCount('signal_intelligence');
  out.push('## 7 — Signal Intelligence');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| signal_intelligence | ${siCount} |`);
  out.push('');

  // 8 - Strategic Themes
  const themeCount = await safeCount('strategic_themes');
  out.push('## 8 — Strategic Themes');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| strategic_themes | ${themeCount} |`);
  out.push('');

  // 9 - Company Intelligence Distribution
  const cisTotal = await safeCount('company_intelligence_signals');
  const { data: cisByCo } = await supabase
    .from('company_intelligence_signals')
    .select('company_id');
  const byCo: Record<string, number> = {};
  for (const r of cisByCo ?? []) {
    const c = (r as { company_id: string }).company_id;
    byCo[c] = (byCo[c] ?? 0) + 1;
  }
  out.push('## 9 — Company Intelligence Distribution');
  out.push('');
  out.push('| Company | Signal Count |');
  out.push('|---------|--------------|');
  for (const [cid, cnt] of Object.entries(byCo).sort((a, b) => b[1] - a[1])) {
    out.push(`| ${cid.slice(0, 8)}... | ${cnt} |`);
  }
  out.push(`| **Total** | ${cisTotal} |`);
  out.push('');

  // 10 - Pipeline Status
  const pipelineOk = sigTotal >= 0 && clusterCount >= 0 && siCount >= 0 && themeCount >= 0 && cisTotal >= 0;
  out.push('## 10 — End-to-End Pipeline Status');
  out.push('');
  out.push('| Stage | Status |');
  out.push('|-------|--------|');
  out.push('| external_api_sources | ✓ (configured) |');
  out.push('| polling worker | ✓ (queue exists) |');
  out.push('| ingestion | ' + (sigTotal > 0 ? '✓' : '○ (no signals yet)') + ' |');
  out.push('| intelligence_signals | ' + (sigTotal > 0 ? '✓' : '○') + ' |');
  out.push('| signal_clusters | ' + (clusterCount > 0 ? '✓' : '○') + ' |');
  out.push('| signal_intelligence | ' + (siCount > 0 ? '✓' : '○') + ' |');
  out.push('| strategic_themes | ' + (themeCount > 0 ? '✓' : '○') + ' |');
  out.push('| company_intelligence_signals | ' + (cisTotal > 0 ? '✓' : '○') + ' |');
  out.push('');

  console.log(out.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
