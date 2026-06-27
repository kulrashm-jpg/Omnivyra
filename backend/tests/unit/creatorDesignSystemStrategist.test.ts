import type { CreatorTemplate } from '../../../lib/creator-templates';
import { createCollection, type TemplateResolver } from '../../../lib/creator-templates/collection';
import { scoreCollection, recommendCollections, type StrategyContext } from '../../../lib/creator-templates/designSystemStrategist';

const tpl = (id: string, family: string, meta: Record<string, unknown>, typ = 'feature', den = 'balanced'): CreatorTemplate => ({
  id, assetFamily: family as CreatorTemplate['assetFamily'], name: id, category: 'C', description: '',
  preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: {} },
  visualLanguage: { typographyWeight: typ as any, densityBias: den as any },
  formDefinition: { fields: [] }, renderingContract: { renderingContractVersion: 'v', family: family as any },
  version: 1, status: 'draft', ownership: 'user', tags: [], metadata: meta,
});

const luxMeta = { recommendedUseCases: ['Product launch'], aspectSupport: ['1:1', '4:5'], difficulty: 'advanced', keywords: ['saas', 'executive'] };
const LIB: Record<string, CreatorTemplate> = {
  lImg: tpl('lImg', 'image', luxMeta), lCar: tpl('lCar', 'carousel', luxMeta), lInf: tpl('lInf', 'infographic', luxMeta),
  mImg: tpl('mImg', 'image', { recommendedUseCases: ['Brand content'], aspectSupport: ['16:9'], difficulty: 'beginner', keywords: ['general'] }, 'lead', 'minimal'),
};
const resolve: TemplateResolver = (id) => LIB[id] ?? null;

const colLux = { ...createCollection({ id: 'col-lux', ownerUserId: 'u1', templateIds: ['lImg', 'lCar', 'lInf'], category: 'Product Launch', brandStyle: 'luxury' }) };
const colMin = { ...createCollection({ id: 'col-min', ownerUserId: 'u1', templateIds: ['mImg'], category: 'General', brandStyle: 'minimal' }) };

const ctx: StrategyContext = {
  objective: 'product_launch', industry: 'saas', audience: 'executive', platformMix: ['linkedin'],
  companyMaturity: 'enterprise', visualStyle: 'luxury', requiredFamilies: ['image', 'carousel', 'infographic'],
};

describe('Design System Strategist — deterministic scoring', () => {
  it('scores a matching collection with deterministic reasons', () => {
    const s = scoreCollection(colLux, ctx, resolve);
    expect(s.reasons).toContain('Best for Product Launch');
    expect(s.reasons).toContain('Strong visual consistency');
    expect(s.reasons).toContain('Matches Saas positioning');
    expect(s.reasons).toContain('Optimized for Linkedin-heavy campaigns');
    expect(s.reasons).toContain('Fits Executive audience');
    expect(s.reasons).toContain('Matches Luxury brand style');
    expect(s.reasons).toContain('Suited to Enterprise maturity');
    expect(s.reasons).toContain('Complete multi-format system');
    expect(s.score).toBeGreaterThan(80);
  });

  it('scores a non-matching collection low', () => {
    const s = scoreCollection(colMin, ctx, resolve);
    expect(s.score).toBeLessThan(scoreCollection(colLux, ctx, resolve).score);
  });

  it('ranks stably (score desc, id asc) and is deterministic', () => {
    const r1 = recommendCollections([colMin, colLux], ctx, resolve);
    expect(r1[0]!.collectionId).toBe('col-lux');
    // Still returns the low-scoring collection (manual selection keeps full set).
    expect(r1.map((r) => r.collectionId)).toContain('col-min');
    const r2 = recommendCollections([colLux, colMin], ctx, resolve);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('produces no reasons (and no crash) for an empty context', () => {
    const s = scoreCollection(colLux, {}, resolve);
    // Visual consistency + completeness are context-free signals → may fire.
    expect(s.reasons).not.toContain('Best for Product Launch');
    expect(typeof s.score).toBe('number');
  });
});
