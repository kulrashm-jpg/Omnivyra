/**
 * @jest-environment jsdom
 *
 * OPT-005 Phase 2C — lead intelligence, social platform settings and
 * activity-workspace read surfaces on SWR.
 *
 * Pins: shared cache + duplicate-request elimination across subscribers,
 * centralized lead invalidation after an operation (revalidate-only, company
 * scoped), content-prefs PUT and api-request PATCH write-through with zero
 * GET refetch, stable activity-workspace keys (resolve / weekly / daily),
 * mutate-driven refresh, loading parity and cross-org / cross-campaign cache
 * isolation.
 */
import React, { useState } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { SWRConfig, useSWRConfig } from 'swr';

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), query: {} }) }));
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({ selectedCompanyId: 'org-s1' }),
}));
jest.mock('../../../components/Header', () => () => null);
jest.mock('../../../lib/setup/setupEvents', () => ({ emitSetupChanged: jest.fn(), onSetupChanged: () => () => {} }));

import OverviewPanel from '../../../components/lead-intelligence/OverviewPanel';
import OperationalPanel from '../../../components/lead-intelligence/OperationalPanel';
import { leadStatsKey, operationalOverlayKey } from '../../../components/lead-intelligence/leadIntelligenceClient';
import { useSocialPlatforms } from '../../../hooks/useSocialPlatforms';
import { useActivityWorkspacePersistence } from '../../../hooks/useActivityWorkspacePersistence';
import { SWR_GLOBAL_CONFIG } from '../../../lib/swr/swrClient';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const harness = (children: React.ReactNode) => (
  <SWRConfig value={{ ...SWR_GLOBAL_CONFIG, provider: () => new Map() }}>{children}</SWRConfig>
);

const statsBody = {
  total: 2, bySource: { website: 2 }, byStatus: { new: 2 },
  intentBands: { high: 1, medium: 1, low: 0 }, withIdentity: 2, withCampaign: 1,
};

const countCalls = (match: (url: string, init?: { method?: string }) => boolean) =>
  mockApiFetch.mock.calls.filter(([url, init]) => match(String(url), init as { method?: string })).length;
const isGet = (init?: { method?: string }) => !init?.method || init.method === 'GET';

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

// ── Lead Intelligence ────────────────────────────────────────────────────────

function leadRoutes(url: string, init?: { method?: string }) {
  if (url.startsWith('/api/lead-intelligence/operations') && init?.method === 'POST') return ok({ ok: true });
  if (url.startsWith('/api/lead-intelligence/operations?')) return ok({ status: 'new', assignee: null, notes: [], tasks: [] });
  if (url.startsWith('/api/lead-intelligence/stats?')) return ok(statsBody);
  if (url.startsWith('/api/lead-intelligence/leads?')) return ok({ rows: [], total: 0, limit: 8, offset: 0 });
  return ok({});
}

describe('Lead Intelligence (Phase 2C)', () => {
  test('shared cache: two Overview subscribers issue ONE stats and ONE leads request', async () => {
    mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => leadRoutes(url, init));
    render(harness(<><OverviewPanel companyId="org-a" /><OverviewPanel companyId="org-a" /></>));
    await waitFor(() => expect(screen.getAllByText('Total Leads').length).toBe(2));
    expect(countCalls((u, i) => u.startsWith('/api/lead-intelligence/stats?') && isGet(i))).toBe(1);
    expect(countCalls((u, i) => u.startsWith('/api/lead-intelligence/leads?') && isGet(i))).toBe(1);
    // The stats key is the exact request URL for this company.
    expect(mockApiFetch.mock.calls.map(([u]) => u)).toContain(leadStatsKey('org-a'));
  });

  test('operation → centralized revalidation of stats/leads/overlay for THIS org only', async () => {
    mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => leadRoutes(url, init));
    render(harness(
      <>
        <OverviewPanel companyId="org-a" />
        <OverviewPanel companyId="org-b" />
        <OperationalPanel companyId="org-a" entityId="lead-1" />
      </>
    ));
    await waitFor(() =>
      expect(countCalls((u, i) => u === operationalOverlayKey('org-a', 'lead-1') && isGet(i))).toBe(1)
    );
    const statsA = () => countCalls((u, i) => u === leadStatsKey('org-a') && isGet(i));
    const statsB = () => countCalls((u, i) => u === leadStatsKey('org-b') && isGet(i));
    const leadsA = () => countCalls((u, i) => u.startsWith('/api/lead-intelligence/leads?company_id=org-a') && isGet(i));
    const overlayA = () => countCalls((u, i) => u === operationalOverlayKey('org-a', 'lead-1') && isGet(i));
    expect([statsA(), statsB(), leadsA(), overlayA()]).toEqual([1, 1, 1, 1]);

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contacted' } });
    });
    expect(countCalls((u, i) => u === '/api/lead-intelligence/operations' && i?.method === 'POST')).toBe(1);

    // Revalidate-only invalidation: org-a reads refetch, org-b untouched.
    await waitFor(() => expect([statsA(), leadsA(), overlayA()]).toEqual([2, 2, 2]));
    expect(statsB()).toBe(1);
  });
});

// ── Social Platform Settings ─────────────────────────────────────────────────

function socialRoutes(url: string, init?: { method?: string }) {
  if (url.startsWith('/api/social-accounts/status')) return ok({ accounts: [], user_role: 'SUPER_ADMIN' });
  if (url === '/api/social-accounts/refresh-tokens') return ok({ ok: true });
  if (url.startsWith('/api/external-apis/company-config')) {
    return init?.method === 'PUT' ? ok({ ok: true }) : ok({ configs: [] });
  }
  if (url.startsWith('/api/external-apis/requests')) {
    if (init?.method && init.method !== 'GET') return ok({ ok: true });
    return ok({ requests: [{ id: 'r1', name: 'NewsAPI', base_url: 'https://newsapi.org', status: 'pending', created_at: '2026-01-01' }] });
  }
  if (url.startsWith('/api/external-apis?')) return ok({ apis: [{ id: 'a1', name: 'SerpAPI', base_url: 'https://serpapi.com', is_active: true }] });
  if (url.startsWith('/api/social-platforms/content-type-prefs')) {
    return init?.method === 'PUT' ? ok({ ok: true }) : ok({ prefs: { linkedin: ['post', 'article'] } });
  }
  return ok({});
}

function SocialProbe() {
  const sp = useSocialPlatforms();
  return (
    <div>
      <span data-testid="sp-prefs">{JSON.stringify(sp.platformContentPrefs)}</span>
      <span data-testid="sp-reqs">{sp.apiRequests.map((r) => `${r.id}:${r.status}`).join(',')}</span>
      <span data-testid="sp-catalog">{sp.catalogApis.length}</span>
      <button data-testid="sp-save" onClick={() => void sp.saveContentPrefs({ linkedin: ['post'] })}>s</button>
      <button data-testid="sp-approve" onClick={() => void sp.updateApiRequestStatus('r1', 'approved')}>a</button>
    </div>
  );
}

describe('Social Platform Settings (Phase 2C)', () => {
  const prefsGets = () => countCalls((u, i) => u.startsWith('/api/social-platforms/content-type-prefs') && isGet(i));
  const requestGets = () => countCalls((u, i) => u.startsWith('/api/external-apis/requests') && isGet(i));

  test('shared cache: two subscribers share prefs/catalog/requests entries; raw status stays per-instance', async () => {
    mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => socialRoutes(url, init));
    render(harness(<><SocialProbe /><SocialProbe /></>));
    await waitFor(() => expect(screen.getAllByTestId('sp-catalog')[0].textContent).toBe('1'));
    expect(prefsGets()).toBe(1);
    expect(requestGets()).toBe(1);
    expect(countCalls((u, i) => u.startsWith('/api/external-apis?') && isGet(i))).toBe(1);
    // Negative control: social-account status was NOT migrated — one per instance.
    expect(countCalls((u, i) => u.startsWith('/api/social-accounts/status') && isGet(i))).toBe(2);
  });

  test('content-prefs PUT writes through the cache with NO GET refetch', async () => {
    mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => socialRoutes(url, init));
    render(harness(<SocialProbe />));
    await waitFor(() => expect(screen.getByTestId('sp-prefs').textContent).toContain('article'));
    const getsBefore = prefsGets();
    await act(async () => { fireEvent.click(screen.getByTestId('sp-save')); });
    await waitFor(() => expect(screen.getByTestId('sp-prefs').textContent).toBe('{"linkedin":["post"]}'));
    expect(countCalls((u, i) => u.startsWith('/api/social-platforms/content-type-prefs') && i?.method === 'PUT')).toBe(1);
    expect(prefsGets()).toBe(getsBefore); // revalidate:false — server was just told
  });

  test('api-request PATCH writes through the cache with NO GET refetch', async () => {
    mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => socialRoutes(url, init));
    render(harness(<SocialProbe />));
    await waitFor(() => expect(screen.getByTestId('sp-reqs').textContent).toBe('r1:pending'));
    const getsBefore = requestGets();
    await act(async () => { fireEvent.click(screen.getByTestId('sp-approve')); });
    await waitFor(() => expect(screen.getByTestId('sp-reqs').textContent).toBe('r1:approved'));
    expect(countCalls((u, i) => u.startsWith('/api/external-apis/requests') && i?.method === 'PATCH')).toBe(1);
    expect(requestGets()).toBe(getsBefore);
  });
});

// ── Activity Workspace ───────────────────────────────────────────────────────

function WorkspaceProbe({
  workspaceKey,
  queryWorkspaceKey = '',
  queryCampaignId = '',
  queryExecutionId = '',
}: {
  workspaceKey: string;
  queryWorkspaceKey?: string;
  queryCampaignId?: string;
  queryExecutionId?: string;
}) {
  const [payload, setPayload] = useState<any>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasTriedHydration, setHasTriedHydration] = useState(false);
  const [isHydratingContext, setIsHydratingContext] = useState(false);
  useActivityWorkspacePersistence({
    routerIsReady: true,
    workspaceKey,
    queryCampaignId,
    queryExecutionId,
    queryWorkspaceKey,
    payload,
    schedules,
    isLoaded,
    hasTriedHydration,
    isHydratingContext,
    setPayload,
    setSchedules,
    setIsLoaded,
    setHasTriedHydration,
    setIsHydratingContext,
    setFinalizedByScheduleId: () => {},
    buildScheduleRows: (_item, existing) => existing,
    normalizeKey: (v) => String(v ?? '').toLowerCase(),
    normalizeComparableText: (v) => String(v ?? '').trim().toLowerCase(),
  });
  return (
    <span data-testid={`ws-${workspaceKey}-${queryWorkspaceKey}`}>
      {isLoaded ? (payload ? `loaded:${payload.title ?? 'payload'}` : 'loaded:none') : 'loading'}
      {hasTriedHydration ? '|tried' : ''}
      {payload?.dailyExecutionItem ? '|hydrated' : ''}
    </span>
  );
}

function MutateButton({ url }: { url: string }) {
  const { mutate } = useSWRConfig();
  return <button data-testid="global-mutate" onClick={() => void mutate(url)}>m</button>;
}

describe('Activity Workspace (Phase 2C)', () => {
  test('resolve: two subscribers share ONE request; loading holds until resolution; payload + storage applied', async () => {
    let resolveIt!: (v: unknown) => void;
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/activity-workspace/resolve?')) {
        return new Promise((r) => { resolveIt = r; });
      }
      return ok({});
    });
    render(harness(
      <>
        <WorkspaceProbe workspaceKey="activity-workspace-abc" queryWorkspaceKey="activity-workspace-abc" />
        <WorkspaceProbe workspaceKey="activity-workspace-abc" queryWorkspaceKey="activity-workspace-abc" />
      </>
    ));
    await waitFor(() =>
      expect(countCalls((u) => u.startsWith('/api/activity-workspace/resolve?'), )).toBe(1)
    );
    const nodes = () => screen.getAllByTestId('ws-activity-workspace-abc-activity-workspace-abc');
    expect(nodes()[0].textContent).toBe('loading|tried'); // hydration flagged, not loaded yet

    await act(async () => {
      resolveIt(ok({ payload: { title: 'Resolved WS', schedules: [] }, workspaceKey: 'activity-workspace-abc' }));
    });
    await waitFor(() => expect(nodes()[0].textContent).toContain('loaded:Resolved WS'));
    expect(countCalls((u) => u.startsWith('/api/activity-workspace/resolve?'))).toBe(1); // still one
    expect(window.sessionStorage.getItem('activity-workspace-abc')).toContain('Resolved WS');
    // Key carries the workspace identity verbatim.
    expect(String(mockApiFetch.mock.calls[0][0])).toBe('/api/activity-workspace/resolve?workspaceKey=activity-workspace-abc');
  });

  test('cache isolation: a different workspace key resolves through its OWN entry', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/activity-workspace/resolve?')) return ok({ payload: { title: 'W', schedules: [] } });
      return ok({});
    });
    render(harness(
      <>
        <WorkspaceProbe workspaceKey="activity-workspace-one" queryWorkspaceKey="activity-workspace-one" />
        <WorkspaceProbe workspaceKey="activity-workspace-two" queryWorkspaceKey="activity-workspace-two" />
      </>
    ));
    await waitFor(() =>
      expect(countCalls((u) => u.startsWith('/api/activity-workspace/resolve?'))).toBe(2)
    );
    const urls = mockApiFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/activity-workspace/resolve?'));
    expect(new Set(urls).size).toBe(2);
  });

  test('weekly/daily hydration: one GET per plan list, campaign-scoped keys, unchanged matching applies context; global mutate refreshes', async () => {
    window.sessionStorage.setItem('ws-h1', JSON.stringify({ campaignId: 'c1', weekNumber: 1, title: 'Topic A', schedules: [] }));
    const weeklyUrl = '/api/campaigns/get-weekly-plans?campaignId=c1';
    const dailyUrl = '/api/campaigns/daily-plans?campaignId=c1';
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === weeklyUrl) return ok([{ weekNumber: 1, execution_items: [{ title: 'Topic A', intent: { objective: 'o' }, writer_content_brief: { topicTitle: 'Topic A' } }] }]);
      if (url === dailyUrl) return ok([]);
      return ok({});
    });
    render(harness(
      <>
        <WorkspaceProbe workspaceKey="ws-h1" />
        <MutateButton url={weeklyUrl} />
      </>
    ));
    await waitFor(() => expect(screen.getByTestId('ws-ws-h1-').textContent).toContain('|tried'));
    expect(screen.getByTestId('ws-ws-h1-').textContent).toContain('|hydrated');
    expect(countCalls((u) => u === weeklyUrl)).toBe(1);
    expect(countCalls((u) => u === dailyUrl)).toBe(1);

    // mutate-driven refresh revalidates the shared entry (guarded apply: no re-hydration).
    await act(async () => { fireEvent.click(screen.getByTestId('global-mutate')); });
    await waitFor(() => expect(countCalls((u) => u === weeklyUrl)).toBe(2));
    expect(countCalls((u) => u === dailyUrl)).toBe(1); // untouched sibling entry
  });
});
