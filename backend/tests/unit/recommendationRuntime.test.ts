/**
 * WRITER-EXEC-005 Wave 4 — canonical Recommendation Runtime contract tests.
 *
 * Pure, deterministic, DB-free (cert env down). Proves:
 *   - a WEAK scorecard yields explainable, block-scoped recs with all required
 *     fields, targeting the correct block, referencing the score;
 *   - a STRONG scorecard yields no recs;
 *   - a LOCKED block yields no applicable rec (nothing to modify);
 *   - output is deterministic (idempotent across calls);
 *   - the collaboration safety-rule decision (locked / manual-edit precedence /
 *     apply) is enforced by the pure evaluateAcceptance helper.
 */

import {
  generateRecommendations,
  WEAK_THRESHOLD,
  type ContentBlock,
  type QualityScorecard,
  type Recommendation,
} from '../../services/content/recommendationRuntime';
import { evaluateAcceptance } from '../../services/content/collaborationService';

const HOOK_TEXT = 'Our platform helps teams.';
const BODY_TEXT =
  'Content teams waste hours every week. They juggle tools. They miss deadlines. ' +
  'They struggle to stay consistent. Our workflow fixes that end to end.';
const CTA_TEXT = 'You could maybe consider signing up for our newsletter at some point.';
const HASHTAG_TEXT = '#marketing';

function makeBlocks(): ContentBlock[] {
  return [
    { id: 'b-hook', type: 'hook', position: 0, text: HOOK_TEXT, locked: false },
    { id: 'b-body', type: 'body', position: 1, text: BODY_TEXT, locked: false },
    { id: 'b-cta', type: 'cta', position: 2, text: CTA_TEXT, locked: false },
    { id: 'b-tags', type: 'hashtags', position: 3, text: HASHTAG_TEXT, locked: false },
  ];
}

const weakScorecard: QualityScorecard = {
  overallScore: 28,
  dimensions: {
    hook: 20,
    cta: { score: 25 },
    seo: 15,
    readability: 30,
  },
};

const strongScorecard: QualityScorecard = {
  overallScore: 92,
  dimensions: {
    hook: 90,
    cta: { score: 88 },
    seo: 95,
    readability: 91,
    clarity: 89,
    brandVoice: 93,
    originality: 87,
  },
};

function baseInput(overrides: Partial<Parameters<typeof generateRecommendations>[0]> = {}) {
  return {
    companyId: 'co-1',
    contentId: 'content-1',
    content: `${HOOK_TEXT}\n\n${BODY_TEXT}\n\n${CTA_TEXT}\n\n${HASHTAG_TEXT}`,
    scorecard: weakScorecard,
    blocks: makeBlocks(),
    ...overrides,
  };
}

function requireField<T extends keyof Recommendation>(rec: Recommendation, field: T) {
  expect(rec[field]).toBeDefined();
}

describe('generateRecommendations — weak scorecard', () => {
  const recs = generateRecommendations(baseInput());

  it('emits at least one rec per supported weak dimension', () => {
    expect(recs.length).toBeGreaterThanOrEqual(4);
    const dims = recs.map((r) => r.dimension);
    expect(dims).toEqual(expect.arrayContaining(['hook', 'cta', 'seo', 'readability']));
  });

  it('every rec carries all required, explainable fields', () => {
    for (const rec of recs) {
      requireField(rec, 'category');
      requireField(rec, 'reason');
      requireField(rec, 'expectedImpact');
      requireField(rec, 'confidence');
      requireField(rec, 'affectedSection');
      requireField(rec, 'before');
      requireField(rec, 'after');
      expect(typeof rec.reason).toBe('string');
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
      // deterministic improved variant actually differs from the source block
      expect(rec.after).not.toEqual(rec.before);
      expect(rec.after.length).toBeGreaterThan(0);
    }
  });

  it('references the scorecard score in the reason', () => {
    const hookRec = recs.find((r) => r.dimension === 'hook')!;
    expect(hookRec.reason).toContain('20/100');
    expect(hookRec.reason).toContain(String(WEAK_THRESHOLD));
  });

  it('targets the correct block per dimension (never the whole doc)', () => {
    const hookRec = recs.find((r) => r.dimension === 'hook')!;
    const ctaRec = recs.find((r) => r.dimension === 'cta')!;
    const seoRec = recs.find((r) => r.dimension === 'seo')!;
    expect(hookRec.blockId).toBe('b-hook');
    expect(hookRec.before).toBe(HOOK_TEXT);
    expect(ctaRec.blockId).toBe('b-cta');
    expect(ctaRec.before).toBe(CTA_TEXT);
    // seo → hashtags block
    expect(seoRec.blockId).toBe('b-tags');
  });

  it('hook rec prepends a question; cta rec tightens the ask', () => {
    const hookRec = recs.find((r) => r.dimension === 'hook')!;
    const ctaRec = recs.find((r) => r.dimension === 'cta')!;
    expect(hookRec.after).toContain('?');
    expect(hookRec.after).toContain(HOOK_TEXT); // original preserved below the hook
    expect(ctaRec.after.length).toBeLessThan(ctaRec.before.length); // tightened
  });
});

describe('generateRecommendations — strong scorecard', () => {
  it('emits no recommendations when all dimensions are healthy', () => {
    const recs = generateRecommendations(baseInput({ scorecard: strongScorecard }));
    expect(recs).toEqual([]);
  });
});

describe('generateRecommendations — locked block', () => {
  it('yields no applicable rec when the only candidate block is locked', () => {
    const lockedOnly: ContentBlock[] = [
      { id: 'b-hook', type: 'hook', position: 0, text: HOOK_TEXT, locked: true },
    ];
    const recs = generateRecommendations(
      baseInput({ blocks: lockedOnly, scorecard: { overallScore: 20, dimensions: { hook: 15 } } }),
    );
    expect(recs).toEqual([]);
  });

  it('does not target a locked block even when others are available', () => {
    const blocks = makeBlocks().map((b) => (b.type === 'hook' ? { ...b, locked: true } : b));
    const recs = generateRecommendations(baseInput({ blocks }));
    const hookRec = recs.find((r) => r.blockId === 'b-hook');
    expect(hookRec).toBeUndefined();
  });
});

describe('generateRecommendations — determinism', () => {
  it('produces identical output across repeated calls', () => {
    const a = generateRecommendations(baseInput());
    const b = generateRecommendations(baseInput());
    expect(a).toEqual(b);
  });

  it('is fail-safe on malformed input', () => {
    // @ts-expect-error — intentionally malformed
    expect(generateRecommendations(null)).toEqual([]);
    // @ts-expect-error — intentionally malformed
    expect(generateRecommendations({})).toEqual([]);
  });
});

describe('evaluateAcceptance — collaboration safety rules', () => {
  it('applies when block unlocked and text matches the rec baseline', () => {
    expect(
      evaluateAcceptance({ status: 'pending', blockLocked: false, currentBlockText: 'x', recBefore: 'x' }),
    ).toEqual({ action: 'apply', reason: 'ok' });
  });

  it('refuses when the target block is locked', () => {
    expect(
      evaluateAcceptance({ status: 'pending', blockLocked: true, currentBlockText: 'x', recBefore: 'x' }),
    ).toEqual({ action: 'refuse', reason: 'locked' });
  });

  it('supersedes when the block was manually edited after the rec (manual edits win)', () => {
    expect(
      evaluateAcceptance({
        status: 'pending',
        blockLocked: false,
        currentBlockText: 'edited by a human',
        recBefore: 'original',
      }),
    ).toEqual({ action: 'supersede', reason: 'manual_edit_precedence' });
  });

  it('refuses an already-resolved rec', () => {
    expect(
      evaluateAcceptance({ status: 'accepted', blockLocked: false, currentBlockText: 'x', recBefore: 'x' }).action,
    ).toBe('refuse');
  });
});
