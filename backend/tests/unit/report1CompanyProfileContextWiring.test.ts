/**
 * PHASE 1 — Company Profile -> Report 1 context wiring.
 *
 * Production report 3a0c23b3-2648-4159-a399-6b83b2a24aaf published, to a real customer:
 *
 *   "Build comparison and decision pages aligned with the current positioning in Other in Other"
 *   "This matters for Other in Other in a emerging market because ..."
 *
 * while that tenant's company_profiles row actually held
 * category "AI tool for structured thinking and clearer life and career decisions",
 * geography "India, Global", and SIX named competitors.
 *
 * Root cause: `report_settings.default_inputs` persists the classifier's terminal bucket
 * ("Other") for business_type/geography, and narrativeHelpers ranked that ABOVE the real
 * profile columns. The fixtures below mirror that exact production shape.
 */
import {
  extractCompanyNarrativeContext,
  firstMeaningful,
} from '../../services/snapshotReport/narrativeHelpers';
import {
  structuredReasoning,
  indefiniteArticle,
  aiVisibilityTactics,
} from '../../services/snapshotReport/actionTacticHelpers';
import { isNonSpecificTaxonomyLabel } from '../../services/companyContextTaxonomy';

/** The real Drishiq profile shape: rich columns, placeholder default_inputs. */
function drishiqInput() {
  return {
    profile: {
      name: 'Drishiq',
      website_url: 'https://drishiq.com',
      industry: 'Decision Support, Personal Development',
      category: 'AI tool for structured thinking and clearer life and career decisions',
      geography: 'India, Global',
      category_list: ['AI tool for structured thinking and clearer life and career decisions'],
      industry_list: ['Decision Support', 'Personal Development'],
      geography_list: ['India', 'Global'],
      competitors_list: ['Wysa', 'Woebot Health', 'Reflectly', 'Craxinno', 'Goodfirms', 'Quora'],
      brand_positioning: 'Culturally aware clarity assistant',
      products_services: 'Guided decision support',
      unique_value: 'Structured thinking for life and career decisions',
    },
    resolved: {
      companyName: 'Drishiq',
      websiteDomain: 'drishiq.com',
      // Exactly what production persisted in report_settings.default_inputs:
      businessType: 'Other',
      geography: 'Other',
      competitors: [],
      socialLinks: [],
      companyContext: { marketFocus: null, productServices: [] },
    },
  } as unknown as Parameters<typeof extractCompanyNarrativeContext>[0]['resolvedInput'];
}

describe('Company Profile -> Report 1 narrative context', () => {
  it('does not let the terminal taxonomy bucket outrank real profile values', () => {
    const ctx = extractCompanyNarrativeContext({ resolvedInput: drishiqInput() });
    expect(ctx.marketContext).not.toBeNull();
    expect(ctx.marketContext).not.toContain('Other');
    expect(ctx.marketFocus).not.toBe('Other');
    expect(ctx.geography).not.toBe('Other');
  });

  it('uses the profile category and geography that actually exist', () => {
    const ctx = extractCompanyNarrativeContext({ resolvedInput: drishiqInput() });
    expect(ctx.marketContext).toContain('AI tool for structured thinking');
    expect(ctx.geography).toBe('India');
  });

  it('cannot produce "in Other in Other" anywhere in the reasoning sentence', () => {
    const ctx = extractCompanyNarrativeContext({ resolvedInput: drishiqInput() });
    const sentence = structuredReasoning({
      decision: { description: 'Several crawled pages are missing titles.' } as never,
      companyContext: ctx,
      strategicContext: { marketType: 'emerging' } as never,
    });
    expect(sentence).not.toContain('Other in Other');
    expect(sentence).not.toContain('for Other');
  });

  it('abstains rather than inventing specificity when nothing meaningful exists', () => {
    const empty = {
      profile: { name: 'Acme', category: 'Other', industry: 'Other', geography: 'Other' },
      resolved: {
        companyName: 'Acme', websiteDomain: 'acme.com', businessType: 'Other', geography: 'Other',
        competitors: [], socialLinks: [], companyContext: { marketFocus: null, productServices: [] },
      },
    } as unknown as Parameters<typeof extractCompanyNarrativeContext>[0]['resolvedInput'];

    const ctx = extractCompanyNarrativeContext({ resolvedInput: empty });
    expect(ctx.marketContext).toBeNull();
    expect(ctx.marketFocus).toBeNull();

    const sentence = structuredReasoning({
      decision: { description: 'Pages are thin.' } as never,
      companyContext: ctx,
    });
    expect(sentence).not.toContain('Other');
  });

  it('recognises terminal buckets and placeholders, not real values', () => {
    for (const bad of ['Other', 'other', 'N/A', 'unknown', 'Unspecified', '', null, undefined]) {
      expect(isNonSpecificTaxonomyLabel(bad)).toBe(true);
    }
    for (const good of ['AI tool for structured thinking', 'India', 'Decision Support']) {
      expect(isNonSpecificTaxonomyLabel(good)).toBe(false);
    }
  });

  it('firstMeaningful falls through placeholders to the first real value', () => {
    expect(firstMeaningful('Other', 'Other', 'India, Global')).toBe('India');
    expect(firstMeaningful('Other', null, undefined)).toBeNull();
  });
});

describe('Declared competitors are preserved but never promoted to observations', () => {
  it('keeps all six declared competitors instead of silently discarding them', () => {
    const ctx = extractCompanyNarrativeContext({ resolvedInput: drishiqInput() });
    expect(ctx.declaredCompetitors).toEqual(
      expect.arrayContaining(['Wysa', 'Woebot Health', 'Reflectly', 'Craxinno', 'Goodfirms', 'Quora']),
    );
    expect(ctx.declaredCompetitors).toHaveLength(6);
  });

  it('exposes them only as declared context, never as detected/observed competitors', () => {
    const ctx = extractCompanyNarrativeContext({ resolvedInput: drishiqInput() });
    // The narrative context is company-declared provenance. Nothing here may masquerade as a
    // public observation: detected_competitors is populated solely by public discovery.
    expect(Object.keys(ctx)).not.toContain('detected_competitors');
    expect(Object.keys(ctx)).not.toContain('observedCompetitors');
  });
});

describe('Article agreement', () => {
  it('cannot emit "a emerging market"', () => {
    const ctx = extractCompanyNarrativeContext({ resolvedInput: drishiqInput() });
    const sentence = structuredReasoning({
      decision: { description: 'Pages are thin.' } as never,
      companyContext: ctx,
      strategicContext: { marketType: 'emerging' } as never,
    });
    expect(sentence).not.toContain('a emerging');
    expect(sentence).toContain('an emerging market');
  });

  it('agrees for every MarketType the union allows', () => {
    expect(indefiniteArticle('emerging')).toBe('an');
    expect(indefiniteArticle('competitive')).toBe('a');
    expect(indefiniteArticle('saturated')).toBe('a');
    expect(indefiniteArticle('niche')).toBe('a');
  });
});

describe('Null AI visibility is not a measured zero', () => {
  const audit = {
    site_structure: {
      homepage: true,
      pricing_pages: [],
      product_pages: ['/product'],
      geo_pages: [],
      blog_pages: [],
    },
  } as never;

  it('emits no AI tactics when the score was never measured', () => {
    expect(aiVisibilityTactics(null, audit)).toEqual([]);
    expect(aiVisibilityTactics(undefined, audit)).toEqual([]);
  });

  it('emits no AI tactics for a non-finite score', () => {
    expect(aiVisibilityTactics(Number.NaN, audit)).toEqual([]);
  });

  it('still emits tactics for a genuine measured zero', () => {
    expect(aiVisibilityTactics(0, audit).length).toBeGreaterThan(0);
  });

  it('emits none for a positive score', () => {
    expect(aiVisibilityTactics(42, audit)).toEqual([]);
  });
});
