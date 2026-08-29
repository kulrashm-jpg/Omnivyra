/**
 * F1 — Content Memory as an independent runtime stage.
 *
 * The decisive assertions are NEGATIVE and STRUCTURAL: the memory write must
 * not sit inside the canonical-persistence success condition, and must not be
 * reachable only via `persist:true`.
 *
 * Before F1, `content_memory` had one writer — inside `if (persist)`, after
 * `createContent` succeeded. Every live caller passes `persist:false` and
 * canonical persistence is denied in production, so the corpus was
 * structurally unfillable and `assertOriginality` returned `{isOriginal:true}`
 * for every candidate: a gate that could not fail.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');

const RUNTIME = 'backend/services/content/runtime/generationRuntime.ts';
const SERVICE = 'backend/services/content/contentMemoryService.ts';

/* ── Flag semantics ──────────────────────────────────────────────────────── */

describe('F1 · CONTENT_MEMORY_WRITE_ENABLED', () => {
  const PRIOR = process.env.CONTENT_MEMORY_WRITE_ENABLED;
  afterAll(() => {
    if (PRIOR === undefined) delete process.env.CONTENT_MEMORY_WRITE_ENABLED;
    else process.env.CONTENT_MEMORY_WRITE_ENABLED = PRIOR;
  });

  const load = () => {
    let mod!: typeof import('../../services/content/contentMemoryService');
    jest.isolateModules(() => {
      jest.doMock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
      mod = require('../../services/content/contentMemoryService');
    });
    return mod;
  };

  it('absent ⇒ DENY', () => {
    delete process.env.CONTENT_MEMORY_WRITE_ENABLED;
    expect(load().isContentMemoryWriteEnabled()).toBe(false);
  });

  it.each(['false', '0', 'off', 'no', '', '  ', 'TRUE!', 'yes please'])(
    'non-affirmative %p ⇒ DENY', (v) => {
      process.env.CONTENT_MEMORY_WRITE_ENABLED = v;
      expect(load().isContentMemoryWriteEnabled()).toBe(false);
    },
  );

  it.each(['1', 'true', 'TRUE', 'on', 'yes', ' true '])(
    'affirmative %p ⇒ ALLOW', (v) => {
      process.env.CONTENT_MEMORY_WRITE_ENABLED = v;
      expect(load().isContentMemoryWriteEnabled()).toBe(true);
    },
  );

  it('is not coupled to canonical persistence, knowledge graph or cache flags', () => {
    // Comments may name them to explain the DEcoupling; code must not read them.
    const code = read(SERVICE).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/CANONICAL_PERSISTENCE_ENABLED/);
    expect(code).not.toMatch(/PLATFORM_KNOWLEDGE_GRAPH_ENABLED/);
    expect(code).not.toMatch(/CACHE_KILL/);
  });
});

/* ── The decoupling itself ───────────────────────────────────────────────── */

describe('F1 · memory is outside the canonical-persistence success condition', () => {
  const src = read(RUNTIME);
  const stage6b = src.indexOf('// ── Stage 6b');
  const persistStart = src.indexOf('  if (persist) {');
  const persistBlock = src.slice(persistStart, stage6b);
  const memoryBlock = src.slice(stage6b, stage6b + 1600);

  it('the memory stage exists', () => {
    expect(stage6b).toBeGreaterThan(-1);
  });

  it('NO memory write remains inside the if(persist) / createContent block', () => {
    // This is the regression that caused the empty corpus.
    expect(persistBlock).not.toMatch(/await indexContentUnit\(/);
  });

  it('exactly one memory write, in the independent stage', () => {
    expect((memoryBlock.match(/await indexContentUnit\(/g) ?? []).length).toBe(1);
    expect((src.match(/await indexContentUnit\(/g) ?? []).length).toBe(1);
  });

  it('the memory stage runs after, and independently of, persistence', () => {
    expect(persistStart).toBeLessThan(stage6b);
    expect(memoryBlock).not.toMatch(/if \(persist\)/);
    expect(memoryBlock).not.toMatch(/createContent/);
  });

  it('the memory stage is gated ONLY by its own flag', () => {
    expect(memoryBlock).toMatch(/if \(isContentMemoryWriteEnabled\(\)\)/);
  });

  it('passes a nullable contentId rather than requiring a canonical row', () => {
    expect(memoryBlock).toMatch(/contentId,\s+\/\/ may be null/);
  });

  it('is fail-open: a memory failure is recorded, never thrown', () => {
    expect(memoryBlock).toMatch(/catch \{/);
    expect(memoryBlock).toMatch(/failures\.push\('content_memory'\)/);
    // Comments explain the containment and legitimately use the word; assert
    // against CODE lines only.
    const code = memoryBlock.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\bthrow\b/);
  });

  it('introduces no retry, queue or provider call', () => {
    expect(memoryBlock).not.toMatch(/retry|enqueue|queue|runCompletion|setTimeout/i);
  });

  it('does not touch the knowledge graph or write coverage (deferred to I1/V1)', () => {
    expect(memoryBlock).not.toMatch(/recordTopicCoverage|resolveTopicIdentity|platform_topic_node/);
  });

  it('does not evaluate novelty (deferred to V1)', () => {
    expect(memoryBlock).not.toMatch(/assertOriginality|regenerateUntilOriginal/);
  });
});

/* ── Corpus contract ─────────────────────────────────────────────────────── */

describe('F1 · the memory row satisfies the live schema', () => {
  const svc = read(SERVICE);

  it('supplies every NOT NULL column that has no database default', () => {
    // Verified against production information_schema: company_id, exact_hash,
    // normalized_hash and simhash are NOT NULL with no default. id/created_at/
    // updated_at default in the database.
    const insert = svc.slice(svc.indexOf('const insertRow = {'), svc.indexOf('const { data, error }'));
    for (const col of ['company_id', 'exact_hash', 'normalized_hash', 'simhash']) {
      expect(insert).toContain(`${col}:`);
    }
  });

  it('reuses the existing fingerprint algorithm — no second implementation', () => {
    expect(svc).toMatch(/import \{ computeFingerprint \}/);
    expect(svc).not.toMatch(/function computeFingerprint/);
  });

  it('scopes every row to a company (tenant isolation is structural)', () => {
    const insert = svc.slice(svc.indexOf('const insertRow = {'), svc.indexOf('const { data, error }'));
    expect(insert).toMatch(/company_id: input\.companyId/);
  });

  it('reads are company-filtered', () => {
    const retrieve = svc.slice(svc.indexOf('export async function retrieveRelevant'));
    expect(retrieve.slice(0, 900)).toMatch(/eq\('company_id'/);
  });

  it('the writer remains fail-safe (returns null, never throws)', () => {
    const idx = svc.slice(svc.indexOf('export async function indexContentUnit'));
    expect(idx.slice(0, 2200)).toMatch(/logMemoryError\('indexContentUnit\(insert\)', error\)/);
    expect(idx.slice(0, 2200)).toMatch(/return null;/);
  });
});

/* ── Independence: memory is decoupled from persistence ──────────────────── */

// WHY THIS IS NOT A PATH COUNT ANY MORE.
//
// This block used to assert "at least N generation paths pass persist:false".
// That was never the invariant — it was circumstantial evidence for it, and it
// was wrong twice over:
//
//   1. One of the two paths it counted (boltContentGenerationForSchedule) had
//      no caller anywhere in the application, so the bar was partly cleared by
//      unreachable code.
//   2. The premise "every live caller passes persist:false" is simply false
//      today: runPostGeneration and runThreadGeneration deliberately let the
//      runtime persist for them (they return out.contentId). persist:true is a
//      legitimate, supported mode — not a violation.
//
// The invariant F1 actually protects is INDEPENDENCE, and it holds no matter
// how many callers exist or which mode they pick: the content_memory write is
// gated ONLY by its own flag. It must never depend on `persist`, on canonical
// persistence being allowed, on Stage 6 succeeding, or on a non-null contentId.
// A count can go to zero or ten without that changing.
describe('F1 · the memory write is independent of persistence', () => {
  const src = read(RUNTIME);
  const stage6b = src.indexOf('// ── Stage 6b');
  // NOTE: a "Stage 7" section banner also appears near the top of the file, so
  // the closing bound must be searched FORWARD from Stage 6b, not from 0.
  const stage7 = src.indexOf('// ── Stage 7', stage6b);
  const memoryStage = src.slice(stage6b, stage7);

  it('Stage 6b exists and sits after the persistence stage, not inside it', () => {
    expect(stage6b).toBeGreaterThan(-1);
    expect(stage7).toBeGreaterThan(stage6b);
    // The decisive assertion, unchanged: the memory stage is not nested in the
    // canonical-persistence success condition.
    expect(memoryStage).not.toMatch(/if \(persist\)/);
  });

  it('the ONLY gate on the memory write is its own flag', () => {
    // Exactly one guard, and it is the content-memory flag.
    expect(memoryStage).toMatch(/if \(isContentMemoryWriteEnabled\(\)\) \{/);
    // No persistence-derived precondition may creep back in.
    expect(memoryStage).not.toMatch(/if \(contentId\)/);
    expect(memoryStage).not.toMatch(/contentId\s*&&/);
    expect(memoryStage).not.toMatch(/if \(created\)/);
  });

  it('the runtime indexes content in exactly one place — inside Stage 6b', () => {
    const callSites = [...src.matchAll(/await indexContentUnit\(/g)].map((m) => m.index!);
    expect(callSites).toHaveLength(1);
    // That single call site lives in the memory stage, not the persistence one.
    expect(callSites[0]).toBeGreaterThan(stage6b);
    expect(callSites[0]).toBeLessThan(stage7);
  });

  it('a null contentId is passed through rather than suppressing the write', () => {
    // content_memory.content_id is a nullable soft ref precisely so a
    // persist:false generation still fills the corpus.
    expect(memoryStage).toMatch(/contentId,/);
  });

  it('persistence itself remains gated on persist — the two stages stay distinct', () => {
    // Guards against the inverse regression: collapsing Stage 6 into Stage 6b
    // would make persist:false start writing canonical rows.
    const stage6 = src.indexOf('// ── Stage 6 — Persistence');
    expect(stage6).toBeGreaterThan(-1);
    expect(stage6).toBeLessThan(stage6b);
    expect(src.slice(stage6, stage6b)).toMatch(/if \(persist\) \{/);
  });
});

/* ── Originality left untouched ──────────────────────────────────────────── */

describe('F1 · existing originality behaviour is unchanged', () => {
  const src = read(RUNTIME);

  it('persistOriginality still runs only inside the persistence stage', () => {
    const stage6b = src.indexOf('// ── Stage 6b');
    expect(src.slice(0, stage6b)).toMatch(/await persistOriginality\(/);
    expect(src.slice(stage6b, stage6b + 1600)).not.toMatch(/persistOriginality/);
  });

  it('the originality gate and its threshold are untouched', () => {
    const gate = read('backend/services/content/originalityGate.ts');
    expect(gate).toMatch(/DEFAULT_ORIGINALITY_THRESHOLD = 0\.82/);
    // Empty-corpus behaviour is UNCHANGED by F1 and remains V1's problem.
    expect(gate).toMatch(/candidates\.length === 0/);
  });
});
