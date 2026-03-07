/**
 * Live Execution Debug — Run diagnostic checks for intelligence pipeline.
 * Run: npx ts-node backend/scripts/liveExecutionDebug.ts
 * Does NOT start cron or workers; simulates enqueue and checks env.
 */

import { supabase } from '../db/supabaseClient';
import { enqueueIntelligencePolling } from '../scheduler/schedulerService';
import { getIntelligencePollingQueue } from '../queue/intelligencePollingQueue';

function envCheck(name: string): 'present' | 'missing' {
  const v = process.env[name];
  return v && String(v).trim().length > 0 ? 'present' : 'missing';
}

async function main() {
  const out: string[] = [];
  out.push('# Intelligence Pipeline Live Execution Debug Report');
  out.push('');
  out.push('**Date:** ' + new Date().toISOString());
  out.push('');

  // 1 — Cron
  out.push('## 1 — Cron Execution');
  out.push('');
  out.push('| Cron Running | Manual check required |');
  out.push('| Run `npm run start:cron` and observe logs every 60s |');
  out.push('');

  // 2 — Enqueue
  out.push('## 2 — Polling Job Enqueue');
  out.push('');
  try {
    console.log('[intelligence] enqueue polling triggered');
    const result = await enqueueIntelligencePolling();
    const { data: configRows } = await supabase.from('company_api_configs').select('api_source_id').eq('enabled', true);
    const { data: sources } = await supabase
      .from('external_api_sources')
      .select('id, name')
      .eq('is_active', true)
      .in('id', [...new Set((configRows ?? []).map((r: { api_source_id: string }) => r.api_source_id))]);
    out.push('| Enqueue Triggered | Yes |');
    out.push('| Sources Found | ' + (sources?.length ?? 0) + ' |');
    out.push('| Jobs Created | ' + result.enqueued + ' |');
    out.push('| Skipped (rate_limit) | ' + result.reasons.skipped_rate_limit + ' |');
    out.push('| Skipped (disabled) | ' + result.reasons.skipped_disabled + ' |');
  } catch (e: unknown) {
    out.push('| Enqueue Triggered | ERROR |');
    out.push('| Error | ' + String((e as Error)?.message ?? e) + ' |');
  }
  out.push('');

  // 3 — Queue / Redis
  out.push('## 3 — Queue Connection');
  out.push('');
  try {
    const q = getIntelligencePollingQueue();
    const waiting = await q.getWaitingCount();
    const completed = await q.getCompletedCount();
    out.push('| Redis Connected | Yes |');
    out.push('| Pending Jobs | ' + waiting + ' |');
    out.push('| Completed Jobs | ' + completed + ' |');
  } catch (e: unknown) {
    out.push('| Redis Connected | No |');
    out.push('| Error | ' + String((e as Error)?.message ?? e) + ' |');
  }
  out.push('');

  // 4 — Worker
  out.push('## 4 — Worker Execution');
  out.push('');
  out.push('| Worker Started | Manual: `npm run start:workers` |');
  out.push('| Jobs Received | Requires worker running to observe |');
  out.push('');

  // 5–7 — API / Normalize / Store (require worker processing jobs)
  out.push('## 5 — API Fetch Execution');
  out.push('');
  out.push('| API Source | Fetch Executed | Results Length |');
  out.push('| *Requires worker + jobs* | Run workers, then inspect logs |');
  out.push('');
  out.push('## 6 — Normalization Output');
  out.push('');
  out.push('| Source | Normalized Signals |');
  out.push('| *Requires worker processing* | Check logs: `[intelligenceIngestion] Normalized intelligence signals` |');
  out.push('');
  out.push('## 7 — Signal Storage Attempt');
  out.push('');
  out.push('| Signals Attempted | Signals Inserted |');
  out.push('| *Requires worker* | Query `SELECT COUNT(*) FROM intelligence_signals` after run |');
  out.push('');

  // 8 — Env
  out.push('## 8 — Environment Variables');
  out.push('');
  out.push('| Variable | Present |');
  out.push('|----------|---------|');
  out.push('| YOUTUBE_API_KEY | ' + envCheck('YOUTUBE_API_KEY') + ' |');
  out.push('| NEWS_API_KEY | ' + envCheck('NEWS_API_KEY') + ' |');
  out.push('| SERPAPI_KEY | ' + envCheck('SERPAPI_KEY') + ' |');
  out.push('| REDIS_URL | ' + envCheck('REDIS_URL') + ' |');
  out.push('| SUPABASE_URL | ' + (envCheck('SUPABASE_URL') === 'present' || envCheck('NEXT_PUBLIC_SUPABASE_URL') === 'present' ? 'present' : 'missing') + ' |');
  out.push('| SUPABASE_SERVICE_ROLE_KEY | ' + envCheck('SUPABASE_SERVICE_ROLE_KEY') + ' |');
  out.push('');

  // Root cause
  const envMissing: string[] = [];
  if (envCheck('REDIS_URL') === 'missing') envMissing.push('REDIS_URL');
  if (envCheck('SUPABASE_URL') === 'missing' && envCheck('NEXT_PUBLIC_SUPABASE_URL') === 'missing')
    envMissing.push('SUPABASE_URL');
  if (envCheck('SUPABASE_SERVICE_ROLE_KEY') === 'missing') envMissing.push('SUPABASE_SERVICE_ROLE_KEY');
  const apiKeysMissing = ['YOUTUBE_API_KEY', 'NEWS_API_KEY', 'SERPAPI_KEY'].filter(
    (k) => envCheck(k) === 'missing'
  );

  out.push('## Root Cause');
  out.push('');
  out.push('**Identified failure points:**');
  out.push('');
  if (envMissing.length > 0) {
    out.push('- **Missing env:** ' + envMissing.join(', ') + ' — cron/workers and DB access will fail.');
  }
  if (apiKeysMissing.length > 0) {
    out.push('- **Missing API keys:** ' + apiKeysMissing.join(', ') + ' — API fetch returns empty results.');
  }
  out.push('- **Cron not running:** If `npm run start:cron` is not running, `enqueueIntelligencePolling` never executes.');
  out.push('- **Workers not running:** If `npm run start:workers` is not running, enqueued jobs are never processed.');
  out.push('');

  console.log(out.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
