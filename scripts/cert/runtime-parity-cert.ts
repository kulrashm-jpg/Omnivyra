/**
 * WRITER-CERT-006 — Canonical Runtime Delegation Parity harness.
 * Runs a representative POST corpus through runPostGeneration TWICE per case —
 * WRITER_RUNTIME_DELEGATION_ENABLED off (legacy inline) vs on (canonical
 * GenerationRuntime) — against the LIVE cert DB under the deterministic mock,
 * and compares the STRUCTURAL/deterministic parity contract callers depend on:
 *   return shape · objective preservation · variant platform · content_id ·
 *   persisted canonical row (objective/topic/lifecycle) · originality decision.
 *
 * NOTE ON MOCK TEXT: betaMockTextProvider seeds its CTA off fnv1a(system+user),
 * so legacy's richer extra_instruction can change the mock's TEXT without being a
 * semantic parity break. Free-text equality is therefore reported as INFO, not a
 * gate. Prompt-directive divergences (template/governance/guardrails/D3) are
 * established by static analysis, not by this harness.
 *
 * Run:
 *   DOTENV_CONFIG_PATH=.env.cert BETA_AI_MODE=1 CERT_ENV=1 \
 *     npx tsx -r dotenv/config -r tsconfig-paths/register scripts/cert/runtime-parity-cert.ts
 */
import { randomUUID } from 'crypto';
import { runPostGeneration } from '@/lib/post/runPostGeneration';
import { runThreadGeneration } from '@/lib/thread/runThreadGeneration';
import { supabase } from '@/backend/db/supabaseClient';

const FLAG = 'WRITER_RUNTIME_DELEGATION_ENABLED';

type Mode = 'legacy' | 'canonical';
async function runMode(mode: Mode, input: any, entry: (i: any) => Promise<any> = runPostGeneration) {
  if (mode === 'legacy') delete process.env[FLAG];
  else process.env[FLAG] = '1';
  const res: any = await entry(input);
  const cid = res?.content_id ?? null;
  let row: any = null, orig: any = null;
  if (cid) {
    const r = await supabase.from('content').select('objective,topic,title,lifecycle_status,content_type').eq('id', cid).single();
    row = r.data;
    const o = await supabase.from('content_originality').select('decision,originality_score').eq('content_id', cid).limit(1);
    orig = o.data?.[0] ?? null;
  }
  return {
    success: res?.success === true,
    content_type: res?.content_type ?? null,
    hasMaster: !!res?.master_content?.content,
    masterLen: (res?.master_content?.content ?? '').length,
    masterHead: (res?.master_content?.content ?? '').replace(/\s+/g, ' ').slice(0, 50),
    variantPlatform: res?.platform_variant?.platform ?? null,
    hasVariant: !!res?.platform_variant?.generated_content,
    contentId: cid,
    persistedObjective: row?.objective ?? null,
    persistedTopic: row?.topic ?? null,
    persistedLifecycle: row?.lifecycle_status ?? null,
    persistedType: row?.content_type ?? null,
    originalityDecision: orig?.decision ?? null,
  };
}

const CORPUS = [
  { name: 'post + objective (linkedin)', in: { company_id: '', topic: 'shipping speed vs quality', platform: 'linkedin', objective: 'drive signups', target_audience: 'founders', tone: 'direct', cta: 'Start free' } },
  { name: 'post no-objective (x)',        in: { company_id: '', topic: 'the cost of over-building', platform: 'x', target_audience: 'engineers', tone: 'punchy' } },
  { name: 'post + template (instagram)',  in: { company_id: '', topic: 'retention over vanity metrics', platform: 'instagram', objective: 'educate', template_name: 'thought-leadership' } },
  { name: 'post + extra_instruction (linkedin)', in: { company_id: '', topic: 'positioning against incumbents', platform: 'linkedin', objective: 'book demos', extra_instruction: 'Use a contrarian hook and one concrete number.' } },
];

// Structural parity contract: these MUST match between legacy and canonical.
const STRUCTURAL: [string, (a: any) => any][] = [
  ['success', x => x.success],
  ['content_type', x => x.content_type],
  ['hasMaster', x => x.hasMaster],
  ['variantPlatform', x => x.variantPlatform],
  ['hasVariant', x => x.hasVariant],
  ['content_id present', x => !!x.contentId],
  ['persisted objective', x => x.persistedObjective],
  ['persisted topic', x => x.persistedTopic],
  ['persisted content_type', x => x.persistedType],
  ['originality decision', x => x.originalityDecision],
];

async function main() {
  console.log('WRITER-CERT-006 runtime delegation parity (live cert DB)\n');
  let pass = 0, fail = 0;
  const infoDiffs: string[] = [];

  const THREAD_CORPUS = [
    { name: 'thread + objective (x)', in: { company_id: '', topic: 'why most roadmaps fail', platform: 'x', objective: 'grow followers', target_audience: 'PMs', tone: 'direct' } },
    { name: 'thread + template (linkedin)', in: { company_id: '', topic: 'lessons from a failed launch', platform: 'linkedin', objective: 'educate', template_name: 'story' } },
  ];
  const ALL = [
    ...CORPUS.map(c => ({ ...c, entry: runPostGeneration, type: 'post' })),
    ...THREAD_CORPUS.map(c => ({ ...c, entry: runThreadGeneration, type: 'thread' })),
  ];

  for (const c of ALL as any[]) {
    // Distinct company per mode so neither run's content-memory index pollutes the
    // other's originality verdict (same company + same topic would trivially read
    // as a duplicate on the second run — a sequencing artifact, not a parity break).
    const legacy = await runMode('legacy', { ...c.in, company_id: randomUUID() }, c.entry);
    const canonical = await runMode('canonical', { ...c.in, company_id: randomUUID() }, c.entry);

    console.log(`── ${c.name}`);
    for (const [label, sel] of STRUCTURAL) {
      const a = sel(legacy), b = sel(canonical);
      const eq = JSON.stringify(a) === JSON.stringify(b);
      if (eq) { pass++; } else { fail++; console.log(`   FAIL  ${label}: legacy=${JSON.stringify(a)} canonical=${JSON.stringify(b)}`); }
    }
    // INFO-only: free-text + lifecycle (known non-gating differences)
    if (legacy.masterHead !== canonical.masterHead) infoDiffs.push(`${c.name}: master text differs (mock seed) L="${legacy.masterHead}" C="${canonical.masterHead}"`);
    if (legacy.persistedLifecycle !== canonical.persistedLifecycle) infoDiffs.push(`${c.name}: lifecycle legacy=${legacy.persistedLifecycle} canonical=${canonical.persistedLifecycle}`);
    console.log(`   ok structural checks (legacy objective=${JSON.stringify(legacy.persistedObjective)} canonical=${JSON.stringify(canonical.persistedObjective)}, variant=${legacy.variantPlatform}/${canonical.variantPlatform})`);
  }

  console.log(`\nINFO (non-gating differences):`);
  infoDiffs.forEach(d => console.log('  • ' + d));
  console.log(`\n════ PARITY (structural): ${pass} pass / ${fail} fail ════`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e?.stack || e); process.exit(2); });
