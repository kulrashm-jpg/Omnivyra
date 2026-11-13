/**
 * UI D9a (owner rule 3): the campaign-details header is uncluttered.
 * - Secondary destinations (Health, Expert Recommendations, admin Policy) live in ONE
 *   "More" menu; the header itself keeps Back and the AI Assistant.
 * - No raw campaign UUID on screen.
 * - Health / Pressure / Momentum / Drift are shown once (the coloured badges), not again
 *   as plain text in the Execution Intelligence box.
 */
import * as fs from 'fs';
import * as path from 'path';

const C = fs.readFileSync(path.join(process.cwd(), 'components/CampaignDetailsContent.tsx'), 'utf8');
const menu = (() => {
  const a = C.indexOf('<details className="relative" data-testid="campaign-more-menu">');
  const b = C.indexOf('</details>', a);
  return a >= 0 && b > a ? C.slice(a, b) : '';
})();

describe('campaign details header (D9a)', () => {
  it('Health, Expert Recommendations and admin Policy are inside the More menu', () => {
    expect(menu).not.toBe('');
    expect(menu).toContain('router.push(`/campaign-health/${campaign.id}`)');
    expect(menu).toContain('router.push(`/campaigns/${campaign.id}/recommendations`)');
    expect(menu).toMatch(/\{isAdmin && \(\s*<button\s*onClick=\{\(\) => router\.push\(`\/recommendations\/policy\?campaignId=\$\{campaign\.id\}`\)\}/);
  });
  it('each of those destinations appears exactly once on the page', () => {
    expect(C.split('router.push(`/campaign-health/${campaign.id}`)').length - 1).toBe(1);
    expect(C.split('router.push(`/campaigns/${campaign.id}/recommendations`)').length - 1).toBe(1);
  });
  it('no raw UUID', () => {
    expect(C).not.toMatch(/ID: \{campaign\.id\}/);
  });
  it('each execution metric is rendered once (the badge), not repeated in the box', () => {
    expect(C.split('Health: {executionHealth.score ?? 0}%').length - 1).toBe(1);
    expect(C.split('Pressure: {executionPressure.pressureLevel}').length - 1).toBe(1);
    expect(C.split('Momentum: {executionMomentum.state}').length - 1).toBe(1);
    expect(C).not.toMatch(/Drift: \{executionDrift\.state\}/);
  });
});

describe('campaign details overview (D9b)', () => {
  const W = fs.readFileSync(path.join(process.cwd(), 'components/CampaignWeeklySection.tsx'), 'utf8');
  it('the blueprint counts are one compact line (no 4 large tiles)', () => {
    expect(C).toContain('data-testid="blueprint-counts"');
    expect(C).not.toContain('>Total Weeks<');
  });
  it('no scroll-jump links between the blueprint and the weeks', () => {
    expect(C).not.toContain('Jump to Weekly Content');
    expect(W).not.toContain('Back to Content Blueprint');
  });
  it('the copy points to the AI Assistant where it is (top right), never "below"/"purple"/"pre-planning above"', () => {
    expect(C).not.toMatch(/AI Assistant<\/strong> below|purple button above|pre-planning above/);
    expect(C.split('(top right)').length - 1).toBe(2);
  });
});

describe('campaign details copy (e9 rulings)', () => {
  it('"Virality check" (not "Virality Review") and a "Settings" tab (not "Governance")', () => {
    expect(C).toContain('<h2 className="text-xl font-semibold">Virality check</h2>');
    expect(C).not.toMatch(/>Virality Review</);
    expect(C).toMatch(/onClick=\{\(\) => setActiveTab\('governance'\)\}[\s\S]{0,400}?\n\s*Settings\n/);
  });
});
