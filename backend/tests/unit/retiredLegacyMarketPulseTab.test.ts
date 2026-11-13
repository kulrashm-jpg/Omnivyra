/**
 * Owner ruling (d), 2026-11-13: Market Pulse has ONE customer entry, the Executive room
 * at /market-pulse. The legacy V1 MarketPulseTab on /recommendations is retired. It
 * called /api/market-pulse/job/create, which is admin-only since 55's gate
 * (MARKET_PULSE_ADMIN_REQUIRED), so members would get a 403.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('legacy Market Pulse tab is retired', () => {
  it('the legacy component no longer exists', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'components/recommendations/tabs/MarketPulseTab.tsx'))).toBe(false);
  });

  it.each([
    'components/RecommendationsSectionsA.tsx',
    'components/RecommendationsSectionsB.tsx',
    'components/RecommendationsContent.tsx',
    'components/RecommendationsContentController.tsx',
    'hooks/useRecommendationsState.tsx',
    'pages/recommendations.tsx',
  ])('%s does not import it', (file) => {
    expect(read(file)).not.toMatch(/tabs\/MarketPulseTab['"]/);
  });

  it('selecting PULSE goes to /market-pulse, never to the admin-only V2 console', () => {
    const src = read('hooks/useRecommendationsState.tsx');
    expect(src).toMatch(/activeOpportunityTab === 'PULSE'\) \{\s*void router\.replace\('\/market-pulse'\)/);
    expect(src).not.toMatch(/intelTab=market-pulse/);
  });

  it("keeps the 'PULSE' tab id so ?tab=PULSE links still resolve (then redirect)", () => {
    expect(read('hooks/useRecommendationsState.tsx')).toMatch(/\['TREND', 'LEAD', 'PULSE'\]\.includes\(queryTab\)/);
    expect(read('components/RecommendationsSectionsA.tsx')).toMatch(/href="\/market-pulse"/);
  });
});
