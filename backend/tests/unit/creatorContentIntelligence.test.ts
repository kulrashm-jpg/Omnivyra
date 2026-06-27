import {
  extractIntelligence, summarize, searchIntelligence, blueprintRoleToIntelligence,
} from '../../../lib/creator-templates/contentIntelligence';
import { STORY_BLUEPRINTS } from '../../../lib/creator-templates/storyBlueprint';
import { createPackage, addIntakeSource, packageIntelligence } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';

const TEXT = [
  'Boost Productivity by 92% with Acme Flow',                       // headline + stat
  'Teams struggle with slow, manual onboarding that wastes time.',  // pain
  'Our solution automates onboarding so you can ship faster.',      // solution
  'Increase productivity. Boost productivity. Improve productivity.',// duplicate group
  'Plans start at $49/month. 3x faster than the alternative.',       // pricing + multiplier + comparison
  '"Acme Flow changed everything." — Jane Doe, CEO',                 // quote + testimonial
  'It is the best, #1, guaranteed solution.',                        // claim + risk
  'Step 1: connect. Step 2: configure.',                             // process
  'How do I get started?',                                           // faq
  'Get started free today.',                                         // cta
  'Built for executives in SaaS. See https://acme.com/docs',         // audience + industry + reference
].join('\n');

describe('Content Intelligence — deterministic extraction', () => {
  const intel = extractIntelligence(TEXT);

  it('extracts every major category', () => {
    expect(intel.statistics.some((s) => s.text.includes('92%'))).toBe(true);
    expect(intel.statistics.some((s) => /3x/i.test(s.text))).toBe(true);
    expect(intel.pricing.some((p) => p.text.includes('$49'))).toBe(true);
    expect(intel.painPoints.length).toBeGreaterThan(0);
    expect(intel.solutions.length).toBeGreaterThan(0);
    expect(intel.quotes.some((q) => /changed everything/.test(q.text))).toBe(true);
    expect(intel.testimonials.length).toBeGreaterThan(0);
    expect(intel.claims.length).toBeGreaterThan(0);
    expect(intel.risks.length).toBeGreaterThan(0);
    expect(intel.ctas.length).toBeGreaterThan(0);
    expect(intel.faqs.some((f) => f.text.endsWith('?'))).toBe(true);
    expect(intel.processes.length).toBeGreaterThan(0);
    expect(intel.audiences.some((a) => /executive/i.test(a.text))).toBe(true);
    expect(intel.industries.some((a) => /saas/i.test(a.text))).toBe(true);
    expect(intel.references.some((r) => r.text.startsWith('http'))).toBe(true);
  });

  it('groups duplicates without deleting originals', () => {
    const benefits = intel.benefits;
    const productivity = benefits.filter((b) => b.duplicateGroup === 'productivity');
    expect(productivity.length).toBeGreaterThanOrEqual(2); // increase/boost/improve all grouped, all kept
  });

  it('scores importance deterministically (headline stat is HIGH)', () => {
    const headlineStat = intel.statistics.find((s) => s.text.includes('92%'));
    expect(headlineStat?.importance).toBe('HIGH');
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(intel.keywords[0]?.importance ?? 'LOW');
  });

  it('every item carries the knowledge-graph shape', () => {
    const item = intel.ctas[0]!;
    expect(item).toEqual(expect.objectContaining({ id: expect.any(String), category: 'ctas', text: expect.any(String), confidence: expect.any(Number), location: expect.any(Number), source: 'package', priority: expect.any(Number), duplicateGroup: expect.any(String), importance: expect.any(String) }));
  });

  it('is deterministic — same text → identical intelligence', () => {
    expect(JSON.stringify(extractIntelligence(TEXT))).toBe(JSON.stringify(extractIntelligence(TEXT)));
  });

  it('produces a structured summary of counts', () => {
    const sum = summarize(intel);
    expect(sum.statistics).toBe(intel.statistics.length);
    expect(sum.ctas).toBeGreaterThan(0);
    expect(sum.pricing).toBeGreaterThan(0);
  });
});

describe('Content Intelligence — search + blueprint + package bridge', () => {
  const intel = extractIntelligence(TEXT);

  it('deterministic search maps natural queries to categories', () => {
    expect(searchIntelligence(intel, 'find statistics')).toBe(intel.statistics);
    expect(searchIntelligence(intel, 'find pricing')).toBe(intel.pricing);
    expect(searchIntelligence(intel, 'find testimonials')).toBe(intel.testimonials);
    expect(searchIntelligence(intel, 'productivity').length).toBeGreaterThan(0); // free-text
  });

  it('Story Blueprint roles consume intelligence (no extraction in the blueprint)', () => {
    const flow = STORY_BLUEPRINTS['case-study'].narrativeFlow; // Challenge → Approach → Execution → Results → Lessons → CTA
    const mapped = blueprintRoleToIntelligence(flow, intel);
    const byRole = Object.fromEntries(mapped.map((m) => [m.role, m.category]));
    expect(byRole['Challenge']).toBe('painPoints');
    expect(byRole['Results']).toBe('statistics');
    expect(byRole['CTA']).toBe('ctas');
  });

  it('package → intelligence bridge re-runs over the merged document', () => {
    let p = createPackage('pkg-i');
    p = addIntakeSource(p, fromExistingContent(TEXT), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
    const intelFromPkg = packageIntelligence(p);
    expect(intelFromPkg.metadata.source).toBe('pkg-i');
    expect(intelFromPkg.statistics.some((s) => s.text.includes('92%'))).toBe(true);
  });
});
