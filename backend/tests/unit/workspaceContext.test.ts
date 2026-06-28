import { buildWorkspaceContext, inheritedSummary } from '../../../lib/content/workspaceContext';
import { resolveEditorContext } from '../../../lib/content/marketingBriefResolver';
import { emptyMarketingBrief, mergeBrief } from '../../../lib/content/unifiedCreationModel';

const brief = mergeBrief(emptyMarketingBrief('launch-product'), {
  freeText: 'Launch our analytics suite', audience: 'data leaders', tone: 'confident', cta: 'Book a demo', brand: 'Acme',
});

describe('CREATOR-069 — Canonical WorkspaceContext', () => {
  it('STEP 4 — every lane inherits one context derived from the brief', () => {
    const c = buildWorkspaceContext(brief);
    expect(c.goalId).toBe('launch-product');
    expect(c.goalLabel.length).toBeGreaterThan(0);
    expect(c.outcomeDescription.length).toBeGreaterThan(0);
    expect(c.audience).toBe('data leaders');
    expect(c.brand).toBe('Acme');
    expect(c.cta).toBe('Book a demo');
    expect(c.tone).toBe('confident');
    expect(c.topic).toBe('Launch our analytics suite');
  });

  it('reuses the canonical resolver — no duplicate context builder', () => {
    // The embedded editor context is exactly resolveEditorContext (single source).
    expect(buildWorkspaceContext(brief).editor).toEqual(resolveEditorContext(brief));
  });

  it('inheritedSummary surfaces Goal/Audience/Brand/CTA so lanes never re-ask', () => {
    const s = inheritedSummary(buildWorkspaceContext(brief));
    expect(s).toMatch(/Goal:/);
    expect(s).toContain('data leaders');
    expect(s).toContain('Acme');
    expect(s).toContain('Book a demo');
  });

  it('null brief → empty defaults (additive; legacy unchanged)', () => {
    const c = buildWorkspaceContext(null);
    expect(c.goalId).toBeNull();
    expect(c.audience).toBe('');
    expect(inheritedSummary(c)).toBe('');
  });
});
