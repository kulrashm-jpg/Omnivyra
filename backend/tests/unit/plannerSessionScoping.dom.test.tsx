/**
 * @jest-environment jsdom
 *
 * BLOCK-3 — what the persisted planner session actually belongs to.
 *
 * The store keeps ONE localStorage slot per company:
 *
 *   omnivyra_planner_session_<companyId>
 *
 * and both the restore (mount) and the persist (every state change) are
 * UNCONDITIONAL — only the server-draft bootstrap and the autosave check
 * `serverDraft.enabled`. So every planner entry mode shares that one slot,
 * including the explicit `?campaignId=` entry, which owns a DIFFERENT entity
 * (a real campaign) from the one the slot was written for (the open draft).
 *
 * These tests walk the supported workflows against the REAL
 * PlannerSessionProvider and record what actually happens, so the BLOCK-3
 * verdict rests on behaviour rather than on how the key reads.
 */

import React, { useEffect, useRef } from 'react';
import { render, act, waitFor } from '@testing-library/react';

/* ── In-memory server: the three real routes ──────────────────────────── */

type Row = Record<string, unknown>;
const campaigns = new Map<string, Row>();
const snapshots = new Map<string, { planner_state: Row | null; revision: number }>();
let nextId = 0;
const bootstrapCalls: Array<{ companyId: string; created: boolean }> = [];

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
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
  return row ? isFinalizedStage(resolveCampaignStage(row as CampaignStatusFields).stage) : false;
};

(globalThis as any).__server = async (url: string, init?: RequestInit) => {
  const method = (init?.method ?? 'GET').toUpperCase();

  if (url === '/api/campaigns/planner-draft' && method === 'POST') {
    const companyId = JSON.parse(String(init?.body ?? '{}')).companyId;
    const resumable = [...campaigns.entries()].find(
      ([, r]) => r.company_id === companyId && r.status === 'draft',
    );
    if (resumable) {
      bootstrapCalls.push({ companyId, created: false });
      return json(200, { campaign_id: resumable[0], resumed: true, stage: 'draft' });
    }
    const id = `draft-${++nextId}`;
    campaigns.set(id, {
      id, company_id: companyId, status: 'draft',
      current_stage: 'planning', thread_id: `planner_draft_${nextId}`,
    });
    snapshots.set(id, { planner_state: null, revision: 0 });
    bootstrapCalls.push({ companyId, created: true });
    return json(201, { campaign_id: id, resumed: false, stage: 'draft' });
  }

  const m = url.match(/^\/api\/campaigns\/([^/]+)\/planner-draft-state$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (isFinalized(id)) {
      return json(409, { code: DRAFT_FINALIZED_CODE, stage: 'ready' });
    }
    const snap = snapshots.get(id) ?? { planner_state: null, revision: 0 };
    if (method === 'GET') return json(200, { planner_state: snap.planner_state, revision: snap.revision });
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

/** Exactly what planner-finalize writes (planner-finalize.ts:788). */
function finalizeCampaign(id: string): void {
  const row = campaigns.get(id);
  if (!row) throw new Error(`no such campaign: ${id}`);
  campaigns.set(id, { ...row, current_stage: 'execution_ready', blueprint_status: 'ACTIVE', status: 'planning' });
}

/* ── The real store ───────────────────────────────────────────────────── */

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

const CO_A = 'company-a';
const CO_B = 'company-b';
const key = (companyId: string) => `omnivyra_planner_session_${companyId}`;

/** One planner ENTRY. `serverDraft.enabled` mirrors the real page: true for
 *  `?mode=direct`, false whenever an explicit campaignId is present. */
function enterPlanner(opts: {
  companyId?: string;
  draftEnabled?: boolean;
  urlDraftId?: string | null;
  campaignId?: string | null;
} = {}) {
  const seen: string[] = [];
  const view = render(
    <PlannerSessionProvider
      companyId={opts.companyId ?? CO_A}
      campaignId={opts.campaignId ?? null}
      serverDraft={{
        enabled: opts.draftEnabled !== false,
        urlDraftId: opts.urlDraftId ?? null,
        onDraftIdChange: (id) => { seen.push(id); },
      }}
    >
      <Probe />
    </PlannerSessionProvider>,
  );
  return { view, seen };
}

async function bootstrapped(seen: string[]): Promise<string> {
  await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  return seen[seen.length - 1];
}
/** Settle a draft-disabled entry, which never calls onDraftIdChange. */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}

const cached = (companyId: string): Row | null => {
  try { return JSON.parse(localStorage.getItem(key(companyId)) ?? 'null'); } catch { return null; }
};

function fillPlannerState(title: string) {
  act(() => {
    store.setIdeaSpine({ title, description: `${title} description`, origin: 'direct' } as never);
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

/* ── Scenarios A–C: the draft lifecycle (BLOCK-1's ground) ────────────── */

describe('Scenario A — first entry, no draft', () => {
  it('creates a draft and writes it into the company slot', async () => {
    const { seen } = enterPlanner();
    const id = await bootstrapped(seen);

    expect(bootstrapCalls).toEqual([{ companyId: CO_A, created: true }]);
    await waitFor(() => expect(cached(CO_A)?.draft_campaign_id).toBe(id));
  });
});

describe('Scenario B — draft A, reload, resume', () => {
  it('resumes the same draft with its planner state intact', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    fillPlannerState('Draft A');
    first.view.unmount();

    bootstrapCalls.length = 0;
    const second = enterPlanner();
    expect(await bootstrapped(second.seen)).toBe(idA);
    expect(bootstrapCalls).toHaveLength(0); // resumed from cache, re-validated
    expect(store.state.idea_spine).toMatchObject({ title: 'Draft A' });
  });
});

describe('Scenario C — draft A finalized, then draft B', () => {
  it('B is a new draft and carries none of A (BLOCK-1)', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    fillPlannerState('Draft A');
    finalizeCampaign(idA);
    first.view.unmount();

    const second = enterPlanner();
    const idB = await bootstrapped(second.seen);

    expect(idB).not.toBe(idA);
    expect(store.state.idea_spine).toBeNull();
    expect(store.state.strategy_context).toBeNull();
  });
});

/* ── Scenario D: the explicit campaign entry ──────────────────────────── */

describe('Scenario D — explicit campaign reopen (?campaignId=)', () => {
  it('does not inherit the open draft’s planner state', async () => {
    // Reachable in normal use, and made routine by BLOCK-2: finalize now
    // lands on /campaign-planner?campaignId=<id>&tab=board, which is a
    // bookmarkable URL. Meanwhile a later ?mode=direct entry rewrites the
    // company slot with a DIFFERENT draft. Reopening the campaign then reads
    // that other draft's spine, strategy and assignments.
    const draft = enterPlanner();
    await bootstrapped(draft.seen);
    fillPlannerState('Some other draft');
    draft.view.unmount();

    // Now open a specific campaign. The draft bootstrap is disabled, exactly
    // as the page does when campaignId is present.
    enterPlanner({ draftEnabled: false, campaignId: 'campaign-A' });
    await settle();

    expect(store.state.idea_spine).toBeNull();
    expect(store.state.strategy_context).toBeNull();
  });

  it('does not write campaign state back over the draft’s cache', async () => {
    const draft = enterPlanner();
    const idDraft = await bootstrapped(draft.seen);
    fillPlannerState('Draft A');
    await waitFor(() => expect(cached(CO_A)?.idea_spine).toMatchObject({ title: 'Draft A' }));
    draft.view.unmount();

    const campaign = enterPlanner({ draftEnabled: false, campaignId: 'campaign-A' });
    await settle();
    act(() => {
      store.setIdeaSpine({ title: 'Campaign X', description: 'x', origin: 'direct' } as never);
    });
    await settle();
    campaign.view.unmount();

    // The draft's own cache must survive an unrelated campaign being opened.
    const slot = cached(CO_A);
    expect(slot?.draft_campaign_id).toBe(idDraft);
    expect(slot?.idea_spine).toMatchObject({ title: 'Draft A' });
  });
});

/* ── Scenario E: company switch ───────────────────────────────────────── */

describe('Scenario E — company switch', () => {
  it('company B never sees company A’s planner state', async () => {
    const a = enterPlanner({ companyId: CO_A });
    await bootstrapped(a.seen);
    fillPlannerState('Company A campaign');
    a.view.unmount();

    const b = enterPlanner({ companyId: CO_B });
    await bootstrapped(b.seen);

    expect(store.state.idea_spine).toBeNull();
    expect(cached(CO_A)?.idea_spine).toMatchObject({ title: 'Company A campaign' });
    expect(cached(CO_B)?.idea_spine ?? null).toBeNull();
  });

  it('each company gets its OWN draft', async () => {
    const a = enterPlanner({ companyId: CO_A });
    const idA = await bootstrapped(a.seen);
    a.view.unmount();

    const b = enterPlanner({ companyId: CO_B });
    const idB = await bootstrapped(b.seen);

    expect(idB).not.toBe(idA);
    expect(campaigns.get(idA)!.company_id).toBe(CO_A);
    expect(campaigns.get(idB)!.company_id).toBe(CO_B);
  });
});

/* ── Scenario F: two direct tabs ──────────────────────────────────────── */

describe('Scenario F — two direct-mode tabs on one company', () => {
  it('both resolve to the SAME draft, so one slot is not a conflict', async () => {
    // create-or-resume returns the newest OPEN draft per (company, user), so
    // direct mode cannot produce two concurrent drafts for one company. The
    // single company slot therefore describes exactly one draft.
    const tab1 = enterPlanner();
    const id1 = await bootstrapped(tab1.seen);
    tab1.view.unmount();

    localStorage.clear(); // a second tab with no cache of its own
    bootstrapCalls.length = 0;
    const tab2 = enterPlanner();
    const id2 = await bootstrapped(tab2.seen);

    expect(id2).toBe(id1);
    expect(bootstrapCalls).toEqual([{ companyId: CO_A, created: false }]);
  });
});

/* ── Scenario G: logout / login ───────────────────────────────────────── */

describe('Scenario G — logout then login, same company', () => {
  it('the cached draft is re-validated against the server, not trusted blindly', async () => {
    const first = enterPlanner();
    const idA = await bootstrapped(first.seen);
    fillPlannerState('Draft A');
    first.view.unmount();

    // Session ends; localStorage survives. The campaign is finalized
    // elsewhere in the meantime.
    finalizeCampaign(idA);

    const second = enterPlanner();
    const idB = await bootstrapped(second.seen);

    expect(idB).not.toBe(idA);
    expect(store.state.idea_spine).toBeNull();
  });
});
