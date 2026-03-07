/**
 * Live Intelligence Pipeline Verification
 * Run: npx ts-node backend/scripts/livePipelineVerification.ts
 * Read-only. Requires: SUPABASE_*, REDIS_URL (optional)
 */

import { supabase } from '../db/supabaseClient';
import { getIntelligencePollingQueue } from '../queue/intelligencePollingQueue';

async function countSince(table: string, dateCol: string, hoursAgo: number, pkCol = 'id'): Promise<number> {
  const since = new Date();
  since.setHours(since.getHours() - hoursAgo);
  const { count, error } = await supabase.from(table).select(pkCol, { count: 'exact', head: true }).gte(dateCol, since.toISOString());
  if (error) return -1;
  return count ?? -1;
}

async function safeCount(table: string, pkCol = 'id'): Promise<number> {
  const { count, error } = await supabase.from(table).select(pkCol, { count: 'exact', head: true });
  if (error) return -1;
  return count ?? -1;
}

async function main() {
  const out: string[] = [];
  out.push('# Intelligence Pipeline Live Data Verification Report');
  out.push('');
  out.push('**Date:** ' + new Date().toISOString());
  out.push('');

  // 1 - Worker Status (from code - cannot run workers in script)
  out.push('## 1 — Worker Status');
  out.push('');
  out.push('| Worker | File |');
  out.push('|--------|------|');
  out.push('| Intelligence Polling Worker | backend/workers/intelligencePollingWorker.ts |');
  out.push('*Start: `npm run start:workers` or `npm run worker:bolt`*');
  out.push('');

  // 2 - Scheduler Status
  out.push('## 2 — Scheduler Status');
  out.push('');
  out.push('| Job | Interval |');
  out.push('|-----|----------|');
  out.push('| enqueueIntelligencePolling | 2 hours |');
  out.push('| runSignalClustering | 30 minutes |');
  out.push('| runSignalIntelligenceEngine | 1 hour |');
  out.push('| runStrategicThemeEngine | 1 hour |');
  out.push('*Start: `npm run start:cron`*');
  out.push('');

  // 3 - Queue Execution
  let pending = 0;
  let completed = 0;
  try {
    const q = getIntelligencePollingQueue();
    pending = (await q.getWaitingCount()) + (await q.getActiveCount());
    completed = await q.getCompletedCount();
  } catch {
    /* Redis may be unavailable */
  }
  out.push('## 3 — Queue Execution');
  out.push('');
  out.push('| Queue | Pending | Completed |');
  out.push('|-------|---------|-----------|');
  out.push(`| intelligence-polling | ${pending} | ${completed} |`);
  out.push('');

  // 4 - Signal Ingestion
  const sigTotal = await safeCount('intelligence_signals');
  const sig24h = await countSince('intelligence_signals', 'created_at', 24);
  const { data: sigSamples } = await supabase
    .from('intelligence_signals')
    .select('id, source_api_id, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  out.push('## 4 — Signal Ingestion');
  out.push('');
  out.push('| Metric | Value |');
  out.push('|--------|-------|');
  out.push(`| Total signals | ${sigTotal} |`);
  out.push(`| Signals last 24h | ${sig24h} |`);
  out.push('');
  out.push('**Sample (last 20):**');
  if (sigSamples?.length) {
    out.push('| id | source_api_id | created_at |');
    out.push('|----|---------------|------------|');
    for (const r of sigSamples.slice(0, 10)) {
      const s = r as { id: string; source_api_id: string; created_at: string };
      out.push(`| ${s.id?.slice(0, 8)}... | ${s.source_api_id?.slice(0, 8)}... | ${s.created_at ?? '-'} |`);
    }
    if (sigSamples.length > 10) out.push(`| ... (${sigSamples.length - 10} more) | | |`);
  } else out.push('*(no signals)*');
  out.push('');

  // 5 - Signal Clustering
  const clusterCount = await safeCount('signal_clusters', 'cluster_id');
  out.push('## 5 — Signal Clustering');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| signal_clusters | ${clusterCount} |`);
  out.push('');

  // 6 - Signal Intelligence
  const siCount = await safeCount('signal_intelligence');
  const { data: siSamples } = await supabase
    .from('signal_intelligence')
    .select('cluster_id, momentum_score, trend_direction')
    .limit(10);
  out.push('## 6 — Signal Intelligence');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| signal_intelligence | ${siCount} |`);
  if (siSamples?.length) {
    out.push('');
    out.push('**Sample:**');
    out.push('| cluster_id | momentum_score | trend_direction |');
    out.push('|------------|----------------|-----------------|');
    for (const r of siSamples.slice(0, 5)) {
      const s = r as { cluster_id: string; momentum_score?: number; trend_direction?: string };
      out.push(`| ${s.cluster_id?.slice(0, 8)}... | ${s.momentum_score ?? '-'} | ${s.trend_direction ?? '-'} |`);
    }
  }
  out.push('');

  // 7 - Strategic Themes
  const themeCount = await safeCount('strategic_themes');
  const { data: themeSamples } = await supabase
    .from('strategic_themes')
    .select('theme_title, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  out.push('## 7 — Strategic Themes');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| strategic_themes | ${themeCount} |`);
  if (themeSamples?.length) {
    out.push('');
    out.push('**Recent themes:**');
    out.push('| theme_title | created_at |');
    out.push('|-------------|------------|');
    for (const r of themeSamples.slice(0, 5)) {
      const t = r as { theme_title: string; created_at: string };
      out.push(`| ${(t.theme_title ?? '-').slice(0, 40)} | ${t.created_at ?? '-'} |`);
    }
  }
  out.push('');

  // 8 - Company Signal Distribution
  const cisTotal = await safeCount('company_intelligence_signals');
  const { data: cisByCo } = await supabase.from('company_intelligence_signals').select('company_id');
  const byCo: Record<string, number> = {};
  for (const r of cisByCo ?? []) {
    const c = (r as { company_id: string }).company_id;
    byCo[c] = (byCo[c] ?? 0) + 1;
  }
  out.push('## 8 — Company Signal Distribution');
  out.push('');
  out.push('| Table | Row Count |');
  out.push('|-------|-----------|');
  out.push(`| company_intelligence_signals | ${cisTotal} |`);
  out.push('');
  out.push('**By company:**');
  out.push('| company_id | count |');
  out.push('|------------|-------|');
  for (const [cid, cnt] of Object.entries(byCo).sort((a, b) => b[1] - a[1])) {
    out.push(`| ${cid.slice(0, 8)}... | ${cnt} |`);
  }
  out.push('');

  // 9 - End-to-End Pipeline Status
  out.push('## 9 — End-to-End Pipeline Status');
  out.push('');
  out.push('| Stage | Status |');
  out.push('|-------|--------|');
  out.push('| polling job created | ' + (pending > 0 || completed > 0 ? '✓' : '○') + ' |');
  out.push('| polling job executed | ' + (completed > 0 ? '✓' : '○') + ' |');
  out.push('| signals ingested | ' + (sigTotal > 0 ? '✓' : '○') + ' |');
  out.push('| clusters generated | ' + (clusterCount > 0 ? '✓' : '○') + ' |');
  out.push('| signal intelligence generated | ' + (siCount > 0 ? '✓' : '○') + ' |');
  out.push('| themes generated | ' + (themeCount > 0 ? '✓' : '○') + ' |');
  out.push('| company signals distributed | ' + (cisTotal > 0 ? '✓' : '○') + ' |');
  out.push('');

  console.log(out.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
