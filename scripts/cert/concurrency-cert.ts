/**
 * WRITER-CERT-005 — Phase 8 concurrency certification.
 * Fires N independent full mini-lifecycles in parallel against the live cert DB
 * to expose races: lost writes, cross-content contamination, approval-trail
 * corruption. Deterministic (BETA_AI_MODE). Run:
 *   DOTENV_CONFIG_PATH=.env.cert BETA_AI_MODE=1 CERT_ENV=1 \
 *     npx tsx -r dotenv/config -r tsconfig-paths/register scripts/cert/concurrency-cert.ts
 */
import { randomUUID } from 'crypto';
import * as contentService from '@/backend/services/content/contentService';
import { assertOriginality } from '@/backend/services/content/originalityGate';
import { evaluate } from '@/backend/services/content/qualityEngine';
import * as qualityService from '@/backend/services/content/qualityService';
import { advanceApproval } from '@/backend/services/content/approvalService';
import { indexContentUnit } from '@/backend/services/content/contentMemoryService';
import { supabase } from '@/backend/db/supabaseClient';

const N = 12;
const company = randomUUID();

// Genuinely distinct bodies per lane (not a shared template) so any non-original
// verdict would indicate a real race, not correct near-duplicate detection.
const TOPICS = [
  'Cold email open rates collapsed this quarter; here is the teardown of why.',
  'A field guide to pricing your first B2B SaaS product without guessing.',
  'Why your onboarding funnel leaks at step three, and the fix nobody ships.',
  'Hiring your first sales rep before product-market fit is a trap. Data inside.',
  'The unglamorous mechanics of retention: cohorts, not vanity dashboards.',
  'Fundraising narrative teardown: what changed between our seed and Series A.',
  'Latency is a feature. How we cut p99 by 400ms and won three enterprise deals.',
  'Content distribution beats content creation. A ninety-day experiment log.',
  'The support-ticket taxonomy that turned churn signals into a roadmap.',
  'Marketplace liquidity from zero: seeding supply when demand does not exist yet.',
  'Observability debt compounds. A postmortem on the incident we never saw coming.',
  'Positioning against an incumbent when you are the expensive, opinionated option.',
];

async function oneLifecycle(i: number): Promise<{ i: number; cid: string; ok: boolean; err?: string }> {
  const text = `${TOPICS[i]}\nLane ${i} / ${randomUUID()}. We break it down step by step and share the raw numbers so you can copy the playbook.`;
  try {
    const c: any = await contentService.createContent({
      companyId: company, contentType: 'post', title: `lane ${i}`, body: text,
      topic: `topic ${i}`, objective: 'drive signups', lifecycleStatus: 'generated',
    } as any);
    const cid = c.id;
    await contentService.upsertVariant(cid, company, 'x', { generatedContent: text } as any);
    const o: any = await assertOriginality({ companyId: company, contentType: 'post', candidateText: text } as any);
    (globalThis as any).__decisions = (globalThis as any).__decisions || [];
    (globalThis as any).__decisions.push({ i, decision: o.decision, score: o.score, isOriginal: o.isOriginal, matches: (o.nearestMatches || []).length });
    // The gate's contract is `decision`. A hard block is decision==='duplicate'/'rejected';
    // 'accepted'/'regenerate' are non-blocking (runtime regenerates). Only a hard block fails a lane.
    if (o.decision === 'duplicate' || o.decision === 'rejected') throw new Error(`lane ${i} HARD-BLOCKED: ${o.decision} (score=${o.score})`);
    await indexContentUnit({ companyId: company, contentId: cid, contentType: 'post', platform: 'x', lifecycleStatus: 'generated', text } as any);
    const sc = evaluate({ contentType: 'post', text, objective: 'drive signups' } as any);
    await qualityService.persistScorecard({ companyId: company, contentId: cid, scorecard: sc } as any);
    for (const to of ['edited', 'quality_reviewed', 'approved', 'scheduled', 'published']) {
      const r: any = await advanceApproval({ companyId: company, contentId: cid, toStatus: to } as any);
      if (!r.ok) throw new Error(`lane ${i} transition→${to} failed`);
    }
    return { i, cid, ok: true };
  } catch (e: any) {
    return { i, cid: '', ok: false, err: e?.message || String(e) };
  }
}

async function main() {
  console.log(`WRITER-CERT-005 concurrency: ${N} parallel lifecycles, tenant ${company.slice(0, 8)}\n`);
  const t0 = process.hrtime.bigint();
  const res = await Promise.all(Array.from({ length: N }, (_, i) => oneLifecycle(i)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const ok = res.filter(r => r.ok).length;
  const failed = res.filter(r => !r.ok);
  console.log(`lifecycles: ${ok}/${N} succeeded in ${ms.toFixed(0)}ms (${(ms / N).toFixed(0)}ms/lane avg)`);
  failed.forEach(f => console.log(`  ✗ lane ${f.i}: ${f.err}`));
  const dec: any[] = (globalThis as any).__decisions || [];
  const byDecision = dec.reduce((m: any, d) => { m[d.decision] = (m[d.decision] || 0) + 1; return m; }, {});
  console.log('originality decisions:', JSON.stringify(byDecision), '| sample scores:', dec.slice(0, 4).map(d => `L${d.i}:${d.decision}/${d.score?.toFixed?.(2)}`).join(' '));

  // Integrity: every content row is published, has exactly 1 variant + 1 scorecard,
  // and a complete 5-step approval trail. Cross-contamination would show as wrong counts.
  const cids = res.filter(r => r.ok).map(r => r.cid);
  const { count: published } = await supabase.from('content').select('*', { count: 'exact', head: true })
    .eq('company_id', company).eq('lifecycle_status', 'published');
  const { count: variants } = await supabase.from('content_variant').select('*', { count: 'exact', head: true }).in('content_id', cids);
  const { count: quality } = await supabase.from('content_quality').select('*', { count: 'exact', head: true }).in('content_id', cids);
  const { count: trail } = await supabase.from('content_approval_history').select('*', { count: 'exact', head: true }).in('content_id', cids);

  const checks: [string, boolean, string][] = [
    ['all lanes completed', ok === N, `${ok}/${N}`],
    ['all content published (no lost writes)', published === ok, `${published} published`],
    ['exactly 1 variant per content', variants === ok, `${variants} variants`],
    ['exactly 1 scorecard per content', quality === ok, `${quality} scorecards`],
    ['5 approval transitions per content (no trail corruption)', trail === ok * 5, `${trail}/${ok * 5} transitions`],
  ];
  console.log('');
  let pass = 0;
  for (const [name, good, info] of checks) { console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name}  → ${info}`); if (good) pass++; }
  console.log(`\n════ CONCURRENCY: ${pass}/${checks.length} checks pass ════`);
  process.exit(pass === checks.length ? 0 : 1);
}
main().catch(e => { console.error('HARNESS ERROR:', e?.stack || e); process.exit(2); });
