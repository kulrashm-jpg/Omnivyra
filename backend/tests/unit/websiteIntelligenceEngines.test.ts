/**
 * Phase 18 — deterministic website intelligence engines (Content, Technical,
 * Accessibility, Brand). Pure scorers, no DB. Proves: real signals score, absent
 * signals are not_evaluable (honest), confidence reflects coverage.
 */
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';
import { scoreTechnicalIntelligence } from '../../services/websiteIntelligence/technicalIntelligenceEngine';
import { scoreAccessibilityIntelligence } from '../../services/websiteIntelligence/accessibilityIntelligenceEngine';
import { scoreBrandIntelligence } from '../../services/websiteIntelligence/brandIntelligenceEngine';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const longText = 'Acme builds reliable software that helps teams ship faster every single week. '.repeat(6);

const pages: any[] = [
  { id: 'p1', url: 'https://acme.com/', title: 'Acme — Home', meta_title: 'Acme', meta_description: 'Acme home page', page_type: 'home', headings: [{ level: 1, text: 'Welcome to Acme' }, { level: 2, text: 'Features' }], ctas: [{ text: 'Get started' }], internal_link_count: 6, http_status: 200, crawl_depth: 0, last_crawled_at: '2026-06-01T00:00:00Z', crawl_metadata: { meta_tags: { 'og:title': 'Acme', viewport: 'width=device-width', robots: 'index' } } },
  { id: 'p2', url: 'https://acme.com/blog/post', title: 'Blog Post', meta_title: null, meta_description: 'A post', page_type: 'blog', headings: [{ level: 1, text: 'Post' }], ctas: [], internal_link_count: 2, http_status: 404, crawl_depth: 2, last_crawled_at: '2026-06-01T00:00:00Z', crawl_metadata: { meta_tags: {} } },
];
const blocks: any[] = [
  { page_id: 'p1', block_type: 'paragraph', content_text: longText, heading_level: null },
  { page_id: 'p1', block_type: 'heading', content_text: 'Features', heading_level: 2 },
  { page_id: 'p1', block_type: 'list', content_text: 'a b c', heading_level: null },
  { page_id: 'p2', block_type: 'paragraph', content_text: longText, heading_level: null },
];
const links: any[] = [
  { from_page_id: 'p1', anchor_text: 'View pricing details' },
  { from_page_id: 'p1', anchor_text: 'click here' },
];

describe('Content Intelligence', () => {
  it('scores real signals and reports missing pages honestly', () => {
    const r = scoreContentIntelligence(pages, blocks, NOW);
    expect(typeof r.contentScore).toBe('number');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.missingContent).toEqual(expect.arrayContaining(['Pricing visibility', 'Contact information']));
    expect(r.checks.find((c) => c.key === 'headline_clarity')?.score).toBe(100); // both pages have an H1
    expect(r.checks.find((c) => c.key === 'icp_alignment')?.status).toBe('not_evaluable');
    expect(r.provenance.deterministic).toBe(true);
  });
  it('returns null score (unavailable) when there is no crawl data', () => {
    const r = scoreContentIntelligence([], [], NOW);
    expect(r.contentScore).toBeNull();
    expect(r.confidence).toBe(0);
  });
});

describe('Technical Intelligence', () => {
  it('flags broken pages and marks uncrawlable signals not_evaluable', () => {
    const r = scoreTechnicalIntelligence(pages, NOW);
    expect(typeof r.technicalScore).toBe('number');
    expect(r.checks.find((c) => c.key === 'broken_links')?.score).toBeLessThan(100); // p2 is 404
    expect(r.checks.find((c) => c.key === 'canonical_tags')?.status).toBe('not_evaluable');
    expect(r.checks.find((c) => c.key === 'structured_data')?.status).toBe('not_evaluable');
    expect(r.checks.find((c) => c.key === 'https')?.score).toBe(100);
  });
});

describe('Accessibility Intelligence', () => {
  it('evaluates heading/link/viewport, marks DOM-only checks not_evaluable', () => {
    const r = scoreAccessibilityIntelligence(pages, blocks, links, NOW);
    expect(r.checks.find((c) => c.key === 'heading_hierarchy')?.status).toBe('pass');
    expect(r.checks.find((c) => c.key === 'alt_text')?.status).toBe('not_evaluable');
    expect(r.checks.find((c) => c.key === 'contrast')?.status).toBe('not_evaluable');
    expect(['AA', 'A', 'none', 'insufficient_data']).toContain(r.wcagLevel);
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe('Brand Intelligence', () => {
  it('scores asset completeness + community trust, gaps for NPS/competitor', () => {
    const identity: any = { colors: { primary: '#000' }, typography: { body: 'Inter' }, logo_assets: { primary: 'x' }, voice: { tone: 'confident' }, completeness: 0.8, status: 'published', version: 2, published_at: '2026-05-01T00:00:00Z' };
    const community: any[] = [{ sentiment: 'positive', platform: 'linkedin' }, { sentiment: 'positive', platform: 'x' }, { sentiment: 'negative', platform: 'linkedin' }];
    const r = scoreBrandIntelligence(identity, { logo_url: 'x' }, community, pages, NOW);
    expect(typeof r.brandScore).toBe('number');
    expect(typeof r.brandTrust).toBe('number');
    expect(typeof r.brandMaturity).toBe('number');
    expect(r.checks.find((c) => c.key === 'brand_differentiation')?.status).toBe('not_evaluable');
  });
  it('without identity or community, asset/trust checks are not_evaluable', () => {
    const r = scoreBrandIntelligence(null, null, [], [], NOW);
    expect(r.checks.find((c) => c.key === 'brand_colors')?.status).toBe('not_evaluable');
    expect(r.checks.find((c) => c.key === 'trust_consistency')?.status).toBe('not_evaluable');
  });
});
