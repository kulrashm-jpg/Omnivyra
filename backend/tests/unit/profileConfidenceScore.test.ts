/**
 * Profile confidence score — must reflect ACTUAL field confidence, not mere
 * presence. Regression guard for the "35% complete but 100% confidence"
 * inconsistency: a profile of Low-confidence inferred fields must not read as
 * fully confident, and confidence must stay consistent with computeMissingFields
 * (which treats Low-confidence fields as missing).
 */
import { computeConfidenceScore, computeMissingFields } from '../../services/companyProfile/extractionSchema';

type Src = 'website' | 'social' | 'inferred' | 'user' | 'missing';
type Conf = 'High' | 'Medium' | 'Low';
const f = (source: Src, confidence: Conf) => ({ value: 'x', source, confidence });
const missing = () => ({ value: null, source: 'missing' as const, confidence: 'Low' as const });

// The 12 top-level fields computeConfidenceScore weighs.
function extraction(field: ReturnType<typeof f> | ReturnType<typeof missing>) {
  const e: Record<string, unknown> = {};
  for (const k of ['company_name', 'industry', 'category', 'website_url', 'geography',
    'products_services', 'target_audience', 'brand_voice', 'goals', 'competitors',
    'unique_value_proposition', 'content_themes']) e[k] = field;
  e.social_profiles = {};
  e.missing_fields = [];
  return e as never;
}

describe('computeConfidenceScore', () => {
  test('all High-confidence fields → 100', () => {
    expect(computeConfidenceScore(extraction(f('website', 'High')))).toBe(100);
  });

  test('all Low-confidence inferred fields → far below 100 (the bug)', () => {
    const score = computeConfidenceScore(extraction(f('inferred', 'Low')));
    expect(score).toBeLessThan(50);
    expect(score).toBe(20); // 0.2 weight each
  });

  test('all missing fields → 0', () => {
    expect(computeConfidenceScore(extraction(missing()))).toBe(0);
  });

  test('Medium sits between Low and High', () => {
    expect(computeConfidenceScore(extraction(f('website', 'Medium')))).toBe(60);
  });

  test('consistency: a Low field counts as missing for completion AND is discounted for confidence', () => {
    const ext = extraction(f('inferred', 'Low'));
    // computeMissingFields treats every Low field as missing → all 12 missing.
    expect(computeMissingFields(ext)).toHaveLength(12);
    // confidence is correspondingly low (not 100).
    expect(computeConfidenceScore(ext)).toBeLessThan(50);
  });
});
