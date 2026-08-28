/**
 * @jest-environment jsdom
 *
 * CP-STRUCT-001 / CP-STRUCT-002 — the Structure stage, against the REAL
 * planner session store.
 *
 * These drive `PlannerSessionProvider` itself (not a re-implementation of it),
 * because the destructive semantics live in the store: `setCampaignStructure`,
 * `setCalendarPlan` and `setPlatformContentRequests` each reset
 * `skeleton_confirmed`, and the last of those ALSO clears the plan whenever the
 * matrix changes by reference.
 *
 * That reset is correct — a skeleton must not outlive the configuration it was
 * built from. The defect was ORDER: `acceptProposal` applied the matrix AFTER
 * writing the accepted plan, so it erased its own write every time (the
 * proposal always carries a freshly-built matrix object, so the reference
 * comparison always fired). The planner fell back to the generation controls
 * and `hasSkeletonDraft` went false, which disabled "Confirm Skeleton".
 */

import React, { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { PlannerSessionProvider, usePlannerSession } from '../../../components/planner/plannerSessionStore';
import { weeksToCalendarPlan } from '../../../components/planner/calendarPlanConverter';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));

/* ── Fixtures: the exact R6-D configuration ───────────────────────────────
 * 1 week · LinkedIn · 1 post/week · everything else zero.
 * ──────────────────────────────────────────────────────────────────────── */

const MATRIX_1_POST = { linkedin: { post: 1 } };
// NOTE: weeksToCalendarPlan reads `daily_execution_items` / `execution_items`
// — the shape ai/plan actually returns — not a `days` array.
const WEEKS_1_POST = [
  {
    week: 1,
    theme: 'Kickoff',
    phase_label: 'Awareness',
    daily_execution_items: [
      { execution_id: 'w1-mon-li', day: 'Monday', platform: 'linkedin', content_type: 'post', topic: 'Launch note' },
    ],
  },
];

/** A second, genuinely different configuration — for the revise flow. */
const MATRIX_2_CAROUSEL = { linkedin: { post: 1, carousel: 1 } };
const WEEKS_2_ITEMS = [
  {
    week: 1,
    theme: 'Kickoff',
    phase_label: 'Awareness',
    daily_execution_items: [
      { execution_id: 'w1-mon-li', day: 'Monday', platform: 'linkedin', content_type: 'post', topic: 'Launch note' },
      { execution_id: 'w1-wed-li', day: 'Wednesday', platform: 'linkedin', content_type: 'carousel', topic: 'Proof deck' },
    ],
  },
];

/** Live handle on the real store. */
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

function mount() {
  render(
    <PlannerSessionProvider>
      <Probe />
    </PlannerSessionProvider>,
  );
}

/** The BROKEN order that shipped: plan first, matrix last. */
function acceptBroken(weeks: unknown[], matrix: Record<string, Record<string, number>>) {
  const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
  act(() => {
    store.setCampaignStructure(campaign_structure);
    store.setCalendarPlan(calendar_plan);
    if (Object.keys(matrix).length > 0) store.setPlatformContentRequests(matrix);
  });
}

/** The REPAIRED order, mirroring acceptProposal: matrix first, then the plan. */
function acceptFixed(weeks: unknown[], matrix: Record<string, Record<string, number>>) {
  const { campaign_structure, calendar_plan } = weeksToCalendarPlan(weeks);
  act(() => {
    if (Object.keys(matrix).length > 0) store.setPlatformContentRequests(matrix);
    store.setCampaignStructure(campaign_structure);
    store.setCalendarPlan(calendar_plan);
  });
}

const activityCount = () => store.state.calendar_plan?.activities?.length ?? 0;
/** The parent's gate for enabling "Confirm Skeleton". */
const hasSkeletonDraft = () =>
  Boolean(store.state.calendar_plan?.activities?.length) ||
  Boolean(store.state.calendar_plan?.days?.length);

beforeEach(() => { mount(); });

/* ────────────────────────────────────────────────────────────────────────
 * CP-STRUCT-002
 * ──────────────────────────────────────────────────────────────────────── */

describe('CP-STRUCT-002 — accepting a structure must survive the accept', () => {
  it('REPRODUCES THE DEFECT — the shipped order erased the accepted structure', () => {
    acceptBroken(WEEKS_1_POST, MATRIX_1_POST);
    // The matrix write landed AFTER the plan and cleared it by reference.
    expect(store.state.calendar_plan).toBeNull();
    expect(store.state.campaign_structure).toBeNull();
    expect(hasSkeletonDraft()).toBe(false);   // ⇒ "Confirm Skeleton" stays disabled
    expect(store.state.skeleton_confirmed).toBe(false);
  });

  it('THE FIX — matrix first, so the accepted structure survives', () => {
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    expect(store.state.calendar_plan).not.toBeNull();
    expect(activityCount()).toBe(1);
    expect(store.state.campaign_structure).not.toBeNull();
    expect(hasSkeletonDraft()).toBe(true);    // ⇒ "Confirm Skeleton" becomes enabled
  });

  it('the accepted plan matches the configuration exactly (1 week, 1 LinkedIn post)', () => {
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    const acts = store.state.calendar_plan!.activities!;
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ platform: 'linkedin', content_type: 'post', week_number: 1 });
    expect(store.state.platform_content_requests).toEqual(MATRIX_1_POST);
  });

  it('confirming after accept advances the stage, and it STAYS advanced', () => {
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    act(() => { store.confirmSkeleton(); });
    expect(store.state.skeleton_confirmed).toBe(true);   // ⇒ the parent effect advances
    // No further write happens on its own, so the stage does not bounce back.
    expect(store.state.calendar_plan).not.toBeNull();
    expect(store.state.skeleton_confirmed).toBe(true);
  });

  it('confirmation is NOT reachable under the broken order', () => {
    acceptBroken(WEEKS_1_POST, MATRIX_1_POST);
    // canSubmitSkeleton = canConfirm(hasSkeletonDraft) && weeks covered.
    expect(hasSkeletonDraft()).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * CP-STRUCT-001
 * ──────────────────────────────────────────────────────────────────────── */

describe('CP-STRUCT-001 — revising the structure keeps the same draft', () => {
  it('changing the configuration and regenerating replaces the structure in place', () => {
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    expect(activityCount()).toBe(1);

    // Revise: a different content mix, re-accepted through the same path.
    acceptFixed(WEEKS_2_ITEMS, MATRIX_2_CAROUSEL);

    expect(activityCount()).toBe(2);
    expect(store.state.platform_content_requests).toEqual(MATRIX_2_CAROUSEL);
    const types = store.state.calendar_plan!.activities!.map((a) => a.content_type).sort();
    expect(types).toEqual(['carousel', 'post']);
  });

  it('revising CLEARS the stale confirmation rather than leaving it silently active', () => {
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    act(() => { store.confirmSkeleton(); });
    expect(store.state.skeleton_confirmed).toBe(true);

    acceptFixed(WEEKS_2_ITEMS, MATRIX_2_CAROUSEL);
    // The new skeleton has not been confirmed yet — the user must re-confirm.
    expect(store.state.skeleton_confirmed).toBe(false);
    expect(activityCount()).toBe(2);        // ...and the NEW structure is what stands
  });

  it('changing duration or start date does not disturb the draft identity', () => {
    act(() => { store.setSourceIds({ campaign_id: 'camp-existing' }); });
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    const before = store.state.source_ids?.campaign_id;

    act(() => {
      store.setStrategyContext({ duration_weeks: 2, planned_start_date: '2026-09-07' });
    });

    expect(store.state.source_ids?.campaign_id).toBe(before);   // same campaign
    expect(store.state.strategy_context?.duration_weeks).toBe(2);
    expect(store.state.strategy_context?.planned_start_date).toBe('2026-09-07');
  });

  it('an existing draft is never turned into a new campaign by revising', () => {
    act(() => { store.setSourceIds({ campaign_id: 'camp-existing' }); });
    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);
    acceptFixed(WEEKS_2_ITEMS, MATRIX_2_CAROUSEL);
    act(() => { store.confirmSkeleton(); });

    expect(store.state.source_ids?.campaign_id).toBe('camp-existing');
    expect(store.state.skeleton_confirmed).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Configuration → structure fidelity
 * ──────────────────────────────────────────────────────────────────────── */

describe('the accepted structure reflects the LATEST approved configuration', () => {
  it('no stale activity from the previous configuration remains', () => {
    acceptFixed(WEEKS_2_ITEMS, MATRIX_2_CAROUSEL);
    expect(activityCount()).toBe(2);

    acceptFixed(WEEKS_1_POST, MATRIX_1_POST);   // narrow back down
    expect(activityCount()).toBe(1);
    expect(store.state.calendar_plan!.activities![0].content_type).toBe('post');
    expect(store.state.platform_content_requests).toEqual(MATRIX_1_POST);
  });

  it('an empty matrix leaves the accepted plan untouched (nothing to reset against)', () => {
    acceptFixed(WEEKS_1_POST, {});
    expect(activityCount()).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * SOURCE GATE — bind the tests above to the REAL production code.
 *
 * The store-level tests prove which ORDER is correct. This proves that
 * acceptProposal actually uses it, and that PlanLoader actually guards its
 * write — so reverting either fix fails this suite, not just a simulation.
 * ──────────────────────────────────────────────────────────────────────── */

describe('SOURCE GATE — the production call sites', () => {
  const ROOT = join(__dirname, '../../..');
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  const panel = strip(readFileSync(join(ROOT, 'components/planner/SkeletonBuilderPanel.tsx'), 'utf8'));
  const page = strip(readFileSync(join(ROOT, 'pages/campaign-planner.tsx'), 'utf8'));

  it('acceptProposal applies the matrix BEFORE writing the accepted plan', () => {
    const body = panel.slice(panel.indexOf('const acceptProposal'), panel.indexOf('const handleScheduleGenerate'));
    const matrixAt = body.indexOf('setPlatformContentRequests(');
    const planAt = body.indexOf('setCalendarPlan(');
    const structureAt = body.indexOf('setCampaignStructure(');
    expect(matrixAt).toBeGreaterThan(-1);
    expect(matrixAt).toBeLessThan(structureAt);   // matrix first…
    expect(matrixAt).toBeLessThan(planAt);        // …then the plan it must not erase
  });

  it('PlanLoader guards its write with the adoption decision', () => {
    expect(page).toContain('decidePlanAdoption(');
    expect(page).toContain('if (!decision.adopt) return;');
  });

  it('PlanLoader no longer depends on the state it writes', () => {
    const dep = page.slice(page.indexOf('function PlanLoader'), page.indexOf('function CampaignPlannerInner'));
    const deps = dep.slice(dep.lastIndexOf('}, ['), dep.lastIndexOf(']'));
    expect(deps).not.toContain('state.calendar_plan');
    expect(deps).not.toContain('state.campaign_structure');
  });

  it('a failed reload no longer nulls canonical planner state', () => {
    const dep = page.slice(page.indexOf('function PlanLoader'), page.indexOf('function CampaignPlannerInner'));
    const katch = dep.slice(dep.indexOf('.catch('));
    expect(katch).not.toContain('setCampaignStructure(null)');
    expect(katch).not.toContain('setCalendarPlan(null)');
  });
});
