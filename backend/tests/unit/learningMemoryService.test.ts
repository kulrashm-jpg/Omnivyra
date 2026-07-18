/**
 * WRITER-EXEC-006 Wave 5 — Learning Memory Service + learning-aware Recommendation
 * contract tests (items 4/5/8).
 *
 * Pure + deterministic. Proves:
 *   - getLearningMemory returns a MERGED { brand, learning } view;
 *   - every read/write path is FAIL-SAFE (→ empty/null, never throws);
 *   - getTopIntelligence returns mapped, company-scoped patterns;
 *   - recommendationRuntime with `learningMemory`/`intelligence` present ADDS
 *     explainable learning references, and WITHOUT them is byte-identical to the
 *     Wave-4 output (backward compatibility).
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

// Isolate the service from the observability stack (fail-safe wrappers are proven
// elsewhere); assert the service still functions with them fully mocked.
jest.mock('../../observability/learningMetrics', () => ({
  recordLearningRetrievalLatency: jest.fn(),
  recordLearningUpdate: jest.fn(),
  recordLearningModelFreshness: jest.fn(),
  recordLearningPlatformIntelligenceCoverage: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import {
  getLearningMemory,
  getTopIntelligence,
  upsertLearningMemory,
} from '../../services/content/learningMemoryService';
import {
  generateRecommendations,
  type GenerateRecommendationsInput,
  type ContentBlock,
} from '../../services/content/recommendationRuntime';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A flexible thenable query builder: chainable, and awaitable to `result`. */
function makeQuery(result: { data: any; error: any }): any {
  const q: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'upsert']) q[m] = jest.fn(() => q);
  q.maybeSingle = jest.fn(() => Promise.resolve(result));
  q.single = jest.fn(() => Promise.resolve(result));
  // Make the builder awaitable (getTopIntelligence awaits the builder directly).
  q.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return q;
}

type TableResults = Record<string, { data: any; error: any }>;

function routeTables(results: TableResults): void {
  (supabase.from as jest.Mock).mockImplementation((table: string) =>
    makeQuery(results[table] ?? { data: null, error: null }),
  );
}

const BRAND_ROW = {
  company_id: 'co-1',
  voice: { hooks: ['Ever wondered'] },
  terminology: { terms: ['workflow'] },
  style: null,
  audience: null,
  campaign_themes: null,
  messaging_history: ['Ship faster'],
  updated_at: '2026-07-18T00:00:00Z',
};

const LEARNING_ROW = {
  company_id: 'co-1',
  successful_messaging: { messages: ['proof-led'] },
  unsuccessful_messaging: null,
  narrative_styles: { styles: ['story_arc'] },
  winning_structures: { structures: ['hook_proof_cta'] },
  platform_adaptations: { linkedin: {}, x: {} },
  audience_interests: { items: ['automation'] },
  model_version: 3,
  updated_at: '2026-07-18T00:00:00Z',
};

describe('learningMemoryService.getLearningMemory — merged view', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a merged { brand, learning } view when both rows exist', async () => {
    routeTables({
      brand_memory: { data: BRAND_ROW, error: null },
      learning_memory: { data: LEARNING_ROW, error: null },
    });

    const merged = await getLearningMemory('co-1');

    expect(merged.brand).not.toBeNull();
    expect(merged.brand?.companyId).toBe('co-1');
    expect(merged.brand?.voice).toEqual({ hooks: ['Ever wondered'] });

    expect(merged.learning).not.toBeNull();
    expect(merged.learning?.companyId).toBe('co-1');
    expect(merged.learning?.winningStructures).toEqual({ structures: ['hook_proof_cta'] });
    expect(merged.learning?.platformAdaptations).toEqual({ linkedin: {}, x: {} });
    expect(merged.learning?.modelVersion).toBe(3);
  });

  it('is company-scoped: short-circuits with no DB call on empty companyId', async () => {
    const merged = await getLearningMemory('');
    expect(merged).toEqual({ brand: null, learning: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('degrades each half independently: learning error ⇒ learning null, brand intact', async () => {
    routeTables({
      brand_memory: { data: BRAND_ROW, error: null },
      learning_memory: { data: null, error: { message: 'boom' } },
    });
    const merged = await getLearningMemory('co-1');
    expect(merged.brand).not.toBeNull();
    expect(merged.learning).toBeNull();
  });

  it('is FAIL-SAFE: never throws even when the client throws', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => {
      throw new Error('client exploded');
    });
    const merged = await getLearningMemory('co-1');
    expect(merged).toEqual({ brand: null, learning: null });
  });
});

describe('learningMemoryService.getTopIntelligence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns mapped, company-scoped patterns', async () => {
    const rows = [
      { id: 'i1', company_id: 'co-1', dimension: 'hook', pattern_key: 'question_led', platform: 'linkedin', pattern: { x: 1 }, score: 0.82, sample_size: 12, updated_at: 't' },
      { id: 'i2', company_id: 'co-1', dimension: 'hook', pattern_key: 'stat_led', platform: 'linkedin', pattern: null, score: 0.6, sample_size: 5, updated_at: 't' },
    ];
    routeTables({ learning_intelligence: { data: rows, error: null } });

    const top = await getTopIntelligence('co-1', 'hook');
    expect(top).toHaveLength(2);
    expect(top[0].patternKey).toBe('question_led');
    expect(top[0].score).toBe(0.82);
    expect(top[0].sampleSize).toBe(12);
    expect(supabase.from).toHaveBeenCalledWith('learning_intelligence');
  });

  it('is FAIL-SAFE: returns [] on query error and on empty companyId', async () => {
    routeTables({ learning_intelligence: { data: null, error: { message: 'nope' } } });
    expect(await getTopIntelligence('co-1', 'hook')).toEqual([]);
    expect(await getTopIntelligence('')).toEqual([]);
  });
});

describe('learningMemoryService.upsertLearningMemory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps a camelCase patch and returns the mapped rollup', async () => {
    routeTables({ learning_memory: { data: LEARNING_ROW, error: null } });
    const result = await upsertLearningMemory('co-1', {
      winningStructures: { structures: ['hook_proof_cta'] },
    });
    expect(result).not.toBeNull();
    expect(result?.companyId).toBe('co-1');
    expect(result?.modelVersion).toBe(3);
  });

  it('is company-scoped + FAIL-SAFE: null on empty companyId (no DB call)', async () => {
    const result = await upsertLearningMemory('', { winningStructures: null });
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

/* ── recommendationRuntime: learning is ADDITIVE + backward compatible ──────── */

function makeRecBlocks(): ContentBlock[] {
  return [
    { id: 'b-hook', type: 'hook', position: 0, text: 'Our platform helps teams.', locked: false },
    { id: 'b-body', type: 'body', position: 1, text: 'Teams waste hours. They juggle tools. Our workflow fixes that.', locked: false },
    { id: 'b-tags', type: 'hashtags', position: 2, text: '#marketing', locked: false },
  ];
}

const recBase: GenerateRecommendationsInput = {
  companyId: 'co-1',
  contentId: 'c-1',
  content: 'ignored — blocks provided',
  scorecard: { overallScore: 22, dimensions: { hook: 18, seo: 20 } },
  blocks: makeRecBlocks(),
};

const intelligence = [
  { dimension: 'hook', patternKey: 'question_led', platform: 'linkedin', score: 0.82, sampleSize: 12 },
  { dimension: 'hook', patternKey: 'stat_led', platform: 'linkedin', score: 0.6, sampleSize: 5 },
  { dimension: 'hashtag', patternKey: 'three_niche_tags', platform: 'linkedin', score: 0.7, sampleSize: 8 },
];

const learningMemory = {
  winningStructures: { structures: ['hook_proof_cta'] },
  platformAdaptations: { linkedin: {}, x: {} },
  successfulMessaging: null,
};

describe('generateRecommendations — Wave-5 learning references', () => {
  it('adds NOTHING when learning is absent (byte-identical to Wave 4)', () => {
    const recs = generateRecommendations(recBase);
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (const rec of recs) {
      expect(rec.learningReferences).toBeUndefined();
    }
  });

  it('attaches explainable, evidence-bearing references when learning is present', () => {
    const recs = generateRecommendations({ ...recBase, intelligence, learningMemory });
    const hookRec = recs.find((r) => r.dimension === 'hook')!;
    expect(hookRec.learningReferences).toBeDefined();
    const ref = hookRec.learningReferences![0];
    expect(ref.kind).toBe('historical_pattern');
    expect(ref.platform).toBe('linkedin');
    expect(ref.score).toBe(0.82);
    expect(ref.sampleSize).toBe(12);
    // deterministic top pattern chosen (0.82 > 0.6), explainable + cites LinkedIn
    expect(ref.note).toContain('LinkedIn');
    expect(ref.note.toLowerCase()).toContain('question led');
    expect(ref.evidence).toContain('question_led');
  });

  it('leaves every OTHER rec field byte-identical to the no-learning output', () => {
    const baseline = generateRecommendations(recBase);
    const withLearning = generateRecommendations({ ...recBase, intelligence, learningMemory });
    // Strip only the additive field; everything else must match exactly.
    const stripped = withLearning.map(({ learningReferences, ...rest }) => rest);
    expect(stripped).toEqual(baseline);
  });

  it('is deterministic with learning present (idempotent across calls)', () => {
    const a = generateRecommendations({ ...recBase, intelligence, learningMemory });
    const b = generateRecommendations({ ...recBase, intelligence, learningMemory });
    expect(a).toEqual(b);
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any */
