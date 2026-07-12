/**
 * CAMPAIGN-IMPL-007 — semantic validation engine.
 */
import {
  validateAsset,
  ValidationContext,
  InMemoryLedger,
  emptyValidationStats,
  tallyValidation,
  creatorAssetToGenerated,
  type GeneratedAsset,
} from '../../../lib/shared/campaign/semanticValidation';

const asset = (over: Partial<GeneratedAsset> = {}): GeneratedAsset => ({
  content_type: 'post',
  platform: 'linkedin',
  text: 'A completely original body about onboarding value.',
  headline: 'Onboarding value in a week',
  opening: 'Teams reach value fast.',
  cta: 'Book a demo',
  idea_fingerprint: 'idea_a',
  narrative_fingerprint: 'narr_a',
  master_idea_id: 'mi_a',
  variant_id: 'cv_a',
  ...over,
});

describe('validateAsset — a clean asset is ACCEPTed', () => {
  it('accepts the first, unique asset', () => {
    const ctx = new ValidationContext();
    const r = validateAsset(asset(), ctx);
    expect(r.decision).toBe('ACCEPT');
    expect(r.findings).toHaveLength(0);
  });
});

describe('duplicate dimensions → REGENERATE', () => {
  const setup = () => {
    const ctx = new ValidationContext();
    ctx.commit(asset()); // an accepted baseline
    return ctx;
  };

  it('duplicate headline', () => {
    const r = validateAsset(asset({ text: 'different body', opening: 'different open', cta: 'Different', idea_fingerprint: 'x', narrative_fingerprint: 'y', variant_id: 'cv_b', headline: 'Onboarding value in a week' }), setup());
    expect(r.decision).toBe('REGENERATE');
    expect(r.findings.some((f) => f.dimension === 'duplicate_headline')).toBe(true);
  });

  it('duplicate opening sentence', () => {
    const r = validateAsset(asset({ headline: 'new', text: 'x', cta: 'Different', idea_fingerprint: 'x', narrative_fingerprint: 'y', variant_id: 'cv_b', opening: 'Teams reach value fast.' }), setup());
    expect(r.decision).toBe('REGENERATE');
    expect(r.findings.some((f) => f.dimension === 'duplicate_opening')).toBe(true);
  });

  it('duplicate CTA', () => {
    const r = validateAsset(asset({ headline: 'new', opening: 'new', text: 'x', idea_fingerprint: 'x', narrative_fingerprint: 'y', variant_id: 'cv_b', cta: 'Book a demo' }), setup());
    expect(r.findings.some((f) => f.dimension === 'duplicate_cta')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('duplicate semantic idea (fingerprint)', () => {
    const r = validateAsset(asset({ headline: 'new', opening: 'new', cta: 'new', text: 'x', variant_id: 'cv_b', idea_fingerprint: 'idea_a' }), setup());
    expect(r.findings.some((f) => f.dimension === 'duplicate_semantic_idea')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('duplicate narrative (fingerprint)', () => {
    const r = validateAsset(asset({ headline: 'new', opening: 'new', cta: 'new', text: 'x', idea_fingerprint: 'x', variant_id: 'cv_b', narrative_fingerprint: 'narr_a' }), setup());
    expect(r.findings.some((f) => f.dimension === 'duplicate_narrative')).toBe(true);
  });

  it('duplicate carousel slide (within the asset)', () => {
    const r = validateAsset(asset({ content_type: 'carousel', headline: 'h', opening: 'o', cta: 'c', text: 'x', idea_fingerprint: 'x', narrative_fingerprint: 'y', variant_id: 'cv_b', slides: ['Slide one', 'Slide two', 'Slide one'] }), new ValidationContext());
    expect(r.findings.some((f) => f.dimension === 'duplicate_slide')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('duplicate asset on same platform+type', () => {
    const ctx = setup();
    const r = validateAsset(asset({ headline: 'new', opening: 'new', cta: 'new', idea_fingerprint: 'x', narrative_fingerprint: 'y', variant_id: 'cv_b', text: 'A completely original body about onboarding value.' }), ctx);
    expect(r.findings.some((f) => f.dimension === 'duplicate_asset')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });
});

describe('cross-platform duplication → ADAPT (shared excluded)', () => {
  it('same content on a different platform, NOT shared → ADAPT', () => {
    const ctx = new ValidationContext();
    ctx.commit(asset({ platform: 'linkedin', text: 'Same body for both.', headline: 'h1', opening: 'o1', cta: 'c1', idea_fingerprint: 'i1', narrative_fingerprint: 'n1', variant_id: 'v1' }));
    const r = validateAsset(asset({ platform: 'facebook', text: 'Same body for both.', headline: 'h2', opening: 'o2', cta: 'c2', idea_fingerprint: 'i2', narrative_fingerprint: 'n2', variant_id: 'v2' }), ctx);
    expect(r.findings.some((f) => f.dimension === 'cross_platform_duplication')).toBe(true);
    expect(r.decision).toBe('ADAPT');
  });

  it('shared cross-posted content is ACCEPTed (excluded)', () => {
    const ctx = new ValidationContext();
    ctx.commit(asset({ platform: 'linkedin', text: 'Same body shared.', shared: true, headline: 'h1', opening: 'o1', cta: 'c1', idea_fingerprint: 'i1', narrative_fingerprint: 'n1', variant_id: 'v1' }));
    const r = validateAsset(asset({ platform: 'facebook', text: 'Same body shared.', shared: true, headline: 'h2', opening: 'o2', cta: 'c2', idea_fingerprint: 'i2', narrative_fingerprint: 'n2', variant_id: 'v2' }), ctx);
    expect(r.decision).toBe('ACCEPT');
  });
});

describe('historical duplication (ledger, dimension 9)', () => {
  it('REGENERATEs when the idea was published before', () => {
    const ledger = new InMemoryLedger();
    ledger.add('idea_a');
    const ctx = new ValidationContext(ledger);
    const r = validateAsset(asset(), ctx);
    expect(r.findings.some((f) => f.dimension === 'historical_duplication')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('no ledger → dimension 9 skipped (backward compatible)', () => {
    const r = validateAsset(asset(), new ValidationContext());
    expect(r.findings.some((f) => f.dimension === 'historical_duplication')).toBe(false);
  });
});

describe('Master-Idea consistency → DROP (highest priority)', () => {
  it('a variant bound to two Master Ideas is DROPped', () => {
    const ctx = new ValidationContext();
    ctx.commit(asset({ variant_id: 'cv_shared', master_idea_id: 'mi_1' }));
    const r = validateAsset(asset({ variant_id: 'cv_shared', master_idea_id: 'mi_2', headline: 'x', opening: 'y', cta: 'z', text: 'q', idea_fingerprint: 'q', narrative_fingerprint: 'r' }), ctx);
    expect(r.findings.some((f) => f.dimension === 'master_idea_consistency')).toBe(true);
    expect(r.decision).toBe('DROP');
  });

  it('DROP wins even when duplicates are also present', () => {
    const ctx = new ValidationContext();
    ctx.commit(asset({ variant_id: 'cv_shared', master_idea_id: 'mi_1' }));
    const r = validateAsset(asset({ variant_id: 'cv_shared', master_idea_id: 'mi_2' }), ctx); // also dup headline/cta/idea
    expect(r.decision).toBe('DROP');
  });
});

describe('determinism + stats', () => {
  it('same asset + context → same decision', () => {
    const mk = () => { const c = new ValidationContext(); c.commit(asset()); return c; };
    const dup = asset({ variant_id: 'cv_b', idea_fingerprint: 'x', narrative_fingerprint: 'y', opening: 'z', text: 't' }); // dup headline+cta
    expect(validateAsset(dup, mk()).decision).toBe(validateAsset(dup, mk()).decision);
  });

  it('creatorAssetToGenerated adapts a carousel into the canonical asset (IMPL-007A)', () => {
    const g = creatorAssetToGenerated({
      content_type: 'carousel',
      platform: 'instagram',
      asset_payload: {
        slides: [
          { headline: 'Hook', body_text: 'Why it matters' },
          { headline: 'Proof', body_text: 'The evidence' },
        ],
        packaging: { cta: 'Book a demo' },
        headline: 'Value in a week',
      },
      content: { master_idea: { id: 'mi_c', cta_strategy: 'Book a demo' }, fingerprint: { idea: 'if_c', narrative: 'nf_c' }, variant: { variant_id: 'cv_c' }, distribution_mode: 'unique' },
    });
    expect(g.content_type).toBe('carousel');
    expect(g.slides).toHaveLength(2);
    expect(g.master_idea_id).toBe('mi_c');
    expect(g.idea_fingerprint).toBe('if_c');
    expect(g.variant_id).toBe('cv_c');
    expect(g.cta).toBe('Book a demo');
  });

  it('a carousel with two identical slides is caught (duplicate_slide → REGENERATE)', () => {
    const g = creatorAssetToGenerated({
      content_type: 'carousel',
      platform: 'instagram',
      asset_payload: { slides: [{ headline: 'A', body_text: 'same' }, { headline: 'B', body_text: 'x' }, { headline: 'A', body_text: 'same' }] },
      content: { master_idea: { id: 'mi_d' }, fingerprint: {} },
    });
    const r = validateAsset(g, new ValidationContext());
    expect(r.findings.some((f) => f.dimension === 'duplicate_slide')).toBe(true);
    expect(r.decision).toBe('REGENERATE');
  });

  it('infographic sections map to slides for duplicate-section detection', () => {
    const g = creatorAssetToGenerated({
      content_type: 'infographic',
      platform: 'linkedin',
      asset_payload: { sections: [{ title: 'S1', body: 'one' }, { title: 'S1', body: 'one' }] },
      content: {},
    });
    expect(g.slides).toHaveLength(2);
    expect(validateAsset(g, new ValidationContext()).findings.some((f) => f.dimension === 'duplicate_slide')).toBe(true);
  });

  it('creatorAssetToGenerated is backward compatible with a legacy payload (no master_idea)', () => {
    const g = creatorAssetToGenerated({ content_type: 'image', platform: 'x', asset_payload: { overlay_text: 'hello' }, content: {} });
    expect(g.text).toBe('hello');
    expect(g.master_idea_id).toBeNull();
    expect(g.slides).toBeUndefined();
    expect(() => validateAsset(g, new ValidationContext())).not.toThrow();
  });

  it('tallyValidation folds decisions into rates', () => {
    const stats = emptyValidationStats();
    tallyValidation(stats, { decision: 'ACCEPT', findings: [], reason: 'ok' });
    tallyValidation(stats, { decision: 'DROP', findings: [{ dimension: 'master_idea_consistency', detail: 'x' }], reason: 'r' });
    tallyValidation(stats, { decision: 'ACCEPT', findings: [], reason: 'ok' }, { regenerated: true });
    expect(stats.generated).toBe(3);
    expect(stats.accepted).toBe(2);
    expect(stats.validated).toBe(2);
    expect(stats.dropped).toBe(1);
    expect(stats.regenerated).toBe(1);
    expect(stats.reasons.master_idea_consistency).toBe(1);
  });
});
