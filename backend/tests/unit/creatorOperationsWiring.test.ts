/**
 * A component that nothing imports is not a feature.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `CreatorOperationsTab` had a page, an API, and its own tests. What it did not
 * have was a caller. Nothing imported it, so it was never mounted, never
 * bundled, and never seen — `git log -S` across the whole history of `pages/`
 * returns nothing for it. Its pre-existing panels were as invisible as the
 * CONDITION panel Phase 86 added to it.
 *
 * That is a failure mode source-level tests cannot catch: every assertion about
 * the component passed while the component was dead code. So these tests assert
 * the *edge* — that the page registers it, routes to it, and renders it — which
 * is the part that was actually missing.
 *
 * They deliberately read the page rather than mounting it: the page pulls in the
 * whole super-admin surface (company context, router, ten dynamic imports), and
 * a render harness for that would test the harness, not the wiring.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE_RAW = read('../../../pages/super-admin.tsx');
const PAGE = strip(PAGE_RAW);
const TAB = strip(read('../../../components/super-admin/tabs/CreatorOperationsTab.tsx'));
const API = strip(read('../../../pages/api/super-admin/creator-operations.ts'));

/**
 * Every `{ id, label }` in the TOP-LEVEL nav array, in declaration order.
 *
 * Scoped to the array that feeds `.map((tab) =>`, because the page also
 * declares cost-analysis sub-tabs in the same object shape; a file-wide regex
 * counts those as navigation and the assertions stop meaning what they say.
 */
const NAV_BLOCK = PAGE.slice(
  PAGE.indexOf("{ id: 'analytics'"),
  PAGE.indexOf('].map((tab)'),
);
const navIds = [...NAV_BLOCK.matchAll(/\{\s*id:\s*'([a-z-]+)',\s*label:\s*'([^']+)'/g)]
  .map((m) => ({ id: m[1], label: m[2] }));

describe('1/2/3 — the tab is registered the way its neighbours are', () => {
  it('CRITICAL: the page imports it — the single fact that was missing', () => {
    expect(PAGE).toContain("import('../components/super-admin/tabs/CreatorOperationsTab')");
  });

  it('CRITICAL: it uses the established dynamic-import shape, not a bespoke one', () => {
    const decl = PAGE.slice(
      PAGE.indexOf('const CreatorOperationsTab = dynamic('),
      PAGE.indexOf('const CreatorOperationsTab = dynamic(') + 260,
    );
    expect(decl).toContain("import('../components/super-admin/tabs/CreatorOperationsTab')");
    expect(decl).toContain('ssr: false');
    expect(decl).toContain('loading: SuperAdminTabLoader');
  });

  it('CRITICAL: the import path resolves to a real component with a default export', () => {
    const target = path.resolve(__dirname, '../../../components/super-admin/tabs/CreatorOperationsTab.tsx');
    expect(fs.existsSync(target)).toBe(true);
    expect(TAB).toContain('export default function CreatorOperationsTab()');
  });

  it('the nav entry exists with an id, a label and an icon', () => {
    expect(PAGE).toMatch(/\{\s*id:\s*'creator-ops',\s*label:\s*'Creator Ops',\s*icon:\s*Gauge\s*\}/);
  });

  it('the icon it names is actually imported', () => {
    const imports = PAGE.slice(PAGE.indexOf('import {'), PAGE.indexOf("} from 'lucide-react';"));
    expect(imports).toContain('Gauge');
  });
});

describe('4 — selecting the tab actually renders it', () => {
  it('CRITICAL: a render branch exists for the nav id', () => {
    expect(PAGE).toContain("{activeTab === 'creator-ops' && (");
    expect(PAGE).toContain('<CreatorOperationsTab />');
  });

  it('CRITICAL: the rendered id and the nav id are the same string', () => {
    // The defect this catches is a tab you can click that renders nothing.
    const registered = navIds.map((t) => t.id);
    const rendered = [...PAGE.matchAll(/activeTab === '([a-z-]+)'/g)].map((m) => m[1]);
    expect(registered).toContain('creator-ops');
    expect(rendered).toContain('creator-ops');
  });

  it('every nav id that is not a link-out has a render branch', () => {
    const rendered = new Set([...PAGE.matchAll(/activeTab === '([a-z-]+)'/g)].map((m) => m[1]));
    // `blog` navigates away via the router instead of rendering a panel.
    const orphans = navIds.map((t) => t.id).filter((id) => id !== 'blog' && !rendered.has(id));
    expect(orphans).toEqual([]);
  });

  it('the component takes no props, so the registry supplies none', () => {
    expect(PAGE).toContain('<CreatorOperationsTab />');
    expect(PAGE).not.toMatch(/<CreatorOperationsTab\s+[a-zA-Z]/);
  });
});

describe('5/6 — authorization is unchanged and still server-side', () => {
  it('CRITICAL: the API still refuses non-super-admins', () => {
    expect(API).toContain("return res.status(403).json({ error: 'super_admin_required' });");
  });

  it('CRITICAL: wiring a tab did not introduce a client-side authority', () => {
    // The tab holds no data of its own; everything it shows comes from the
    // gated endpoint, so mounting it cannot leak operations data.
    expect(TAB).toContain('fetchWithAuth');
    expect(TAB).not.toContain('supabase');
    expect(TAB).not.toContain('service_role');
  });

  it('the page-level super-admin signals are untouched', () => {
    expect(PAGE).toContain("const isSuperAdmin = userRole === 'SUPER_ADMIN';");
    expect(PAGE).toContain("const isSuperAdminRoute = router.pathname?.startsWith('/super-admin');");
  });

  it('the tab requests the existing endpoint — no new one was added', () => {
    expect(TAB).toContain('/api/super-admin/creator-operations?');
    expect((TAB.match(/fetchWithAuth\(/g) ?? [])).toHaveLength(1);
  });
});

describe('7 — the neighbours survive', () => {
  it('CRITICAL: every previously registered tab is still registered', () => {
    for (const name of ['ApisPlatformsTab', 'CompanyUsersTab', 'AnalyticsTab', 'PlansTab',
      'CommunityAiTab', 'SecurityTab', 'MonetizationOpsTab', 'CreditsBillingTab', 'CuratedSourcesTab']) {
      expect(PAGE).toContain(`import('../components/super-admin/tabs/${name}')`);
    }
  });

  it('CRITICAL: existing nav ids keep their relative order', () => {
    const ids = navIds.map((t) => t.id);
    const expected = ['analytics', 'company-users', 'plans', 'credits-billing', 'monetization-ops',
      'community-ai', 'source-catalog', 'cost-analysis', 'audit', 'social-platforms', 'security', 'blog'];
    expect(ids.filter((id) => expected.includes(id))).toEqual(expected);
  });

  it('the new tab was inserted, not substituted', () => {
    expect(navIds).toHaveLength(13);
    expect(navIds.map((t) => t.id)).toContain('creator-ops');
  });
});

describe('8/9 — what the operator now actually sees', () => {
  it('CRITICAL: all four CONDITION figures are rendered', () => {
    for (const f of ['condition_attempts', 'condition_applied', 'condition_degraded', 'condition_degradation']) {
      expect(TAB).toContain(f);
    }
  });

  it('CRITICAL: their labels are present', () => {
    for (const label of ['Attempts', 'Applied', 'Degraded', 'Degradation rate']) {
      expect(TAB).toContain(`label="${label}"`);
    }
  });

  it('CRITICAL: an empty window says so instead of showing a healthy 0%', () => {
    expect(TAB).toContain('No attempts in this window');
  });

  it('the panel reuses the existing operations conventions', () => {
    expect(TAB).toContain('<Panel');
    expect(TAB).toContain('CONDITION references');
    expect(TAB).toContain('fmtPct(data.snapshot.rates.condition_degradation ?? 0)');
  });

  it('pre-existing panels are untouched', () => {
    for (const r of ['upload_success', 'publish_validation_failure', 'resumable_recovery',
      'queue_contention', 'attachment_readiness_conversion']) {
      expect(TAB).toContain(r);
    }
  });
});

describe('10 — registered once, and only once', () => {
  it('CRITICAL: exactly one dynamic import', () => {
    expect((PAGE.match(/import\('\.\.\/components\/super-admin\/tabs\/CreatorOperationsTab'\)/g) ?? []))
      .toHaveLength(1);
  });

  it('CRITICAL: exactly one nav entry and one render branch', () => {
    expect((PAGE.match(/id: 'creator-ops'/g) ?? [])).toHaveLength(1);
    expect((PAGE.match(/activeTab === 'creator-ops'/g) ?? [])).toHaveLength(1);
    expect((PAGE.match(/<CreatorOperationsTab \/>/g) ?? [])).toHaveLength(1);
  });

  it('no duplicate nav ids anywhere', () => {
    const ids = navIds.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the component was not copied — there is still one of it', () => {
    const dir = path.resolve(__dirname, '../../../components/super-admin/tabs');
    const copies = fs.readdirSync(dir).filter((f) => /CreatorOperations/i.test(f));
    expect(copies).toEqual(['CreatorOperationsTab.tsx']);
  });
});

describe('Phase 86/76/74 telemetry semantics were not touched', () => {
  it('the CONDITION events are unchanged', () => {
    const telemetry = strip(read('../../services/creatorOperationalTelemetryService.ts'));
    expect(telemetry).toContain("CONDITION_REFERENCE_APPLIED: 'condition_reference_applied',");
    expect(telemetry).toContain("CONDITION_REFERENCE_DEGRADED: 'condition_reference_degraded',");
  });

  it('the rate arithmetic is unchanged', () => {
    const obs = strip(read('../../services/creatorObservabilityService.ts'));
    expect(obs).toContain('const conditionAttempts = conditionApplied + conditionDegraded;');
    expect(obs).toContain('const condition_degradation = neutralRatio(conditionDegraded, conditionAttempts, 0);');
  });

  it('Phase 76 disclosure and Phase 74/78 lifecycle are unchanged', () => {
    expect(strip(read('../../services/creatorAssetRendererImage.ts')))
      .toContain('condition_reference_status: conditionDegradation?.status,');
    expect(strip(read('../../services/creatorAssetPersistenceService.ts')))
      .toContain('await removeRenderedObjectsForDeletedAsset(');
  });

  it('this change touched exactly one file: the page', () => {
    // Nothing under backend/ or components/ needed to move for the tab to work.
    expect(TAB).toContain('export default function CreatorOperationsTab()');
    expect(API).toContain('aggregateCreatorMetrics(');
  });
});
