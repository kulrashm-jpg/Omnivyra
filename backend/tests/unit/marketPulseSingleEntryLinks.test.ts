/**
 * Owner ruling (d), 2026-11-13: Market Pulse has ONE customer entry, /market-pulse.
 * The V2 scan console (dashboard intelligence workspace, `intelTab=market-pulse`) is
 * admin-only since 55's gate (MARKET_PULSE_ADMIN_REQUIRED), and admins reach it from
 * the Executive room's "Configure / run scan". Customer UI must not link into it.
 * `/dashboard?tab=intelligence` isn't a dashboard tab at all (it fell back to the
 * overview), so those links are wrong too.
 *
 * Deliberate, documented exceptions:
 *  (components/layout/GlobalHeaderNav.tsx's Market Pulse link was relinked by e9's narrow
 *   exception, a one-line hunk; its other items stay deferred to the PI landing.)
 *  - components/Header.tsx: dead code (rendered nowhere), removed after e1's CA branch.
 *  - pages/market-pulse.tsx: the admin-only "Configure / run scan" link, by design.
 *  - pages/dashboard/intelligence.tsx and components/dashboard/IntelligenceWorkspace.tsx:
 *    the console itself.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOTS = ['components', 'pages', 'hooks', 'lib'];
const EXCEPTIONS = new Set([
  'components/Header.tsx',
  'pages/market-pulse.tsx',
  'pages/dashboard/intelligence.tsx',
  'components/dashboard/IntelligenceWorkspace.tsx',
]);
const CONSOLE_LINK = /intelTab=market-pulse|intelTab=\$\{|dashboard\?tab=intelligence/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'api') continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('Market Pulse single customer entry', () => {
  const files = ROOTS.flatMap((r) => walk(path.join(process.cwd(), r))).map((f) =>
    path.relative(process.cwd(), f).split(path.sep).join('/'),
  );

  it('scans a real file set (positive control)', () => {
    expect(files).toContain('components/dashboard/OpportunityPanel.tsx');
    expect(files).toContain('pages/command-center/engagement.tsx');
    expect(files.length).toBeGreaterThan(500);
  });

  it('no customer-facing UI links into the admin-only V2 console', () => {
    const offenders = files
      .filter((f) => !EXCEPTIONS.has(f))
      .filter((f) => CONSOLE_LINK.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it.each([
    'components/dashboard/OpportunityPanel.tsx',
    'components/dashboard/TrendSignalsPanel.tsx',
    'components/dashboard/IntelligenceTimeline.tsx',
    'components/recommendations/tabs/TrendCampaignsHistoryDrawer.tsx',
    'components/dashboard/DashboardOverviewSection.tsx',
    'pages/command-center/engagement.tsx',
    'components/layout/GlobalHeaderNav.tsx',
  ])('%s links to /market-pulse', (f) => {
    expect(fs.readFileSync(path.join(process.cwd(), f), 'utf8')).toMatch(/['`]\/market-pulse['`]/);
  });
});
