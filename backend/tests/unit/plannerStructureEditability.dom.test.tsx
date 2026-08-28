/**
 * @jest-environment jsdom
 *
 * CP-STRUCT-003 — the existing campaign's structure must be revisable in place.
 *
 * DIAGNOSIS THIS PINS: the transition back to Structure was never missing.
 * `navigateTab('skeleton')` always worked, the tab was never disabled, and the
 * configuration controls always rendered. What was missing was any SIGN of it
 * from Strategy — the only route back was a tab labelled "Skeleton", which
 * reads as a different thing from "the campaign's structure" — and the
 * invalidation that follows an edit happened silently, so revising looked like
 * lost work and therefore like a reason to start a new campaign.
 *
 * So these tests cover two things:
 *   1. the REAL store semantics of a revise cycle (same draft, correct
 *      invalidation, accept + confirm still work), driven through
 *      PlannerSessionProvider itself; and
 *   2. a source gate over the REAL production call sites, so the affordance,
 *      the label and the consequence notice cannot silently regress.
 */

import React, { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PlannerSessionProvider, usePlannerSession } from '../../../components/planner/plannerSessionStore';
import { weeksToCalendarPlan } from '../../../components/planner/calendarPlanConverter';

jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const MATRIX_LI_1 = { linkedin: { post: 1 } };
const MATRIX_LI_2 = { linkedin: { post: 2 } };
const MATRIX_LI_X = { linkedin: { post: 1 }, x: { post: 1 } };

const weeks = (items: Array<{ id: string; day: string; platform: string; content_type: string }>) => [
  {
    week: 1,
    theme: 'Kickoff',
    phase_label: 'Awareness',
    daily_execution_items: items.map((i) => ({
      execution_id: i.id, day: i.day, platform: i.platform, content_type: i.content_type, topic: 'T',
    })),
  },
];

const WEEKS_1 = weeks([{ id: 'w1-a', day: 'Monday', platform: 'linkedin', content_type: 'post' }]);
const WEEKS_2 = weeks([
  { id: 'w1-a', day: 'Monday', platform: 'linkedin', content_type: 'post' },
  { id: 'w1-b', day: 'Wednesday', platform: 'linkedin', content_type: 'post' },
]);
const WEEKS_LI_X = weeks([
  { id: 'w1-a', day: 'Monday', platform: 'linkedin', content_type: 'post' },
  { id: 'w1-c', day: 'Thursday', platform: 'x', content_type: 'post' },
]);

type Store = ReturnType<typeof usePlannerSession>;
let store: Store;

function Probe() {
  const s = usePlannerSession();
  const ref = useRef<Store>(s);
  ref.current = s;
  store = s;
  useEffect(() => { store = ref.current; });
  return null;
}

const mount = () => render(<PlannerSessionProvider><Probe /></PlannerSessionProvider>);

/** The production accept path, in its post-CP-STRUCT-002 order. */
function accept(w: unknown[], matrix: Record<string, Record<string, number>>) {
  const { campaign_structure, calendar_plan } = weeksToCalendarPlan(w);
  act(() => {
    if (Object.keys(matrix).length > 0) store.setPlatformContentRequests(matrix);
    store.setCampaignStructure(campaign_structure);
    store.setCalendarPlan(calendar_plan);
  });
}

const activities = () => store.state.calendar_plan?.activities ?? [];
const draftId = () => store.state.source_ids?.campaign_id ?? null;

/** Reach a confirmed campaign sitting in Strategy — the CP-STRUCT-003 entry state. */
function reachStrategy() {
  act(() => { store.setSourceIds({ campaign_id: 'camp-existing' }); });
  act(() => { store.setStrategyContext({ duration_weeks: 1, planned_start_date: '2026-09-01' }); });
  accept(WEEKS_1, MATRIX_LI_1);
  act(() => { store.confirmSkeleton(); });
  act(() => { store.setStrategicCard({ core: { topic: 'Close in days' } } as never); });
  act(() => { store.confirmStrategy(); });
}

beforeEach(() => { mount(); });

/* ────────────────────────────────────────────────────────────────────────
 * Revise cycle — real store
 * ──────────────────────────────────────────────────────────────────────── */

describe('an existing campaign can be revised in place', () => {
  it('reaches Strategy with a confirmed skeleton and a strategic card', () => {
    reachStrategy();
    expect(draftId()).toBe('camp-existing');
    expect(store.state.skeleton_confirmed).toBe(true);
    expect(store.state.strategy_confirmed).toBe(true);
    expect(activities()).toHaveLength(1);
  });

  it('3. the SAME draft identity is retained through a full revise cycle', () => {
    reachStrategy();
    const before = draftId();

    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    accept(WEEKS_2, MATRIX_LI_2);
    act(() => { store.confirmSkeleton(); });

    expect(draftId()).toBe(before);
    expect(draftId()).toBe('camp-existing');
  });

  it('4. the existing configuration is still available to edit', () => {
    reachStrategy();
    // Duration and the matrix are the two inputs the Structure controls read.
    expect(store.state.strategy_context?.duration_weeks).toBe(1);
    expect(store.state.platform_content_requests).toEqual(MATRIX_LI_1);
  });

  it('5. duration can be changed', () => {
    reachStrategy();
    act(() => { store.setStrategyContext({ duration_weeks: 3 }); });
    expect(store.state.strategy_context?.duration_weeks).toBe(3);
  });

  it('6. a platform can be added, and removed again', () => {
    reachStrategy();
    act(() => { store.setPlatformContentRequests(MATRIX_LI_X); });
    accept(WEEKS_LI_X, MATRIX_LI_X);
    expect(Object.keys(store.state.platform_content_requests ?? {}).sort()).toEqual(['linkedin', 'x']);
    expect(activities().map((a) => a.platform).sort()).toEqual(['linkedin', 'x']);

    act(() => { store.setPlatformContentRequests(MATRIX_LI_1); });
    accept(WEEKS_1, MATRIX_LI_1);
    expect(Object.keys(store.state.platform_content_requests ?? {})).toEqual(['linkedin']);
    expect(activities()).toHaveLength(1);
  });

  it('7. content-type frequency can be changed, and the skeleton follows', () => {
    reachStrategy();
    expect(activities()).toHaveLength(1);
    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    accept(WEEKS_2, MATRIX_LI_2);
    expect(store.state.platform_content_requests).toEqual(MATRIX_LI_2);
    expect(activities()).toHaveLength(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Invalidation — unchanged, and that is the point
 * ──────────────────────────────────────────────────────────────────────── */

describe('the existing invalidation semantics are preserved exactly', () => {
  it('8. changing the matrix invalidates the skeleton', () => {
    reachStrategy();
    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    expect(store.state.calendar_plan).toBeNull();
    expect(store.state.campaign_structure).toBeNull();
    expect(store.state.skeleton_confirmed).toBe(false);
  });

  it('9. changing duration invalidates the strategic card and its confirmation', () => {
    reachStrategy();
    expect(store.state.strategic_card).not.toBeNull();
    act(() => { store.setStrategyContext({ duration_weeks: 4 }); });
    expect(store.state.strategic_card).toBeNull();
    expect(store.state.strategy_confirmed).toBe(false);
  });

  it('invalidation does NOT touch the draft identity or assignments', () => {
    reachStrategy();
    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    act(() => { store.setStrategyContext({ duration_weeks: 4 }); });
    expect(draftId()).toBe('camp-existing');
    expect(store.state.assignments).toEqual([]);   // untouched, not deleted
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Accept / confirm still work after a revision (CP-STRUCT-002 held)
 * ──────────────────────────────────────────────────────────────────────── */

describe('accept and confirm still work on the revised structure', () => {
  it('12. accepting the revised proposal persists the REVISED structure', () => {
    reachStrategy();
    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    accept(WEEKS_2, MATRIX_LI_2);
    expect(store.state.calendar_plan).not.toBeNull();
    expect(activities()).toHaveLength(2);
    expect(activities().map((a) => a.execution_id).sort()).toEqual(['w1-a', 'w1-b']);
  });

  it('13. confirming the revised skeleton re-advances', () => {
    reachStrategy();
    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    accept(WEEKS_2, MATRIX_LI_2);
    expect(store.state.skeleton_confirmed).toBe(false);   // revision un-confirmed it
    act(() => { store.confirmSkeleton(); });
    expect(store.state.skeleton_confirmed).toBe(true);    // ⇒ parent effect advances
  });

  it('14. CP-STRUCT-002 still holds — accept does not erase its own write', () => {
    reachStrategy();
    act(() => { store.setPlatformContentRequests(MATRIX_LI_2); });
    accept(WEEKS_2, MATRIX_LI_2);
    // The matrix write precedes the plan write, so the plan survives.
    expect(store.state.calendar_plan).not.toBeNull();
    expect(store.state.campaign_structure).not.toBeNull();
  });

  it('11. no revise cycle ever mints a second campaign id', () => {
    reachStrategy();
    for (const [w, m] of [[WEEKS_2, MATRIX_LI_2], [WEEKS_LI_X, MATRIX_LI_X], [WEEKS_1, MATRIX_LI_1]] as const) {
      act(() => { store.setPlatformContentRequests(m as never); });
      accept(w as never, m as never);
      act(() => { store.confirmSkeleton(); });
      expect(draftId()).toBe('camp-existing');
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * SOURCE GATE — the real production call sites
 * ──────────────────────────────────────────────────────────────────────── */

describe('SOURCE GATE — the Structure affordance in production code', () => {
  const ROOT = join(__dirname, '../../..');
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  const page = strip(readFileSync(join(ROOT, 'pages/campaign-planner.tsx'), 'utf8'));
  const panel = strip(readFileSync(join(ROOT, 'components/planner/SkeletonBuilderPanel.tsx'), 'utf8'));

  /** The rendered block containing the Edit Structure control. */
  const editStructureBlock = () => {
    const at = page.indexOf('Edit Structure');
    expect(at).toBeGreaterThan(-1);
    return page.slice(Math.max(0, at - 1200), at + 200);
  };

  it('1. the Strategy stage exposes an "Edit Structure" action', () => {
    // It lives inside the strategy branch: after it, and before the content one.
    const strategyAt = page.indexOf("{activeTab === 'strategy' && (");
    const contentAt = page.indexOf("{activeTab === 'content' && (");
    const editAt = page.indexOf('Edit Structure');
    expect(strategyAt).toBeGreaterThan(-1);
    expect(editAt).toBeGreaterThan(strategyAt);
    expect(editAt).toBeLessThan(contentAt);
  });

  it('2. it uses the EXISTING transition — no new route, no new campaign', () => {
    const block = editStructureBlock();
    expect(block).toContain("navigateTab('skeleton')");
    // Never a router push, and never a campaign-creating call.
    expect(block).not.toMatch(/router\.push/);
    expect(block).not.toMatch(/planner-draft|createOrResumePlannerDraft|planner-finalize/);
  });

  it('the user-facing stage reads "Structure", not "Skeleton"', () => {
    // The tab label sits directly before the tab button's closing tag.
    expect(page).toMatch(/\n\s*Structure\n\s*<\/button>/);
    expect(page).not.toMatch(/\n\s*Skeleton\n\s*<\/button>/);
  });

  it('the internal tab identifier is deliberately unchanged', () => {
    expect(page).toContain("navigateTab('skeleton')");
    expect(page).toContain("activeTab === 'skeleton'");
  });

  it('10. the consequence of editing is stated before it happens', () => {
    expect(panel).toContain('Editing this structure regenerates the skeleton');
    expect(panel).toMatch(/clears the current skeleton/i);
    expect(panel).toMatch(/clears the strategic card/i);
    // ...and it does not overstate the damage.
    expect(panel).toMatch(/nothing else is deleted/i);
  });

  it('the notice is shown only when a structure exists', () => {
    expect(panel).toContain('hasExistingStructure');
    expect(panel).toContain('{hasExistingStructure && (');
  });

  it('CP-STRUCT-002 call sites are untouched', () => {
    // acceptProposal order.
    const body = panel.slice(panel.indexOf('const acceptProposal'), panel.indexOf('const handleScheduleGenerate'));
    expect(body.indexOf('setPlatformContentRequests(')).toBeLessThan(body.indexOf('setCalendarPlan('));
    // PlanLoader guard.
    expect(page).toContain('decidePlanAdoption(');
    expect(page).toContain('if (!decision.adopt) return;');
  });
});
