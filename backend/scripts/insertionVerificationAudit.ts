/**
 * Database Insertion Verification Audit
 * Run: npx ts-node backend/scripts/insertionVerificationAudit.ts
 * Verifies: normalization → store → Supabase insert flow
 */

import { supabase } from '../db/supabaseClient';
import { insertNormalizedSignals } from '../services/intelligenceSignalStore';

async function main() {
  const out: string[] = [];
  out.push('# Database Insertion Verification Audit');
  out.push('');
  out.push('**Date:** ' + new Date().toISOString());
  out.push('');

  // 1. Count
  const { count: total } = await supabase
    .from('intelligence_signals')
    .select('id', { count: 'exact', head: true });
  out.push('## 1 — Signal Count');
  out.push('');
  out.push(`\`SELECT COUNT(*) FROM intelligence_signals\` → **${total ?? 0}**`);
  out.push('');

  // 2. Latest rows
  const { data: latest } = await supabase
    .from('intelligence_signals')
    .select('topic, source_api_id, confidence_score, detected_at')
    .order('detected_at', { ascending: false })
    .limit(10);
  out.push('## 2 — Latest Signals');
  out.push('');
  if (latest?.length) {
    out.push('| topic | source_api_id | confidence_score | detected_at |');
    out.push('|-------|---------------|-----------------|-------------|');
    for (const r of latest) {
      const t = r as { topic?: string; source_api_id?: string; confidence_score?: number; detected_at?: string };
      out.push(`| ${(t.topic ?? '-').slice(0, 40)} | ${(t.source_api_id ?? '-').slice(0, 8)}... | ${t.confidence_score ?? '-'} | ${t.detected_at ?? '-'} |`);
    }
  } else {
    out.push('*(none)*');
  }
  out.push('');

  // 3. Idempotency keys (if any rows)
  const { data: idemKeys } = await supabase
    .from('intelligence_signals')
    .select('idempotency_key')
    .limit(5);
  out.push('## 3 — Idempotency Keys Sample');
  out.push('');
  out.push(idemKeys?.length ? idemKeys.map((r: any) => r.idempotency_key).join(', ') : '*(no rows)*');
  out.push('');

  // 4. Test insert — need existing source_api_id
  const { data: sources } = await supabase
    .from('external_api_sources')
    .select('id')
    .eq('is_active', true)
    .limit(1);
  const sourceId = sources?.[0]?.id;

  if (!sourceId) {
    out.push('## 4 — Test Insert');
    out.push('');
    out.push('**Skipped:** No active `external_api_sources` found. Cannot run test insert.');
  } else {
    const testSignal = {
      source_api_id: sourceId,
      company_id: null,
      signal_type: 'trend',
      topic: 'AI Test Signal',
      confidence_score: 0.9,
      detected_at: new Date().toISOString(),
      normalized_payload: {},
      raw_payload: {},
      idempotency_key: 'test-' + Date.now(),
    };
    try {
      const result = await insertNormalizedSignals([testSignal as any], { signal_type: 'trend' });
      out.push('## 4 — Test Insert');
      out.push('');
      out.push('**Payload:**');
      out.push('```json');
      out.push(JSON.stringify(testSignal, null, 2));
      out.push('```');
      out.push('');
      out.push(`**Result:** inserted=${result.inserted}, skipped=${result.skipped}`);
    } catch (err) {
      out.push('## 4 — Test Insert');
      out.push('');
      out.push('**Error:** ' + (err as Error).message);
    }
  }

  out.push('');
  out.push('---');
  console.log(out.join('\n'));
}

main().catch(console.error);
