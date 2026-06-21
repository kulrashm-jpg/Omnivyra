/**
 * PHASE CREATOR-BRIEF-UNIVERSAL-COVERAGE
 * Read-time creator-brief synthesis: every creator row renders a populated brief
 * regardless of creation path; writer rows are never touched; populated values
 * are preserved (never overwritten).
 */
import {
  synthesizeCreatorBrief,
  isCreatorContentType,
} from '../../../lib/shared/creatorBriefSynthesis';
import {
  deriveSynthPainPoint,
  deriveSynthOutcomePromise,
} from '../../../pages/api/campaigns/weekly-structure-helpers';

describe('isCreatorContentType', () => {
  it('classifies creator formats as creator', () => {
    for (const ct of ['video', 'reel', 'short', 'image', 'carousel', 'infographic', 'story', 'podcast']) {
      expect(isCreatorContentType(ct)).toBe(true);
    }
  });
  it('classifies writer/text formats as NOT creator', () => {
    for (const ct of ['post', 'article', 'thread', 'tweet', 'poll', 'blog', 'newsletter', '']) {
      expect(isCreatorContentType(ct)).toBe(false);
    }
  });
});

describe('synthesizeCreatorBrief — empty creator row (creator-asset insert / upload / historical)', () => {
  const topic = 'Why marketing teams struggle with content velocity';
  const out = synthesizeCreatorBrief({ existingCard: null, rawItem: {}, intent: null, topic, contentType: 'video' });

  it('populates objective / target_audience / summary', () => {
    expect((out.creator_card.objective as string).length).toBeGreaterThan(0);
    expect((out.creator_card.target_audience as string).length).toBeGreaterThan(0);
    expect((out.creator_card.summary as string).length).toBeGreaterThan(0);
  });

  it('populates the full intent block (renderer Production Guide fields)', () => {
    const intent = out.creator_card.intent as Record<string, string>;
    expect(intent.objective.length).toBeGreaterThan(0);
    expect(intent.target_audience.length).toBeGreaterThan(0);
    expect(intent.brief_summary.length).toBeGreaterThan(0);
    expect(intent.pain_point.length).toBeGreaterThan(0);
    expect(intent.outcome_promise.length).toBeGreaterThan(0);
    expect(intent.cta_type.length).toBeGreaterThan(0);
    expect(intent.narrative_style.length).toBeGreaterThan(0);
  });

  it('reuses ONLY the existing synth authorities (no new logic)', () => {
    const intent = out.creator_card.intent as Record<string, string>;
    expect(intent.pain_point).toBe(deriveSynthPainPoint(topic));
    expect(intent.outcome_promise).toBe(deriveSynthOutcomePromise(topic, 'video'));
  });

  it('also returns a populated top-level intent', () => {
    const intent = out.intent as Record<string, string>;
    expect(intent.pain_point.length).toBeGreaterThan(0);
    expect(intent.outcome_promise.length).toBeGreaterThan(0);
  });
});

describe('synthesizeCreatorBrief — fallback priority (row > card > intent > synth)', () => {
  it('prefers the existing ROW value over everything', () => {
    const out = synthesizeCreatorBrief({
      existingCard: { objective: 'CARD-OBJ', intent: { pain_point: 'CARD-PAIN' } },
      rawItem: { dailyObjective: 'ROW-OBJ', whatProblemAreWeAddressing: 'ROW-PAIN' },
      intent: { objective: 'INTENT-OBJ' },
      topic: 'Pricing',
      contentType: 'video',
    });
    expect(out.creator_card.objective).toBe('ROW-OBJ');
    expect((out.creator_card.intent as any).pain_point).toBe('ROW-PAIN');
  });

  it('falls to creator_card value when row is empty', () => {
    const out = synthesizeCreatorBrief({
      existingCard: { objective: 'CARD-OBJ' },
      rawItem: {},
      intent: { objective: 'INTENT-OBJ' },
      topic: 'Pricing',
      contentType: 'video',
    });
    expect(out.creator_card.objective).toBe('CARD-OBJ');
  });

  it('falls to intent value when row + card empty', () => {
    const out = synthesizeCreatorBrief({
      existingCard: {},
      rawItem: {},
      intent: { pain_point: 'INTENT-PAIN' },
      topic: 'Pricing',
      contentType: 'video',
    });
    expect((out.creator_card.intent as any).pain_point).toBe('INTENT-PAIN');
  });
});

describe('synthesizeCreatorBrief — populated creator rows preserved (no overwrite)', () => {
  it('a fully populated card is returned with every original value intact', () => {
    const card = {
      objective: 'Explain value-based pricing',
      target_audience: 'B2B SaaS founders',
      summary: 'Anchor on value not cost',
      keywords: ['pricing', 'value'],
      intent: {
        objective: 'Explain value-based pricing',
        target_audience: 'B2B SaaS founders',
        brief_summary: 'Anchor on value not cost',
        pain_point: 'Founders underprice',
        outcome_promise: 'Confidence to raise prices',
        cta_type: 'Book a call',
        narrative_style: 'direct and contrarian',
      },
    };
    const out = synthesizeCreatorBrief({ existingCard: card, rawItem: {}, intent: null, topic: 'Pricing', contentType: 'video' });
    expect(out.creator_card.objective).toBe('Explain value-based pricing');
    expect(out.creator_card.target_audience).toBe('B2B SaaS founders');
    expect((out.creator_card.intent as any).pain_point).toBe('Founders underprice');
    expect((out.creator_card.intent as any).outcome_promise).toBe('Confidence to raise prices');
    expect((out.creator_card.intent as any).cta_type).toBe('Book a call');
    expect((out.creator_card.intent as any).narrative_style).toBe('direct and contrarian');
    // untouched extra fields survive
    expect(out.creator_card.keywords).toEqual(['pricing', 'value']);
  });
});
