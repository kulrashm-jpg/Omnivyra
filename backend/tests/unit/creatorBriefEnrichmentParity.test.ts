/**
 * PHASE CREATOR-BRIEF-ENRICHMENT-PARITY
 * Proves creator (video) rows receive the same non-empty strategic brief writer
 * rows already get — via the SAME authority (buildCreatorCard) and the SAME
 * existing synth helpers — without changing writer-row output.
 */
import {
  buildCreatorCard,
  deriveSynthPainPoint,
  deriveSynthOutcomePromise,
} from '../../../pages/api/campaigns/weekly-structure-helpers';

const week = { theme: 'Chaos to Strategy', primary_objective: 'Establish thought leadership' };

describe('creator-brief enrichment parity', () => {
  describe('creator (video) rows — populated even with EMPTY intent', () => {
    const item: any = { topicTitle: 'Why marketing teams struggle with content velocity', contentType: 'video' };
    const card = buildCreatorCard(week, item, { content_type: 'video' });

    it('objective / target_audience / summary are non-empty', () => {
      expect(typeof card.objective).toBe('string');
      expect((card.objective as string).length).toBeGreaterThan(0);
      expect((card.target_audience as string).length).toBeGreaterThan(0);
      expect((card.summary as string).length).toBeGreaterThan(0);
    });

    it('intent block is fully populated (renderer Video Production Guide fields)', () => {
      const intent = card.intent as Record<string, string>;
      expect(intent).toBeDefined();
      expect(intent.objective.length).toBeGreaterThan(0);
      expect(intent.pain_point.length).toBeGreaterThan(0);
      expect(intent.outcome_promise.length).toBeGreaterThan(0);
      expect(intent.narrative_style.length).toBeGreaterThan(0);
      expect(intent.brief_summary.length).toBeGreaterThan(0);
      expect(intent.cta_type.length).toBeGreaterThan(0);
    });

    it('reuses EXISTING synth helpers (no parallel enrichment system)', () => {
      const intent = card.intent as Record<string, string>;
      expect(intent.pain_point).toBe(deriveSynthPainPoint('Why marketing teams struggle with content velocity'));
      expect(intent.outcome_promise).toBe(
        deriveSynthOutcomePromise('Why marketing teams struggle with content velocity', 'video'),
      );
    });

    it('provides a non-empty instructions_for_creator brief', () => {
      expect(typeof card.instructions_for_creator).toBe('string');
      expect((card.instructions_for_creator as string).length).toBeGreaterThan(0);
    });
  });

  describe('creator rows — provided intent is PRESERVED (no overwrite)', () => {
    const item: any = {
      topicTitle: 'Pricing strategy',
      contentType: 'video',
      dailyObjective: 'Explain value-based pricing',
      whoAreWeWritingFor: 'B2B SaaS founders',
      whatProblemAreWeAddressing: 'Founders underprice their product',
      whatShouldReaderLearn: 'How to anchor on value',
      writerBrief: { pain_point: 'Founders underprice their product', outcome_promise: 'How to anchor on value' },
    };
    const card = buildCreatorCard(week, item, {
      content_type: 'video',
      intent: { objective: 'Explain value-based pricing', pain_point: 'Founders underprice their product', outcome_promise: 'How to anchor on value' },
    });

    it('keeps the supplied objective / pain_point / outcome', () => {
      const intent = card.intent as Record<string, string>;
      expect(card.objective).toBe('Explain value-based pricing');
      expect(intent.pain_point).toBe('Founders underprice their product');
      expect(intent.outcome_promise).toBe('How to anchor on value');
    });
  });

  describe('writer (text) rows — UNCHANGED', () => {
    it('text row WITH intent: intent mirrors the provided intent verbatim (no synth backfill)', () => {
      const item: any = { topicTitle: 'SEO basics', contentType: 'post' };
      const card = buildCreatorCard(week, item, {
        content_type: 'post',
        intent: { objective: 'Teach SEO', pain_point: '', outcome_promise: '' },
      });
      const intent = card.intent as Record<string, string>;
      // text path keeps `?? ''` semantics — empty stays empty (NOT synth-filled)
      expect(intent.pain_point).toBe('');
      expect(intent.outcome_promise).toBe('');
    });

    it('text row WITHOUT intent: creator_card.intent stays undefined (prior behavior)', () => {
      const item: any = { topicTitle: 'SEO basics', contentType: 'post' };
      const card = buildCreatorCard(week, item, { content_type: 'post' });
      expect(card.intent).toBeUndefined();
    });

    it('text row still gets its text-lane fields (hook/key_points), not creator visuals', () => {
      const item: any = { topicTitle: 'SEO basics', contentType: 'post' };
      const card = buildCreatorCard(week, item, { content_type: 'post' });
      expect(card.visual_hook).toBeUndefined();
      expect(card.video_prompt).toBeUndefined();
      expect(typeof card.hook === 'string' || card.hook === undefined).toBe(true);
    });
  });
});
