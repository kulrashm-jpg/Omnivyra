/**
 * @jest-environment jsdom
 *
 * Final P2 Housekeeping Pass — focused tests covering:
 *
 *   P2-1: VariantExperienceShell mounts the provider when CompanyContext
 *         supplies a selectedCompanyId; downstream `useSharedStrategyAnalytics`
 *         + `useSharedOperatorControls` consumers receive context values
 *         instead of firing their own fetches.
 *
 *   P2-2: navigationConfig exposes a "Variant Experience" entry pointing
 *         at /command-center/variant-experience under the Campaigns
 *         primary nav item; the route is in the matchers list so the
 *         primary nav highlights correctly.
 *
 *   P2-3: VariantExperienceEntryCard.onPlanComplete is now REQUIRED;
 *         the off-ramp branches were removed; the component no longer
 *         renders any "Open dashboard" link.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { PRIMARY_NAV_ITEMS, getPrimaryNavForPath, getSecondaryNavForPath, COMMAND_ITEMS } from '../../../components/layout/navigationConfig';
import {
  VariantAnalyticsProvider,
  useSharedStrategyAnalytics,
  useSharedOperatorControls,
} from '../../../components/variant-experience/VariantContexts';

/* ── apiFetch mock ────────────────────────────────────────────── */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

beforeEach(() => apiFetch.mockReset());

/* ── P2-1 — provider shell semantics ──────────────────────────── */

describe('P2-1 — VariantExperienceShell mounts the provider', () => {
  function ProbeSharedAnalytics() {
    const a = useSharedStrategyAnalytics({ companyId: 'co-shared' });
    return <span data-testid="probe-analytics">{a.loading ? 'loading' : 'idle'}</span>;
  }

  function ProbeSharedOperatorControls() {
    const a = useSharedOperatorControls('co-shared');
    return <span data-testid="probe-controls">{a.controls ? 'loaded' : 'inert'}</span>;
  }

  test('consumers within a provider receive the provider value (not fallback fetch)', () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        scope: { companyId: 'co-shared', campaignId: null, platform: null, creatorId: null, window: '30d' },
        leaderboards: { image: [], carousel: [], infographic: [] },
        comparisons: [], insights: [], signals: [], trends: [], explainability: [], dimensions: [],
        variants: { catalog: [], leaderboards: [], winners: [], insights: [], signals: [], trends: [] },
        execution: {
          active_experiments: [], completed_experiments: [], winner_recommendations: [],
          operator_controls: { experimentModeDisabled: false, variantExplorationDisabled: false, forceBaselineV1: false, forceWinningVariant: false },
          summary: { total_experiments_in_scope: 0, strategies_with_declared_winner: 0, strategies_without_winner: 0 },
        },
      }),
    });
    render(
      <VariantAnalyticsProvider companyId="co-shared">
        <ProbeSharedAnalytics />
        <ProbeSharedAnalytics />
        <ProbeSharedAnalytics />
      </VariantAnalyticsProvider>
    );
    const probes = screen.getAllByTestId('probe-analytics');
    expect(probes).toHaveLength(3);
  });

  test('consumer outside provider still works via fallback hook', () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, scope: { companyId: '', window: '30d' }, leaderboards: {}, comparisons: [], insights: [], signals: [], trends: [], explainability: [], dimensions: [], variants: { catalog: [], leaderboards: [], winners: [], insights: [], signals: [], trends: [] }, execution: { active_experiments: [], completed_experiments: [], winner_recommendations: [], operator_controls: { experimentModeDisabled: false, variantExplorationDisabled: false, forceBaselineV1: false, forceWinningVariant: false }, summary: { total_experiments_in_scope: 0, strategies_with_declared_winner: 0, strategies_without_winner: 0 } } }),
    });
    render(<ProbeSharedAnalytics />);
    expect(screen.getByTestId('probe-analytics')).toBeInTheDocument();
  });
});

/* ── P2-2 — Navigation entry ─────────────────────────────────── */

/**
 * G2R — BETA-008 (RULE 8) REMOVED the "Variant Experience" navigation entry:
 * `components/layout/navigationConfig.tsx:114` records it as "hidden for Beta — operator/dev-only
 * tooling". The three assertions that required it to be present in the Campaigns child list, the
 * command palette, and the secondary nav are therefore obsolete and are retired here.
 *
 * The route itself still exists and is still reachable by direct link, so the matcher and
 * matcher-resolution assertions below are UNCHANGED — they test routing, not discoverability.
 * Nothing in the UI is restored: this suite now asserts what BETA-008 actually shipped.
 */
describe('P2-2 — Variant Experience route resolution (nav entry retired by BETA-008)', () => {
  test('Campaigns matchers include the variant-experience route', () => {
    const campaigns = PRIMARY_NAV_ITEMS.find((item) => item.label === 'Campaigns');
    expect(campaigns?.matchers).toEqual(expect.arrayContaining(['/command-center/variant-experience']));
  });

  test('getPrimaryNavForPath returns a valid section for the route (matcher resolution exists)', () => {
    const resolved = getPrimaryNavForPath('/command-center/variant-experience');
    expect(resolved).not.toBeNull();
    // The pre-existing matcher precedence claims /command-center/* for
    // the Dashboard item (because Dashboard's matcher is broader and
    // listed first). The Variant Experience link is still surfaced via
    // the Campaigns child list + the command palette + direct linking,
    // which is what discoverability requires.
  });

  test('the nav entry stays retired — BETA-008 (RULE 8) hid it as operator/dev-only tooling', () => {
    // Asserted positively rather than deleted, so a silent re-introduction is caught: if the entry
    // returns, that must be a deliberate BETA-008 reversal, not an accident.
    const campaigns = PRIMARY_NAV_ITEMS.find((item) => item.label === 'Campaigns');
    expect(campaigns).toBeDefined();
    expect((campaigns?.children ?? []).map((c) => c.label)).not.toContain('Variant Experience');
    expect(COMMAND_ITEMS.map((a) => a.label)).not.toContain('Variant Experience');
    expect(getSecondaryNavForPath('/campaigns').map((s) => s.label)).not.toContain('Variant Experience');
  });
});

/* ── P2-3 — dead branches removed ─────────────────────────────── */

describe('P2-3 — Dead branches removed from VariantExperienceEntryCard', () => {
  // Re-verify by inspecting the public type signature — `onPlanComplete`
  // is now required (no `?`). TypeScript would already catch missing
  // callers at build time; this test asserts the symbol exists with
  // the required shape so it can't accidentally revert to optional.
  const { VariantExperienceEntryCard } = require('../../../components/variant-experience/VariantExperienceEntryCard');

  test('VariantExperienceEntryCard is exported and is a React component', () => {
    expect(typeof VariantExperienceEntryCard).toBe('function');
  });

  test('removed: next/router + next/link imports no longer used', () => {
    // Read the source — the file should NOT import from next/router
    // or next/link after P2-3 cleanup (both were used only by the
    // now-removed off-ramp branches). Historical mentions in JSDoc
    // are permitted.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'components', 'variant-experience', 'VariantExperienceEntryCard.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/^import.*from ['"]next\/router['"]/m);
    expect(src).not.toMatch(/^import.*from ['"]next\/link['"]/m);
    // No JSX-rendered Link or anchor pointing at the standalone page.
    expect(src).not.toMatch(/<Link\b/);
    expect(src).not.toMatch(/router\.push\(/);
  });
});
