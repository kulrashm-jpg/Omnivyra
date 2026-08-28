/**
 * @jest-environment jsdom
 *
 * BLOCK-2 — after finalize, the CMO must land where the campaign can actually
 * be released.
 *
 * `campaign_readiness` was never the blocker (see
 * campaignExecutionReachability.test.ts). The blocker was reachability:
 * finalize navigated to `/campaign-calendar/<id>`, a page with no release
 * affordance, and nothing anywhere links back into the planner scoped to a
 * campaign — every entry point is `?mode=direct`, which since BLOCK-1
 * correctly mints a NEW draft. The finalized campaign was therefore stranded
 * at `status='planning'`, and the publish pipeline refuses any campaign that
 * is not active.
 *
 * `FinalizeSection` made this unfixable by configuration: it called
 * `onFinalize?.(cid)` and then ran an unconditional
 * `window.location.href = '/campaign-calendar/' + cid`, so the full-page
 * navigation always won and any handler destination was dead code. These
 * tests drive the REAL component and assert what it actually does.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { campaignReleaseHandoffPath } from '../../../lib/campaign/campaignHandoffRoute';

/* ── The network: one scripted finalize response ──────────────────────── */

const mockFetchWithAuth = jest.fn();
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

// Keep the component's optional side-quests inert so the test exercises the
// finalize → navigation path and nothing else.
jest.mock('../../../lib/content/creatorAssetServerBackend', () => ({
  fetchLibraryMaterializableAssets: jest.fn(async () => new Map()),
}));
jest.mock('../../../components/planner/useApprovalSettings', () => ({
  fetchRequireAssignmentApproval: jest.fn(async () => false),
}));

import { FinalizeSection } from '../../../components/planner/FinalizeSection';
import { PlannerSessionProvider, usePlannerSession } from '../../../components/planner/plannerSessionStore';
import { CampaignReleasePanel } from '../../../components/planner/CampaignReleasePanel';

const COMPANY = 'co-1';
const CAMPAIGN_A = 'campaign-a-id';
const CAMPAIGN_B = 'campaign-b-id';

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

/** A planner session complete enough for FinalizeSection to submit. */
function Seed() {
  const { state, setIdeaSpine, setStrategyContext, setCalendarPlan, confirmSkeleton, confirmStrategy } =
    usePlannerSession();
  React.useEffect(() => {
    if (state.idea_spine) return;
    // canFinalize requires a refined title, a refined description AND a
    // selected angle — the same bar the real Strategy stage enforces.
    setIdeaSpine({
      title: 'Launch',
      description: 'Launch campaign',
      origin: 'direct',
      refined_title: 'Launch',
      refined_description: 'Launch campaign',
      selected_angle: 'founder story',
    } as never);
    setStrategyContext({
      campaign_goal: 'awareness',
      duration_weeks: 1,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 1 },
      target_audience: 'founders',
      planned_start_date: '2026-09-01',
    });
    setCalendarPlan({
      activities: [
        { execution_id: 'w1-mon-li', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'post', title: 'Launch note' },
      ],
    } as never);
    confirmSkeleton();
    confirmStrategy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.idea_spine]);
  return null;
}

function mountFinalize(onFinalize?: (id: string) => void) {
  return render(
    <PlannerSessionProvider companyId={COMPANY} serverDraft={{ enabled: false }}>
      <Seed />
      <FinalizeSection companyId={COMPANY} campaignId={null} onFinalize={onFinalize} />
    </PlannerSessionProvider>,
  );
}

/** Click whatever control actually submits the finalize request. */
async function clickFinalize() {
  const buttons = await screen.findAllByRole('button');
  const target = buttons.find((b) => /finali[sz]e|create campaign/i.test(b.textContent ?? ''));
  if (!target) throw new Error(`no finalize control among: ${buttons.map((b) => b.textContent).join(' | ')}`);
  await act(async () => { target.click(); });
}

let assignedHref: string | null = null;

beforeEach(() => {
  mockFetchWithAuth.mockReset();
  assignedHref = null;
  localStorage.clear();
  // jsdom refuses real navigation; capture the assignment instead.
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: unknown }).location = {
    href: '',
    get assign() { return (v: string) => { assignedHref = v; }; },
  };
  Object.defineProperty(window.location, 'href', {
    get: () => assignedHref ?? '',
    set: (v: string) => { assignedHref = v; },
    configurable: true,
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── 1. The destination is pure and correct ───────────────────────────── */

describe('campaignReleaseHandoffPath', () => {
  it('routes to the planner Board, carrying the campaign in the URL', () => {
    expect(campaignReleaseHandoffPath(CAMPAIGN_A))
      .toBe(`/campaign-planner?campaignId=${CAMPAIGN_A}&tab=board`);
  });

  it('does NOT route to the calendar — that page cannot release a campaign', () => {
    expect(campaignReleaseHandoffPath(CAMPAIGN_A)).not.toContain('campaign-calendar');
  });

  it('uses campaignId (not draftId), so the planner treats it as an existing campaign', () => {
    // This is what keeps BLOCK-1 intact: with campaignId present the planner
    // disables the server-draft bootstrap entirely, so landing here can never
    // mint or resume a draft.
    const path = campaignReleaseHandoffPath(CAMPAIGN_A);
    expect(path).toContain('campaignId=');
    expect(path).not.toContain('draftId=');
    expect(path).not.toContain('mode=direct');
  });

  it('encodes the id and refuses an empty one', () => {
    expect(campaignReleaseHandoffPath('a b/c')).toContain('campaignId=a%20b%2Fc');
    expect(() => campaignReleaseHandoffPath('   ')).toThrow();
  });
});

/* ── 2. The component actually honours it ─────────────────────────────── */

describe('FinalizeSection hands the campaign to the release surface', () => {
  it('delegates to onFinalize and does NOT navigate away from the app', async () => {
    // The defect: onFinalize was called, then a full-page navigation ran
    // regardless, so the handler could never decide the destination.
    const seen: string[] = [];
    mockFetchWithAuth.mockResolvedValue(json(200, { campaign_id: CAMPAIGN_A }));

    mountFinalize((id) => seen.push(id));
    await clickFinalize();

    await waitFor(() => expect(seen).toEqual([CAMPAIGN_A]));
    expect(assignedHref).toBeNull();
  });

  it('with no handler, the fallback lands on the Board — never the calendar', async () => {
    mockFetchWithAuth.mockResolvedValue(json(200, { campaign_id: CAMPAIGN_A }));

    mountFinalize(undefined);
    await clickFinalize();

    await waitFor(() => expect(assignedHref).toBe(campaignReleaseHandoffPath(CAMPAIGN_A)));
    expect(assignedHref).not.toContain('campaign-calendar');
  });

  it('a FAILED finalize navigates nowhere and notifies nobody', async () => {
    const seen: string[] = [];
    mockFetchWithAuth.mockResolvedValue(json(400, { error: 'Campaign already finalized' }));

    mountFinalize((id) => seen.push(id));
    await clickFinalize();

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    expect(seen).toEqual([]);
    expect(assignedHref).toBeNull();
  });

  it('the destination actually surfaces the release control (Build & Launch eligibility)', async () => {
    // Landing somewhere is worthless if the seam is not there. The Board
    // renders CampaignReleasePanel, which offers Release once the session
    // holds a plan — either carried across the client-side navigation, or
    // hydrated by PlanLoader from retrieve-plan on a fresh load.
    render(
      <PlannerSessionProvider companyId={COMPANY} serverDraft={{ enabled: false }}>
        <Seed />
        <CampaignReleasePanel campaignId={CAMPAIGN_A} weeks={null} />
      </PlannerSessionProvider>,
    );

    const release = await screen.findByRole('button', { name: /release campaign/i });
    await waitFor(() => expect((release as HTMLButtonElement).disabled).toBe(false));
  });

  it('without a campaign the panel offers nothing to release', async () => {
    render(
      <PlannerSessionProvider companyId={COMPANY} serverDraft={{ enabled: false }}>
        <Seed />
        <CampaignReleasePanel campaignId={null} weeks={null} />
      </PlannerSessionProvider>,
    );
    expect(await screen.findByText(/finalize the campaign to enable scheduling/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /release campaign/i })).toBeNull();
  });

  it('campaign B is handed off to B — the destination is never sticky', async () => {
    const seen: string[] = [];
    mockFetchWithAuth.mockResolvedValue(json(200, { campaign_id: CAMPAIGN_A }));
    const first = mountFinalize((id) => seen.push(id));
    await clickFinalize();
    await waitFor(() => expect(seen).toEqual([CAMPAIGN_A]));
    first.unmount();

    mockFetchWithAuth.mockResolvedValue(json(200, { campaign_id: CAMPAIGN_B }));
    mountFinalize((id) => seen.push(id));
    await clickFinalize();

    await waitFor(() => expect(seen).toEqual([CAMPAIGN_A, CAMPAIGN_B]));
    expect(campaignReleaseHandoffPath(seen[1])).toContain(CAMPAIGN_B);
    expect(campaignReleaseHandoffPath(seen[1])).not.toContain(CAMPAIGN_A);
  });
});
