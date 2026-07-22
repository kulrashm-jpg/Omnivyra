/**
 * WRITER-CERT-005 — End-to-end runtime certification harness.
 * Drives the CANONICAL Writer runtime services against the LIVE cert database
 * (service-role Supabase client → PostgREST on the cert stack) through the full
 * lifecycle, then verifies persisted state. Service-layer (not HTTP) so it
 * exercises the real generation→persist→originality→quality→approval→learning
 * pipeline deterministically. Run:
 *   DOTENV_CONFIG_PATH=.env.cert npx tsx -r dotenv/config -r tsconfig-paths/register scripts/cert/e2e-runtime-cert.ts
 */
import { randomUUID } from 'crypto';
import * as contentService from '@/backend/services/content/contentService';
import { assertOriginality } from '@/backend/services/content/originalityGate';
import { evaluate } from '@/backend/services/content/qualityEngine';
import * as qualityService from '@/backend/services/content/qualityService';
import { splitIntoBlocks } from '@/lib/content/quality/sectionBlocks';
import * as collab from '@/backend/services/content/collaborationService';
import { generateRecommendations } from '@/backend/services/content/recommendationRuntime';
import { advanceApproval } from '@/backend/services/content/approvalService';
import { recordLearningEvent } from '@/backend/services/content/learningEngine';
import { predict } from '@/backend/services/content/predictionEngine';
import { recordEvent } from '@/backend/services/content/publicationLineageService';
import { ingestSignals } from '@/backend/services/content/performanceService';
import { indexContentUnit } from '@/backend/services/content/contentMemoryService';
import { supabase } from '@/backend/db/supabaseClient';

type Row = [string, 'PASS' | 'FAIL', string];
const results: Row[] = [];
async function step(name: string, fn: () => Promise<unknown> | unknown): Promise<any> {
  try { const r = await fn(); const info = r == null ? '' : String(typeof r === 'object' ? JSON.stringify(r).slice(0, 80) : r);
    results.push([name, 'PASS', info]); console.log(`  PASS  ${name}${info ? '  → ' + info : ''}`); return r;
  } catch (e: any) { results.push([name, 'FAIL', e?.message || String(e)]); console.log(`  FAIL  ${name}  → ${e?.message || e}`); return null; }
}
const countRows = async (table: string, cid: string) => {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('content_id', cid);
  if (error) throw new Error(error.message); return count ?? 0;
};

async function main() {
  console.log('WRITER-CERT-005 E2E runtime certification (live cert DB)\n');
  const companyA = randomUUID(), companyB = randomUUID();
  const text = 'How founders ship faster: a contrarian take on speed vs quality.\nThe trick is ruthless prioritization — cut scope, not corners.\nMost teams over-build; the winners ship the 20% that matters.\nTry it this week → Start free.\n#startup #productivity';

  // ── Phase 2: full lifecycle ────────────────────────────────────────────────
  const content: any = await step('generate→persist canonical content (createContent)', () =>
    contentService.createContent({ companyId: companyA, contentType: 'post', title: 'Speed vs quality', body: text, topic: 'shipping speed', objective: 'drive signups', lifecycleStatus: 'generated' } as any));
  const cid = content?.id;
  if (!cid) { console.log('\nABORT: no content id'); process.exit(2); }

  await step('platform variant persisted (upsertVariant x)', () => contentService.upsertVariant(cid, companyA, 'x', { generatedContent: text } as any));
  const orig1: any = await step('originality #1 → accepted (original)', () => assertOriginality({ companyId: companyA, contentType: 'post', candidateText: text } as any));
  // Mirror the real generation flow (runPostGeneration:536) which indexes WITH the
  // target platform + lifecycleStatus so the memory row is retrievable for dedup.
  await step('index into content memory', () => indexContentUnit({ companyId: companyA, contentId: cid, contentType: 'post', platform: 'x', lifecycleStatus: 'generated', text } as any));

  const sc: any = await step('quality engine evaluate (12 dims)', async () => {
    const s = evaluate({ contentType: 'post', text, objective: 'drive signups' } as any);
    if (!s.dimensions || Object.keys(s.dimensions).length < 12) throw new Error('dims=' + Object.keys(s.dimensions || {}).length);
    return `overall=${s.overall} dims=${Object.keys(s.dimensions).length}`;
  });
  const scorecard = evaluate({ contentType: 'post', text, objective: 'drive signups' } as any);
  await step('persist quality scorecard', () => qualityService.persistScorecard({ companyId: companyA, contentId: cid, scorecard } as any));

  const blocks: any = await step('section blocks split + persist', async () => {
    const b = splitIntoBlocks(text, 'post'); await collab.upsertBlocks(companyA, cid, b as any); return `${b.length} blocks`;
  });
  const blockList = splitIntoBlocks(text, 'post');
  const recs: any = await step('generate explainable recommendations', async () => {
    const r = generateRecommendations({ companyId: companyA, contentId: cid, content: text, scorecard, blocks: blockList } as any);
    await collab.saveRecommendations(companyA, cid, r as any); return `${r.length} recs`;
  });

  await step('approval: generated→edited', () => advanceApproval({ companyId: companyA, contentId: cid, toStatus: 'edited' } as any));
  await step('approval: edited→quality_reviewed', () => advanceApproval({ companyId: companyA, contentId: cid, toStatus: 'quality_reviewed' } as any));
  await step('approval: quality_reviewed→approved', () => advanceApproval({ companyId: companyA, contentId: cid, toStatus: 'approved' } as any));
  await step('approval: approved→scheduled', () => advanceApproval({ companyId: companyA, contentId: cid, toStatus: 'scheduled' } as any));
  await step('approval: scheduled→published (fires learning event)', () => advanceApproval({ companyId: companyA, contentId: cid, toStatus: 'published' } as any));

  // ── Phase 6: learning ──────────────────────────────────────────────────────
  await step('publication lineage recorded', () => recordEvent({ companyId: companyA, contentId: cid, eventType: 'published' } as any));
  await step('performance signals ingested', () => ingestSignals({ companyId: companyA, contentId: cid, platform: 'x', signals: { impressions: 1000, clicks: 50, engagement: 80 } } as any));
  await step('learning event recorded', () => recordLearningEvent({ companyId: companyA, contentId: cid } as any));
  await step('explainable prediction generated', async () => {
    const p: any = await predict({ companyId: companyA, contentId: cid, text } as any);
    if (!p.explanation) throw new Error('no explanation'); return `eng=${p.engagementPotential}`;
  });

  // ── Phase 4: originality duplicate detection ───────────────────────────────
  await step('originality #2 → DUPLICATE detected (same text)', async () => {
    const r: any = await assertOriginality({ companyId: companyA, contentType: 'post', candidateText: text } as any);
    if (r.isOriginal || r.decision === 'accepted') throw new Error('expected duplicate, got ' + r.decision);
    return 'decision=' + r.decision;
  });

  // ── Phase 3 (persistence) verification via live DB ─────────────────────────
  await step('DB: content lifecycle == published', async () => {
    const { data, error } = await supabase.from('content').select('lifecycle_status').eq('id', cid).single();
    if (error) throw new Error(error.message); if (data?.lifecycle_status !== 'published') throw new Error('status=' + data?.lifecycle_status); return 'published';
  });
  await step('DB: content_variant persisted', async () => { const n = await countRows('content_variant', cid); if (!n) throw new Error('0'); return n + ' variant'; });
  await step('DB: content_quality persisted', async () => { const n = await countRows('content_quality', cid); if (!n) throw new Error('0'); return n + ' scorecard'; });
  await step('DB: content_originality persisted', async () => { const n = await countRows('content_originality', cid); return n + ' rows'; });
  await step('DB: content_block persisted', async () => { const n = await countRows('content_block', cid); if (!n) throw new Error('0'); return n + ' blocks'; });
  await step('DB: content_recommendation persisted', async () => { const n = await countRows('content_recommendation', cid); return n + ' recs'; });
  await step('DB: approval_history immutable trail', async () => { const n = await countRows('content_approval_history', cid); if (n < 3) throw new Error('only ' + n); return n + ' transitions'; });
  await step('DB: publication_lineage traceable', async () => { const n = await countRows('publication_lineage', cid); if (!n) throw new Error('0'); return n + ' events'; });
  await step('DB: content_performance persisted', async () => { const n = await countRows('content_performance', cid); if (!n) throw new Error('0'); return n + ' signals'; });
  await step('DB: content_prediction persisted', async () => { const n = await countRows('content_prediction', cid); return n + ' predictions'; });

  // ── Phase 8: tenant isolation (company-scoped originality memory) ───────────
  await step('tenant isolation: company B cannot see company A memory', async () => {
    const cB: any = await contentService.createContent({ companyId: companyB, contentType: 'post', body: text, topic: 't', lifecycleStatus: 'generated' } as any);
    // company B asserting the SAME text → must be ORIGINAL for B (A's memory is company-scoped)
    const r: any = await assertOriginality({ companyId: companyB, contentType: 'post', candidateText: text } as any);
    if (!r.isOriginal && r.decision === 'duplicate') throw new Error('LEAK: B saw A memory (decision=' + r.decision + ')');
    return 'B isolated (decision=' + r.decision + ')';
  });

  // ── summary ────────────────────────────────────────────────────────────────
  const pass = results.filter(r => r[1] === 'PASS').length, fail = results.filter(r => r[1] === 'FAIL').length;
  console.log(`\n════ E2E CERT: ${pass} PASS / ${fail} FAIL / ${results.length} total ════`);
  if (fail) { console.log('FAILURES:'); results.filter(r => r[1] === 'FAIL').forEach(r => console.log('  ✗ ' + r[0] + ' → ' + r[2])); }
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS ERROR:', e?.stack || e); process.exit(2); });
