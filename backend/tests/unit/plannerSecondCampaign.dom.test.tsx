/**
 * @jest-environment jsdom
 *
 * BLOCK-1 — the second-campaign lifecycle, end to end, against the REAL
 * planner session store.
 *
 * This is the executable reproduction. It drives `PlannerSessionProvider`
 * itself (not a re-implementation) against an in-memory server that mirrors
 * the three real routes, including their real row transitions:
 *
 *   POST /api/campaigns/planner-draft      resume filter = status 'draft'
 *   GET/PUT /planner-draft-state           refuses a finalized campaign
 *   finalize                               current_stage 'execution_ready'
 *
 * Lifecycle interpretation is NOT re-implemented — the fake server calls the
 * canonical `resolveCampaignStage` / `isFinalizedStage`, so if the read model
 * ever changed its verdict this simulation changes with production.
 *
 * The failure being closed: the store bootstrapped with
 * `urlDraftId || localDraftIdRef.current`, and any id short-circuited
 * create-or-resume. The id is cached in company-scoped localStorage and
 * survives finalize, so campaign A stayed the active draft forever and the
 * next finalize answered `400 Campaign already finalized`.
 */

import React, { useEffect, useRef } from 'react';
import { render, act, waitFor } from '@testing-library/react';

/* ── The in-memory server ─────────────────────────────────────────────── */

type Row = Record<string, unknown>;
const campaigns = new Map<string, Row>();
const snapshots = new Map<string, { planner_state: Row | null; revision: number }>();
let nextId = 0;
/** Every create-or-resume the client actually performed. */
const bootstrapCalls: Array<{ companyId: string; created: boolean; id: string }> = [];

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: (...args: unknown[]) => (globalThis as any).__server(...args),
}));

import {
  resolveCampaignStage,
  isFinalizedStage,
  CampaignStatusFields,
} from '../../../lib/campaign/campaignStage';
import { DRAFT_FINALIZED_CODE } from '../../../lib/campaign/plannerDraftLifecycle';
import {
  PlannerSessionProvider,
  usePlannerSession,
} from '../../../components/planner/plannerSessionStore';

const isFinalized = (id: string): boolean => {
  const row = campaigns.get(id);
  if (!row) return false;
  return isFinalizedStage(resolveCampaignStage(row as CampaignStatusFields).stage);
};

(globalThis as any).__server = async (url: string, init?: RequestInit) => {
  const method = (init?.method ?? 'GET').toUpperCase();

  // ── POST /api/campaigns/planner-draft — create-or-resume ──────────────
  if (url === '/api/campaigns/planner-draft' && method === 'POST') {
    const companyId = JSON.parse(String(init?.body ?? '{}')).companyId;
    // The REAL resume key: company + status 'draft'. Finalize moves the row
    // off 'draft', so a finalized campaign can never match here.
    const resumable = [...campaigns.entries()].find(
      ([, r]) => r.company_id === companyId && r.status === 'draft',
    );
    if (resumable) {
      bootstrapCalls.push({ companyId, created: false, id: resumable[0] });
      return json(200, { campaign_id: resumable[0], resumed: true, stage: 'draft' });
    }
    const id = `campaign-${++nextId}`;
    campaigns.set(id, {
      id,
      company_id: companyId,
      status: 'draft',
      current_stage: 'planning',
      thread_id: `planner_draft_${nextId}`,
    });
    snapshots.set(id, { planner_state: null, revision: 0 });
    bootstrapCalls.push({ companyId, created: true, id });
    return json(201, { campaign_id: id, resumed: false, stage: 'draft' });
  }

  // ── GET/PUT /api/campaigns/:id/planner-draft-state ────────────────────
  const m = url.match(/^\/api\/campaigns\/([^/]+)\/planner-draft-state$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (isFinalized(id)) {
      return json(409, {
        code: DRAFT_FINALIZED_CODE,
        error: 'This campaign is no longer a draft.',
        stage: resolveCampaignStage(campaigns.get(id) as CampaignStatusFields).stage,
      });
    }
    const snap = snapshots.get(id) ?? { planner_state: null, revision: 0 };
    if (method === 'GET') {
      return json(200, { planner_state: snap.planner_state, revision: snap.revision });
    }
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (snap.revision !== Number(body.baseRevision)) {
        return json(409, { error: 'stale_revision', planner_state: snap.planner_state, revision: snap.revision });
      }
      const revision = snap.revision + 1;
      snapshots.set(id, { planner_state: body.planner_state, revision });
      return json(200, { revision });
    }
  }
  return json(404, { error: 'not found' });
};

/** Exactly what planner-finalize writes on success (planner-finalize.ts:788). */
function finalizeCampaign(id: string): void {
  const row = campaigns.get(id);
  if (!row) throw new Error(`no such campaign: ${id}`);
  campaigns.set(id, { ...row, current_stage: 'execution_ready', blueprint_status: 'ACTIVE', status: 'planning' });
}

/* ── The real store, mounted ──────────────────────────────────────────── */

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

const COMPANY = 'co-1';
const STORAGE_KEY = `omnivyra_planner_session_${COMPANY}`;

/** One planner ENTRY: a fresh provider, exactly like navigating to
 *  /campaign-planner?mode=direct. localStorage deliberately persists. */
function enterPlanner(urlDraftId: string | null = null) {
  const seen: string[] = [];
  const view = render(
    <PlannerSessionProvider
      companyId={COMPANY}
      serverDraft={{ enabled: true, urlDraftId, onDraftIdChange: (id) => { seen.push(id); } }}
    >
      <Probe />
    </PlannerSessionProvider>,
  );
  return { view, seen };
}

const draftId = () => store.state.draft_campaign_id ?? null;

/**
 * Wait for the BOOTSTRAP to settle, not merely for an id to exist.
 *
 * The cached `draft_campaign_id` is restored synchronously on mount, so
 * `draft_campaign_id` is truthy long before the server has been consulted —
 * waiting on it would assert against the stale value and pass either way.
 * `onDraftIdChange` fires once, at the end of `adoptServerState`, which is
 * the exact moment the session commits to an id.
 */
async function bootstrapped(seen: string[]): Promise<string> {
  await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  return seen[seen.length - 1];
}
const cached = (): Row | null => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; }
};

/** Build a recognisable planner session so contamination would be visible. */
function fillPlannerState(title: string) {
  act(() => {
    store.setIdeaSpine({ title, description: `${title} description` } as never);
    store.setStrategyContext({ campaign_goal: `${title} goal`, duration_weeks: 4 });
  });
}

beforeEach(() => {
  campaigns.clear();
  snapshots.clear();
  bootstrapCalls.length = 0;
  nextId = 0;
  localStorage.clear();
});

/* ── The lifecycle ────────────────────────────────────────────────────── */

describe('BLOCK-1 — campaign A finalized, then campaign B', () => {
  it('a first direct session with no cached draft CREATES a draft', async () => {
    const { seen } = enterPlanner();
    await bootstrapped(seen);

    expect(bootstrapCalls).toHaveLength(1);
    expect(bootstrapCalls[0].created).toBe(true);
    expect(campaigns.size).toBe(1);
  });

  it('an ACTIVE cached draft is RESUMED — create-or-resume is not called again', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    fillPlannerState('Campaign A');
    first.view.unmount();

    bootstrapCalls.length = 0;
    const second = enterPlanner();
    expect(await bootstrapped(second.seen)).toBe(idA);

    // Resume must stay cheap and stable: the cached id was probed and kept.
    expect(bootstrapCalls).toHaveLength(0);
    expect(campaigns.size).toBe(1);
  });

  it('THE REGRESSION: after finalizing A, a new entry creates B and never reuses A', async () => {
    // ── Campaign A: draft → planner → autosave → finalize ──────────────
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    fillPlannerState('Campaign A');

    // Let the real 1.5s autosave debounce fire so A's state genuinely lives
    // on the server — that is what the stale id would have re-adopted.
    await act(async () => { await new Promise((r) => setTimeout(r, 1800)); });
    expect(snapshots.get(idA)!.planner_state).toMatchObject({
      idea_spine: { title: 'Campaign A' },
    });
    expect(cached()!.draft_campaign_id).toBe(idA);

    finalizeCampaign(idA);
    expect(isFinalized(idA)).toBe(true);
    first.view.unmount();

    // ── Campaign B: a new direct entry, same browser, same company ─────
    bootstrapCalls.length = 0;
    const second = enterPlanner();
    const idB = await bootstrapped(second.seen);

    // 1. A genuinely new draft, not the finalized campaign.
    expect(idB).not.toBe(idA);
    expect(bootstrapCalls).toHaveLength(1);
    expect(bootstrapCalls[0].created).toBe(true);
    expect(campaigns.size).toBe(2);

    // 2. The finalized campaign is untouched — it never became a draft again.
    expect(campaigns.get(idA)!.current_stage).toBe('execution_ready');
    expect(snapshots.get(idA)!.planner_state).toMatchObject({ idea_spine: { title: 'Campaign A' } });

    // 3. NO CONTAMINATION: campaign B starts empty. Campaign A's spine,
    //    goal and structure must not have ridden across on the cache.
    expect(store.state.idea_spine).toBeNull();
    expect(store.state.strategy_context).toBeNull();
    expect(store.state.campaign_structure).toBeNull();
    expect(store.state.calendar_plan).toBeNull();
    expect(snapshots.get(idB)!.planner_state).toBeNull();

    // 4. The cache now points at B, not the finalized A.
    expect(cached()!.draft_campaign_id).toBe(idB);
  }, 20000);

  it('a finalized id arriving in the URL is rejected too, not just the cache', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    first.view.unmount();
    finalizeCampaign(idA);
    localStorage.clear(); // the ONLY carrier of the stale id is ?draftId=

    bootstrapCalls.length = 0;
    const second = enterPlanner(idA);
    const idB = await bootstrapped(second.seen);

    expect(idB).not.toBe(idA);
    expect(bootstrapCalls[0].created).toBe(true);
    // The page is told the new id so the URL stops advertising the dead one.
    expect(draftId()).toBe(idB);
  });

  it('campaign B can itself be finalized — the loop repeats, it is not a one-shot', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    finalizeCampaign(idA);
    first.view.unmount();

    const second = enterPlanner();
    const idB = await bootstrapped(second.seen);
    expect(idB).not.toBe(idA);
    finalizeCampaign(idB);
    second.view.unmount();

    const third = enterPlanner();
    const idC = await bootstrapped(third.seen);
    expect([idA, idB]).not.toContain(idC);
    expect(campaigns.size).toBe(3);
  });

  it('a transient probe failure RESUMES the cached draft — a blip never destroys work', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    fillPlannerState('Campaign A');
    first.view.unmount();

    // The draft-state probe fails (offline), but create-or-resume still works.
    const realServer = (globalThis as any).__server;
    (globalThis as any).__server = async (url: string, init?: RequestInit) =>
      /planner-draft-state$/.test(url) ? json(500, { error: 'offline' }) : realServer(url, init);

    bootstrapCalls.length = 0;
    const second = enterPlanner();
    expect(await bootstrapped(second.seen)).toBe(idA);

    // Resumed, not discarded — and the cached work survives.
    expect(bootstrapCalls).toHaveLength(0);
    expect(store.state.idea_spine).toMatchObject({ title: 'Campaign A' });
    (globalThis as any).__server = realServer;
  });
});

/* ── Neighbouring behaviour that must not move ────────────────────────── */

describe('existing entry modes are untouched', () => {
  it('with serverDraft DISABLED (recommendation/opportunity/existing-campaign entry) nothing bootstraps', async () => {
    render(
      <PlannerSessionProvider companyId={COMPANY} serverDraft={{ enabled: false }}>
        <Probe />
      </PlannerSessionProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(bootstrapCalls).toHaveLength(0);
    expect(campaigns.size).toBe(0);
    expect(draftId()).toBeNull();
  });

  it('an explicit campaign opened via source_ids is not confused with the draft id', async () => {
    const { seen } = enterPlanner();
    const idA = await bootstrapped(seen);

    act(() => { store.setSourceIds({ campaign_id: 'existing-campaign-99' }); });

    // Two distinct identities: the draft that owns the session, and the
    // existing campaign the entry referenced.
    expect(store.state.source_ids?.campaign_id).toBe('existing-campaign-99');
    expect(draftId()).toBe(idA);
  });
});
