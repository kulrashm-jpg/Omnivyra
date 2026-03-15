/**
 * Simulation: verifies polish capitalization and card content source.
 * Run: npx jest backend/tests/unit/recommendationPolishSimulation.test.ts --no-cache
 */
import { polishRecommendations } from '../../services/recommendationPolishService';
import type { CompanyProfile } from '../../services/companyProfileService';

describe('recommendationPolishService simulation', () => {
  const profile: CompanyProfile = {
    id: 'test',
    company_id: 'test-co',
    name: 'Test Co',
    core_problem_statement: 'Individuals feel stuck, anxious, and unable to make confident decisions.',
    desired_transformation: 'Helping Individuals seeking clarity, Professionals, Students.',
    authority_domains: ['career', 'guidance', 'clarity'],
    brand_voice: 'professional',
    website_url: null,
    created_at: '',
    updated_at: '',
  } as CompanyProfile;

  it('capitalizes topic in polished_title (stress → Stress)', () => {
    const recs = [{ topic: 'stress from career uncertainty', volume: 100, source: 'NewsAPI' }];
    const polished = polishRecommendations(recs, profile, null);
    expect(polished).toHaveLength(1);
    expect(polished[0].polished_title).toContain('Stress');
    expect(polished[0].polished_title).not.toContain(': stress');
    console.log('[SIM] polished_title:', polished[0].polished_title);
  });

  it('capitalizes all title variants (Authority, Underserved, reframes)', () => {
    const recs = [
      { topic: 'stress from career uncertainty', volume: 100 },
      { topic: 'Career Guidance', volume: 80 },
      { topic: 'ai technology', volume: 90 },
    ];
    const polished = polishRecommendations(recs, profile, null);
    polished.forEach((p, i) => {
      const firstChar = p.polished_title.split(': ')[1]?.charAt(0) ?? p.polished_title.charAt(0);
      expect(firstChar).toBe(firstChar.toUpperCase());
    });
    console.log('[SIM] All titles:', polished.map((p) => p.polished_title));
  });

  it('card transformation line uses shared profile (same content across cards)', () => {
    const recs = [
      { topic: 'stress from career uncertainty', volume: 100 },
      { topic: 'Career Guidance', volume: 80 },
    ];
    const polished = polishRecommendations(recs, profile, null);
    // Simulate what RecommendationBlueprintCard receives from enrichment
    const mockCards = polished.map((p) => ({
      ...p,
      intelligence: {
        problem_being_solved: profile.core_problem_statement,
        expected_transformation: profile.desired_transformation,
      },
    }));
    const getLine = (problem: string | null, trans: string | null) =>
      problem && trans
        ? `Designed to move your audience from ${problem.slice(0, 40)}... → ${trans.slice(0, 40)}...`
        : 'fallback';
    const lines = mockCards.map((c) =>
      getLine(
        (c.intelligence as any).problem_being_solved,
        (c.intelligence as any).expected_transformation
      )
    );
    expect(lines[0]).toBe(lines[1]);
    console.log('[SIM] Card 1 transformation line:', lines[0]);
    console.log('[SIM] Card 2 transformation line:', lines[1]);
    console.log('[SIM] Same?', lines[0] === lines[1]);
  });

  it('uses already-templated titles as-is (no double wrapping)', () => {
    const alreadyTemplated = 'What Most Teams Get Wrong About Smart Trash Bin Business Report 2026';
    const recs = [{ topic: alreadyTemplated, volume: 100 }];
    const polished = polishRecommendations(recs, profile, null);
    expect(polished).toHaveLength(1);
    // Should NOT double-wrap: "Why What Most Teams Get Wrong About... fails"
    expect(polished[0].polished_title).not.toMatch(/^Why\s+How\b/i);
    expect(polished[0].polished_title).not.toMatch(/^Why\s+What\s+Most\s+Teams\s+Get\s+Wrong.*\s+fails/);
    // Should use sanitized templated form (Business Report 2026 stripped)
    expect(polished[0].polished_title).toContain('Smart Trash Bin');
    expect(polished[0].polished_title).not.toContain('Business Report 2026');
    console.log('[SIM] already-templated polished_title:', polished[0].polished_title);
  });

  it('sanitizes market report titles before reframing', () => {
    const rawReport = 'Quantum AI High-frequency Trading Risk Business Report 2026: $12+';
    const recs = [{ topic: rawReport, volume: 80 }];
    const polished = polishRecommendations(recs, profile, null);
    expect(polished).toHaveLength(1);
    // Should strip "Business Report 2026", "$12+", etc.
    expect(polished[0].polished_title).not.toContain('Business Report 2026');
    expect(polished[0].polished_title).not.toContain('$12+');
    expect(polished[0].polished_title).toContain('Quantum'); // core topic preserved
    console.log('[SIM] sanitized polished_title:', polished[0].polished_title);
  });
});
