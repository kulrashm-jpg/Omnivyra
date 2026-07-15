/**
 * Wave 5 — frontend delivery contracts (source-level, repo pattern).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('W5-1 package import optimization', () => {
  test('optimizePackageImports pins the audited heavy packages', () => {
    const cfg = read('next.config.js');
    for (const pkg of ['recharts', 'react-markdown', '@tiptap/react', 'lucide-react', 'date-fns']) {
      expect(cfg).toContain(`'${pkg}'`);
    }
    expect(cfg).toContain('optimizePackageImports');
  });
});

describe('W5-2 dynamic loading', () => {
  test('tiptap is behind next/dynamic at all three audited consumers', () => {
    expect(read('components/RichTextEditorLazy.tsx')).toContain("dynamic(() => import('./RichTextEditor')");
    expect(read('pages/activity-workspace/ActivityWorkspacePlatformCard.tsx')).toContain('RichTextEditorLazy');
    expect(read('components/activity-workspace/WorkspacePlatformCard.tsx')).toContain('RichTextEditorLazy');
    expect(read('pages/admin/blog/content-editor.tsx')).toMatch(/dynamic\(\s*\n?\s*\(\) => import\('\.\.\/\.\.\/\.\.\/components\/blog\/RichTextEditor'\)/);
  });
  test('recharts consumers deferred: analytics page + the last static report section', () => {
    expect(read('pages/analytics.tsx')).toMatch(/dynamic\(\s*\n?\s*\(\) => import\('\.\.\/components\/analytics\/SystemStateDashboard'\)/);
    const report = read('components/reports/view/ReportPageContent.tsx');
    expect(report).toMatch(/CanonicalReportSections = dynamic\(/);
    expect(report).not.toMatch(/^import CanonicalReportSections from/m);
  });
  test('every dynamic fallback preserves layout and announces busy state', () => {
    for (const rel of ['components/RichTextEditorLazy.tsx', 'pages/analytics.tsx', 'components/reports/view/ReportPageContent.tsx']) {
      expect(read(rel)).toContain('aria-busy="true"');
      expect(read(rel)).toMatch(/min-h-\[\d+px\]/);
    }
  });
});

describe('W5-3 images / W5-4 fonts', () => {
  test('logo renders via next/image with intrinsic dimensions at all four sites', () => {
    for (const rel of ['components/landing/Footer.tsx', 'components/landing/LandingNavbar.tsx',
      'components/landing/MarketingLandingPageSections.tsx', 'components/layout/GlobalHeaderMain.tsx']) {
      const src = read(rel);
      expect(src).toContain('<Image src="/logo.png" alt="Omnivyra" width={898} height={278}');
      expect(src).not.toContain('<img src="/logo.png"');
    }
    // Above-the-fold sites use priority (no lazy flash for the header/navbar).
    expect(read('components/layout/GlobalHeaderMain.tsx')).toMatch(/logo\.png[^>]*priority/);
  });
  test('render-blocking Google Fonts @import removed; next/font variables exposed; consumers migrated', () => {
    expect(read('styles/globals.css')).not.toContain('fonts.googleapis.com');
    const app = read('pages/_app.tsx');
    expect(app).toContain("from 'next/font/google'");
    expect(app).toContain("weight: ['400', '500', '600', '700', '800']"); // Inter parity with the removed @import
    expect(app).toContain('--font-inter');
    expect(app).toContain('--font-poppins');
    // No orphaned literal font-family references remain on the migrated surfaces.
    for (const rel of ['components/landing/HeroSection.tsx', 'components/landing/MarketingLandingPageMain.tsx', 'pages/about.tsx']) {
      expect(read(rel)).not.toMatch(/fontFamily: "'(Poppins|Inter)'/);
    }
  });
});

describe('W5-5 virtualization (evidence-gated)', () => {
  test('primitive exists with a small-collection threshold guard', () => {
    const src = read('lib/client/virtualList.ts');
    expect(src).toContain('threshold');
    expect(src).toContain('count > threshold');
  });
});

describe('W5-6 polling', () => {
  test('all audited polls are visibility-gated', () => {
    expect(read('pages/settings/security.tsx')).toContain('useVisibilityPolling(');
    expect(read('pages/super-admin/enterprise-governance.tsx')).toContain('useVisibilityPolling(');
    for (const rel of ['pages/super-admin.tsx', 'components/super-admin/RedisEfficiencyPanelMain.tsx', 'components/dashboard/ReportAutomationActivityFeed.tsx']) {
      expect(read(rel)).toContain("document.visibilityState === 'visible'");
    }
    // No unconditional setInterval polls remain at the audited sites.
    expect(read('pages/settings/security.tsx')).not.toMatch(/setInterval\(\(\) => \{ void reloadAuthState/);
  });
});

describe('W5-7 rendering', () => {
  test('calendar transform skips singleton rewrites and commits via startTransition', () => {
    const src = read('components/hooks/useDashboardState.tsx');
    expect(src).toContain('if (indices.length === 1) continue;');
    expect(src).toContain('startTransition(() => setCalendarActivityEvents(byDate));');
  });
});

describe('W5-8 bundle budget', () => {
  test('gate script tracks the audited heavy routes with ratchet semantics', () => {
    const src = read('scripts/check-bundle-budget.js');
    for (const route of ['/_app', '/activity-workspace', '/analytics', '/dashboard']) {
      expect(src).toContain(`'${route}'`);
    }
    expect(src).toContain('BUNDLE_BUDGET_STRICT');
    expect(src).toContain('BUNDLE_BUDGET_WRITE_BASELINE');
  });
});
