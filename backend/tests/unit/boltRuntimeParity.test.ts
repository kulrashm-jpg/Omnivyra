/**
 * WS-1c-2b (PMO-ADR-08) — BOLT CONVERGENCE master-parity A/B test.
 *
 * Proves that routing BOLT's per-item MASTER generation through the canonical
 * GenerationRuntime (BOLT_RUNTIME_DELEGATION_ENABLED=on, persist:false +
 * runOriginality:false) is FAITHFUL to BOLT's legacy inline call
 * (`generateMasterContentFromIntent(item)`, flag off) for representative BOLT
 * inputs — WITHOUT changing anything BOLT owns around the master (batch loop,
 * per-target variants, persistence, moderation, workspace-adoption).
 *
 * WHAT IS COMPARED — the generation ITEM fed to the SHARED primitive
 * `generateMasterContentFromIntent`. Because the primitive derives its master
 * TEXT from this item, item-equivalence on the prompt-determining fields (topic /
 * objective / pain_point / outcome_promise / target_audience / cta_type /
 * writer_content_brief / extra_instruction / governance / company_id) is the
 * strongest deterministic parity proof.
 *
 * INTENTIONAL, DOCUMENTED, NON-PROMPT-AFFECTING DIFFERENCES (excluded from the
 * projection):
 *   - `execution_id` — a Date.now() timestamp id (non-semantic; only becomes the
 *     master.id). Same exclusion as the #7 parity test.
 *   - `intent.tone` — the runtime's buildGenerationItem always emits a tone
 *     default; BOLT's legacy intent has none. For BOLT's text-flow master
 *     (`content_type:'post'`) the primitive sources tone from
 *     `writer_content_brief.narrativeStyle` — NOT `intent.tone` — so this field
 *     never changes the master prompt bytes.
 *   - `active_platform_targets` — not read by the master primitive; BOLT keeps its
 *     OWN per-target variant generation with the real per-row content types.
 *
 * The heavy seams (generation primitives + the runtime's context/memory/persist
 * reads) are MOCKED so the test is hermetic; the REAL BOLT orchestrator + REAL
 * runtime + REAL prompt-assembler item construction run over them.
 */

// ── generation primitives — SHARED by BOLT + runtime (same module) ────────────
const capturedMasterItems: Array<Record<string, unknown>> = [];
jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async (item: Record<string, unknown>) => {
    capturedMasterItems.push(item);
    return {
      id: 'master-parity',
      generated_at: '2026-07-20T00:00:00.000Z',
      content: 'Deterministic BOLT master body for parity.',
      generation_status: 'generated',
      generation_source: 'ai',
    };
  }),
  buildPlatformVariantsFromMaster: jest.fn(async (item: Record<string, unknown>) => {
    const targets = (item.active_platform_targets as Array<{ platform: string; content_type: string }>) ?? [];
    const primary = targets[0] ?? { platform: 'linkedin', content_type: 'post' };
    return [
      {
        platform: String(primary.platform),
        content_type: String(primary.content_type),
        generated_content: 'Deterministic BOLT variant body for parity.',
        generation_status: 'generated',
        locked_variant: false,
      },
    ];
  }),
}));

// ── runtime DB-touching seams — mocked so delegation is hermetic ──────────────
jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveContentContext: jest.fn(async (_companyId: string, opts?: { objective?: string | null }) => ({
    companyId: 'co-bolt',
    profile: null,
    identity: {},
    brand: '',
    identityNames: [],
    // The resolver never sources audience/tone from a per-request field — it would
    // read them from a profile. We return '' so the assembler falls back to the
    // request-provided (BOLT-derived) values, exactly like the legacy path.
    audience: '',
    tone: '',
    objective: typeof opts?.objective === 'string' && opts.objective.trim() ? opts.objective.trim() : null,
    businessContext: '',
    creatorCompany: {},
    contextBlock: '',
    adaptation: null,
  })),
}));

jest.mock('../../services/content/contentMemoryService', () => ({
  getBrandMemory: jest.fn(async () => null),
  retrieveRelevant: jest.fn(async () => []),
  indexContentUnit: jest.fn(async () => null),
  persistOriginality: jest.fn(async () => null),
}));

jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(async () => ({ id: 'should-not-be-called', lifecycleStatus: 'draft' })),
}));

// ── BOLT's own seams ──────────────────────────────────────────────────────────
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/executionPlannerPersistence', () => ({
  updateActivity: jest.fn(async () => undefined),
}));

import { supabase } from '../../db/supabaseClient';
import { createContent } from '../../services/content/contentService';
import { generateContentForDailyPlans } from '../../services/boltContentGenerationForSchedule';

const mockedSupabase = supabase as unknown as { from: jest.Mock };

const FLAG = 'BOLT_RUNTIME_DELEGATION_ENABLED';

type EnrichedRow = Record<string, unknown>;

/** Build one BOLT daily plan row whose `content` JSON is the enriched planning object. */
function planRow(id: string, enriched: EnrichedRow, over: Record<string, unknown> = {}) {
  const topic = String(enriched.topicTitle ?? enriched.topic ?? enriched.title ?? `Topic ${id}`);
  return {
    id,
    campaign_id: 'campaign-1',
    week_number: 1,
    day_of_week: 'Monday',
    date: '2099-01-05',
    platform: 'linkedin',
    content_type: 'post',
    title: topic,
    topic,
    scheduled_time: '09:00',
    content: JSON.stringify(enriched),
    ...over,
  };
}

/** Project the prompt-determining fields of the captured master generation item. */
function projectMasterItem(item: Record<string, unknown>) {
  const intent = (item.intent ?? {}) as Record<string, unknown>;
  const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v ?? null);
  return {
    company_id: item.company_id ?? null,
    topic: item.topic ?? null,
    title: item.title ?? null,
    content_type: item.content_type ?? null,
    objective: intent.objective ?? null,
    pain_point: intent.pain_point ?? null,
    outcome_promise: intent.outcome_promise ?? null,
    target_audience: intent.target_audience ?? null,
    cta_type: intent.cta_type ?? null,
    writer_content_brief: item.writer_content_brief ?? null,
    extra_instruction: trim(item.extra_instruction),
    governance: item.governance ?? null,
  };
}

async function runOnce(mode: 'legacy' | 'delegated', enriched: EnrichedRow) {
  if (mode === 'legacy') delete process.env[FLAG];
  else process.env[FLAG] = '1';
  capturedMasterItems.length = 0;
  (createContent as jest.Mock).mockClear();
  await generateContentForDailyPlans('campaign-1', [planRow('plan-1', enriched)] as never);
  // The master primitive is called EXACTLY ONCE per group in both modes (legacy:
  // BOLT calls it directly; delegated: the runtime calls it once, BOLT discards
  // out.variants and keeps its own variant path).
  return capturedMasterItems.length ? projectMasterItem(capturedMasterItems[0]!) : null;
}

beforeEach(() => {
  mockedSupabase.from.mockReset();
  mockedSupabase.from.mockImplementation((table: string) => {
    if (table === 'campaigns') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { company_id: 'co-bolt', user_id: 'user-1' } }),
      };
    }
    if (table === 'blogs') {
      return { insert: jest.fn().mockResolvedValue({ error: null }) };
    }
    // company_profiles etc. — BOLT's governance read is best-effort (try/catch),
    // so throwing here deterministically leaves governance=null in BOTH modes.
    throw new Error(`Unexpected table: ${table}`);
  });
});

afterEach(() => {
  delete process.env[FLAG];
});

// Representative BOLT enriched inputs — flat intent fields, a nested writer brief,
// and (case 3) a master_idea that yields a non-empty strategic extra_instruction.
const CORPUS: Array<[string, EnrichedRow]> = [
  [
    'flat intent fields',
    {
      topicTitle: 'Why onboarding friction kills activation',
      dailyObjective: 'Educate operators on reducing time-to-value',
      whatProblemAreWeAddressing: 'New users churn before the aha moment',
      whatShouldReaderLearn: 'A concrete framework to compress onboarding',
      desiredAction: 'Book a walkthrough',
      whoAreWeWritingFor: 'B2B SaaS operators',
      narrativeStyle: 'Direct, practical, evidence-led',
    },
  ],
  [
    'minimal row (defaults exercised)',
    {
      topic: 'Positioning against incumbents',
    },
  ],
  [
    'nested intent + master_idea (strategic extra_instruction)',
    {
      topic: 'The hidden cost of over-building',
      intent: {
        objective: 'Drive demo signups',
        pain_point: 'Teams ship features nobody asked for',
        outcome_promise: 'A prioritization rule that ships less, faster',
        cta_type: 'Start free',
        target_audience: 'Product leaders',
      },
      writer_content_brief: {
        topicTitle: 'The hidden cost of over-building',
        narrativeStyle: 'Contrarian and concrete',
        whatShouldReaderLearn: 'Ship less, faster',
      },
      master_idea: {
        id: 'mi-42',
        theme: 'focus',
        intent: 'educate',
        cta_strategy: 'soft',
        audience: 'Product leaders',
        buyer_journey_stage: 'consideration',
        narrative: 'Less is more',
        core_message: 'Over-building is a tax',
      },
    },
  ],
];

describe('WS-1c-2b BOLT convergence — legacy vs runtime master parity', () => {
  it.each(CORPUS)('master item parity — %s', async (_name, enriched) => {
    const legacy = await runOnce('legacy', enriched);
    const delegated = await runOnce('delegated', enriched);

    expect(legacy).not.toBeNull();
    expect(delegated).not.toBeNull();
    // The prompt-determining generation item is reconstructed IDENTICALLY by the
    // runtime's prompt assembler from BOLT's own item fields.
    expect(delegated).toEqual(legacy);
  });

  it('delegated path NEVER persists to the canonical content store (no double-persist)', async () => {
    for (const [, enriched] of CORPUS) {
      await runOnce('delegated', enriched);
    }
    // BOLT owns persistence (updateActivity / blogs); the runtime runs persist:false.
    expect(createContent).not.toHaveBeenCalled();
  });

  it('flag OFF ⇒ master flows through the inline primitive (default preserved)', async () => {
    const item = await runOnce('legacy', CORPUS[0]![1]);
    // A master item was produced via the legacy inline call.
    expect(item).not.toBeNull();
    expect(item!.topic).toBe('Why onboarding friction kills activation');
  });
});
