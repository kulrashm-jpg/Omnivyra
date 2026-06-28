import {
  resolveEditorContext, resolveGeneratorContext, serializeMarketingBrief, readMarketingBrief,
  MARKETING_BRIEF_SESSION_KEY,
} from '../../../lib/content/marketingBriefResolver';
import { emptyMarketingBrief, mergeBrief } from '../../../lib/content/unifiedCreationModel';

const brief = mergeBrief(emptyMarketingBrief('launch-product'), {
  freeText: 'Launch our analytics suite', audience: 'data leaders', tone: 'confident', cta: 'Book a demo', brand: 'Acme', offer: 'Analytics Suite',
});

describe('CREATOR-063 — Canonical marketing brief resolver', () => {
  it('STEP 4 — MarketingBrief → EditorContext is the single editor mapping', () => {
    const e = resolveEditorContext(brief);
    expect(e.goalId).toBe('launch-product');
    expect(e.goalLabel.length).toBeGreaterThan(0);          // resolved from goal registry
    expect(e.topic).toBe('Launch our analytics suite');     // freeText wins
    expect(e.audience).toBe('data leaders');
    expect(e.tone).toBe('confident');
    expect(e.cta).toBe('Book a demo');
    expect(e.brand).toBe('Acme');
  });

  it('STEP 2 — MarketingBrief → GeneratorContext yields the creator_card fragment generators accept', () => {
    const g = resolveGeneratorContext(brief);
    expect(g.topic).toBe('Launch our analytics suite');
    expect(g.audience).toBe('data leaders');
    expect(g.summary.length).toBeGreaterThan(0);
    expect(g.creatorCard.objective).toBeTruthy();
    expect(g.creatorCard.audience).toBe('data leaders');
    expect(g.creatorCard.tone).toBe('confident');
    expect(g.creatorCard.cta).toBe('Book a demo');
    expect(g.creatorCard.brand_context).toBe('Acme');
  });

  it('STEP 6 — null/absent brief yields empty defaults (legacy editor behavior unchanged)', () => {
    const e = resolveEditorContext(null);
    expect(e.goalId).toBeNull();
    expect(e.topic).toBe('');
    expect(e.audience).toBe('');
    const g = resolveGeneratorContext(undefined);
    expect(g.topic).toBe('');
    expect(g.creatorCard).toEqual({});
  });

  it('canonical session bridge round-trips; bad input → null (no throw)', () => {
    expect(MARKETING_BRIEF_SESSION_KEY).toBe('marketing-brief');
    const raw = serializeMarketingBrief(brief);
    expect(readMarketingBrief(raw)).toEqual(brief);
    expect(readMarketingBrief(null)).toBeNull();
    expect(readMarketingBrief('not json{')).toBeNull();
    // Resolver is deterministic.
    expect(resolveEditorContext(brief)).toEqual(resolveEditorContext(brief));
  });
});
