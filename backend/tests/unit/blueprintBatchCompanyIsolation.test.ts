/**
 * BLOCKING tenancy fix (e9 2026-11-13): blueprint generation must never mix or reuse tenant content across companies.
 *
 * THE DEFECTS (main 0a21dba68):
 *  1. batchAiProcessor kept ONE module-wide pending queue and flushed `splice(0, N)`, so a single LLM prompt carried
 *     several companies' briefs (topic, objective, audience, pain point, outcome promise, key points).
 *  2. fragmentCache stored hooks / CTAs / key-point structures keyed only by topic/industry/platform/tone, so a
 *     fragment generated from company B's brief was assembled into company A's blueprint.
 *  3. batchedGenerateBlueprint defaulted a missing company to 'default', and the planning processor never passed one,
 *     so the per-company blueprint cache collapsed to one shared key.
 *
 * Real batchAiProcessor + real fragmentCache + real contentBlueprintCache; only the LLM, the prompt text and the
 * template layer are faked. The LLM fake records every prompt it receives.
 */
const prompts: Array<Array<{ topic: string }>> = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (req: any) => {
    const items = JSON.parse(req.messages[1].content) as Array<{ index: number; topic: string }>;
    prompts.push(items.map((i) => ({ topic: i.topic })));
    return { output: JSON.stringify({ results: items.map((i) => ({ hook: `HOOK for ${i.topic}`, key_points: [`kp1 ${i.topic}`, `kp2 ${i.topic}`], cta: `CTA ${i.topic}` })) }) };
  }),
}));
jest.mock('../../prompts', () => ({ getContentBlueprintPromptWithFingerprint: () => ({ content: 'SYSTEM', fingerprint: 'f' }) }));
jest.mock('../../services/aiTemplateLayer', () => ({ tryTemplateBlueprintFor: () => null }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { batchedGenerateBlueprint, flushBatchNow } = require('../../services/batchAiProcessor');
const { storeFragments, assembleFromFragments, getFragmentCacheStats } = require('../../services/fragmentCache');
/* eslint-enable @typescript-eslint/no-var-requires */

const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
let uniq = 0;
const item = (company: string | undefined, topic: string) => ({
  ...(company ? { company_id: company } : {}),
  topic: `${topic} ${++uniq}`, // unique per test so the in-process caches never short-circuit the LLM
  content_type: 'post',
  intent: { target_audience: 'CFOs at mid-size firms', objective: 'awareness', cta_type: 'Soft CTA' },
});

beforeEach(() => { prompts.length = 0; });

describe('batchAiProcessor: one LLM prompt never carries more than one company', () => {
  it('CRITICAL: interleaved A and B items are flushed as separate, single-company prompts', async () => {
    const reqs = [item(CO_A, 'A secret pricing'), item(CO_B, 'B secret roadmap'), item(CO_A, 'A churn'), item(CO_B, 'B hiring')];
    const results = reqs.map((r) => batchedGenerateBlueprint(r));
    await flushBatchNow();
    await flushBatchNow();
    await Promise.all(results);
    expect(prompts.length).toBe(2);
    for (const p of prompts) {
      const owners = new Set(p.map((x) => (x.topic.startsWith('A ') ? 'A' : 'B')));
      expect(owners.size).toBe(1);
    }
    const all = prompts.flat().map((x) => x.topic);
    expect(all.filter((t) => t.startsWith('A '))).toHaveLength(2);
    expect(all.filter((t) => t.startsWith('B '))).toHaveLength(2);
  });

  it('each caller gets the blueprint generated for ITS OWN item', async () => {
    const a = item(CO_A, 'A topic');
    const b = item(CO_B, 'B topic');
    const pa = batchedGenerateBlueprint(a);
    const pb = batchedGenerateBlueprint(b);
    await flushBatchNow();
    await flushBatchNow();
    expect((await pa).hook).toBe(`HOOK for ${a.topic}`);
    expect((await pb).hook).toBe(`HOOK for ${b.topic}`);
  });

  it('fails closed without a company: rejects, and nothing reaches the LLM', async () => {
    await expect(batchedGenerateBlueprint(item(undefined, 'no company'))).rejects.toThrow(/company_id is required/);
    await flushBatchNow();
    expect(prompts).toHaveLength(0);
  });

  it("the blueprint cache is per company: B's generated blueprint is never returned to A for the same brief", async () => {
    const shared = { company_id: CO_B, topic: `Shared topic ${++uniq}`, content_type: 'post', intent: { target_audience: 'Ops leads', objective: 'x', cta_type: 'Soft CTA' } };
    const pb = batchedGenerateBlueprint(shared);
    await flushBatchNow();
    await pb;
    prompts.length = 0;
    const pa = batchedGenerateBlueprint({ ...shared, company_id: CO_A });
    await flushBatchNow();
    await pa;
    expect(prompts).toHaveLength(1); // A had to be generated; B's cached blueprint was not reused
  });
});

describe('fragmentCache: fragments are company-private', () => {
  const store = (companyId: string | undefined, tag: string) =>
    storeFragments(
      { hook: `${tag} HOOK`, key_points: [`${tag} kp1`, `${tag} kp2`], cta: `${tag} CTA` },
      { companyId, topic: `frag topic alpha beta gamma ${tag}`, contentType: 'carousel', ctaType: 'Hard CTA', audience: 'retail store managers' },
    );
  const assemble = (companyId: string | undefined, tag: string) =>
    assembleFromFragments(companyId, `frag topic alpha beta gamma ${tag}`, 'carousel', 'Hard CTA', 'retail store managers');

  it("CRITICAL: a fragment stored for B is never assembled for A; B still gets its own", () => {
    store(CO_B, 'Bfrag');
    expect(assemble(CO_A, 'Bfrag')).toBeNull();
    expect(assemble(CO_B, 'Bfrag')).toEqual({ hook: 'Bfrag HOOK', key_points: ['Bfrag kp1', 'Bfrag kp2'], cta: 'Bfrag CTA' });
  });

  // One test per finder: A owns two of the three fragment kinds; the third exists ONLY for B. Assembly for A must
  // fail (null) - a finder that ignored the company would complete A's blueprint with B's fragment.
  const meta = (companyId: string, topic: string, audience: string, ctaType: string) =>
    ({ companyId, topic, contentType: 'reel', ctaType, audience });
  it("hook finder: B's hook never completes A's blueprint", () => {
    storeFragments({ hook: 'B-ONLY HOOK', key_points: ['x', 'y'], cta: 'c' }, meta(CO_B, 'hook iso alpha beta gamma', 'hook iso aud', 'Hook Iso CTA'));
    storeFragments({ hook: '', key_points: ['A kp1', 'A kp2'], cta: 'A cta' }, meta(CO_A, 'zzz unrelated topic words', 'hook iso aud', 'Hook Iso CTA'));
    expect(assembleFromFragments(CO_A, 'hook iso alpha beta gamma', 'reel', 'Hook Iso CTA', 'hook iso aud')).toBeNull();
  });
  it("CTA finder: B's CTA never completes A's blueprint", () => {
    storeFragments({ hook: 'A hook', key_points: ['A kp1', 'A kp2'], cta: '' }, meta(CO_A, 'cta iso alpha beta gamma', 'cta iso aud', 'Cta Iso Type'));
    storeFragments({ hook: '', key_points: [], cta: 'B-ONLY CTA' }, meta(CO_B, 'other words entirely here', 'zz', 'Cta Iso Type'));
    expect(assembleFromFragments(CO_A, 'cta iso alpha beta gamma', 'reel', 'Cta Iso Type', 'cta iso aud')).toBeNull();
  });
  it("structure finder: B's key points never complete A's blueprint", () => {
    storeFragments({ hook: 'A hook', key_points: [], cta: 'A cta' }, meta(CO_A, 'struct iso alpha beta gamma', 'zz other', 'Struct Iso CTA'));
    storeFragments({ hook: '', key_points: ['B-ONLY kp1', 'B-ONLY kp2'], cta: '' }, meta(CO_B, 'unrelated b topic words', 'struct iso aud', 'Struct Iso CTA'));
    expect(assembleFromFragments(CO_A, 'struct iso alpha beta gamma', 'reel', 'Struct Iso CTA', 'struct iso aud')).toBeNull();
  });

  it('no company: nothing is stored and nothing is assembled', () => {
    const before = getFragmentCacheStats().storeCount;
    store(undefined, 'Nofrag');
    store('   ', 'Nofrag');
    expect(getFragmentCacheStats().storeCount).toBe(before); // an ownerless fragment is refused, not stored
    expect(assemble(CO_A, 'Nofrag')).toBeNull();
    expect(assemble(undefined, 'Nofrag')).toBeNull();
    expect(assemble('', 'Nofrag')).toBeNull();
  });
});
