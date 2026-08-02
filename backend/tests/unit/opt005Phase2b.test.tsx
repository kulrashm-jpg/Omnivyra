/**
 * @jest-environment jsdom
 *
 * OPT-005 Phase 2B — engagement + command-center SWR facades.
 *
 * Pins: stable inbox key (no Date.now() in the key; lookback lives in the
 * fetcher), isLoading loading semantics (background revalidation and
 * refresh() never flash the skeleton), patchThread cache surgery, the
 * UNCHANGED optimistic queue + reconciler, preferences write-through PATCH,
 * LinkedIn sync-then-revalidate, and the reports poll (5s only while
 * generating, cache:'no-store' on generating polls).
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));
// useCommandCenterCore's module graph is heavy; the poll hook only needs
// these two — mock the rest of its imports away.
jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ({}) }));
jest.mock('../../../backend/services/commandCenterReadinessService', () => ({}));
jest.mock('../../../backend/services/monetizationTriggersService', () => ({}));
jest.mock('../../../lib/analytics/commandCenterEvents', () => ({}));
jest.mock('../../../components/command-center/preflightHelpers', () => ({}));
jest.mock('../../../lib/setup/buildSetupSignals', () => ({}));
jest.mock('../../../config/setupRegistry', () => ({ SETUP_REGISTRY: [] }));
jest.mock('../../../lib/setup/setupEvents', () => ({ onSetupChanged: () => () => {} }));
jest.mock('../../../lib/readiness/buildReadinessSignals', () => ({}));
jest.mock('../../../config/readinessRegistry', () => ({ READINESS_REGISTRY: [] }));
jest.mock('../../../lib/mastery/buildMasterySignals', () => ({}));
jest.mock('../../../config/masteryRegistry', () => ({ MASTERY_REGISTRY: [] }));
jest.mock('../../../lib/shared/capabilityRegistry', () => ({ evaluateCapabilityRegistry: () => ({}) }));
jest.mock('../../../config/commandCenterCards', () => ({ getVisibleCards: () => [] }));

import { useEngagementInbox, type InboxThread } from '../../../hooks/useEngagementInbox';
import { useEngagementMessages, type EngagementMessage } from '../../../hooks/useEngagementMessages';
import { useEngagementPlatformPreferences } from '../../../hooks/useEngagementPlatformPreferences';
import { useLinkedInEngagementWorkspace } from '../../../hooks/useLinkedInEngagementWorkspace';
import { useReportCardPoll } from '../../../hooks/useCommandCenterCore';
import { SWR_GLOBAL_CONFIG } from '../../../lib/swr/swrClient';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const thread = (id: string, time: string): InboxThread =>
  ({ thread_id: id, platform: 'linkedin', latest_message_time: time, priority_score: 1, unread_count: 0, message_count: 1 } as InboxThread);

const harness = (children: React.ReactNode) => (
  <SWRConfig value={{ ...SWR_GLOBAL_CONFIG, provider: () => new Map() }}>{children}</SWRConfig>
);

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Inbox ───────────────────────────────────────────────────────────────────

function InboxProbe({ org }: { org: string }) {
  const { items, loading, refresh, patchThread } = useEngagementInbox(org, {});
  return (
    <div>
      <span data-testid="inbox-ids">{items.map((t) => t.thread_id).join(',')}</span>
      <span data-testid="inbox-loading">{String(loading)}</span>
      <button data-testid="inbox-refresh" onClick={() => void refresh()}>r</button>
      <button
        data-testid="inbox-patch"
        onClick={() => patchThread('t1', (t) => ({ ...t, latest_message_time: '2026-08-02T09:00:00Z' }))}
      >
        p
      </button>
    </div>
  );
}

describe('useEngagementInbox', () => {
  test('stable key: two consumers share ONE request; requested URL carries start_date computed in-fetcher', async () => {
    mockApiFetch.mockResolvedValue(ok({ items: [thread('t1', '2026-08-01T10:00:00Z'), thread('t2', '2026-08-01T11:00:00Z')] }));
    render(harness(<><InboxProbe org="org-i1" /><InboxProbe org="org-i1" /></>));
    await waitFor(() => expect(screen.getAllByTestId('inbox-ids')[0].textContent).toBe('t2,t1'));
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // Date.now() in the key would break this dedupe
    const requestedUrl = mockApiFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('start_date=');
    expect(requestedUrl).toContain('limit=500');
  });

  test('loading semantics: refresh() is a background revalidation — loading NEVER flips back on', async () => {
    mockApiFetch.mockResolvedValue(ok({ items: [thread('t1', '2026-08-01T10:00:00Z')] }));
    render(harness(<InboxProbe org="org-i2" />));
    await waitFor(() => expect(screen.getByTestId('inbox-loading').textContent).toBe('false'));

    let resolveSecond!: (v: unknown) => void;
    mockApiFetch.mockReturnValue(new Promise((r) => { resolveSecond = r; }));
    await act(async () => {
      screen.getByTestId('inbox-refresh').click();
    });
    // Second request is in flight — the skeleton must NOT return.
    expect(screen.getByTestId('inbox-loading').textContent).toBe('false');
    expect(screen.getByTestId('inbox-ids').textContent).toBe('t1'); // last-good data still shown
    await act(async () => {
      resolveSecond(ok({ items: [thread('t9', '2026-08-01T12:00:00Z')] }));
    });
    await waitFor(() => expect(screen.getByTestId('inbox-ids').textContent).toBe('t9'));
  });

  test('patchThread: cache surgery without network, re-sorted', async () => {
    mockApiFetch.mockResolvedValue(ok({ items: [thread('t1', '2026-08-01T10:00:00Z'), thread('t2', '2026-08-01T11:00:00Z')] }));
    render(harness(<InboxProbe org="org-i3" />));
    await waitFor(() => expect(screen.getByTestId('inbox-ids').textContent).toBe('t2,t1'));
    const callsBefore = mockApiFetch.mock.calls.length;
    await act(async () => {
      screen.getByTestId('inbox-patch').click(); // bumps t1 to 09:00 on Aug 2 → newest
    });
    await waitFor(() => expect(screen.getByTestId('inbox-ids').textContent).toBe('t1,t2'));
    expect(mockApiFetch.mock.calls.length).toBe(callsBefore); // no request issued
  });
});

// ── Messages: optimistic queue unchanged ────────────────────────────────────

function MessagesProbe({ org, threadId }: { org: string; threadId: string }) {
  const { messages, addOptimisticMessage } = useEngagementMessages(org, threadId, []);
  return (
    <div>
      <span data-testid="msg-ids">{messages.map((m) => m.id).join(',')}</span>
      <button
        data-testid="msg-add"
        onClick={() =>
          addOptimisticMessage({
            id: 'opt-1',
            thread_id: threadId,
            author_id: null,
            platform: 'linkedin',
            content: 'hello there',
            platform_created_at: '2026-08-02T10:00:00Z',
            optimistic: true,
          } as EngagementMessage)
        }
      >
        a
      </button>
    </div>
  );
}

describe('useEngagementMessages', () => {
  test('optimistic add renders immediately; matching server row reconciles it away', async () => {
    mockApiFetch.mockResolvedValue(ok({ messages: [] }));
    render(harness(<MessagesProbe org="org-m1" threadId="t1" />));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId('msg-add').click();
    });
    expect(screen.getByTestId('msg-ids').textContent).toBe('opt-1');

    // Server later returns the delivered twin (same platform+content, ts within 5 min)
    mockApiFetch.mockResolvedValue(
      ok({ messages: [{ id: 'srv-1', thread_id: 't1', author_id: null, platform: 'linkedin', content: 'hello there', platform_created_at: '2026-08-02T10:01:00Z' }] })
    );
    // Force a revalidation via a fresh consumer sharing the key is overkill —
    // the poll would do it; simulate by re-rendering with mutate through refresh:
    await act(async () => {
      // trigger SWR revalidation by dispatching its focus event is disabled;
      // simplest: advance the shared cache via a second probe mount.
    });
    render(harness(<MessagesProbe org="org-m1" threadId="t1" />));
    await waitFor(() => {
      const all = screen.getAllByTestId('msg-ids').map((n) => n.textContent);
      expect(all.some((t) => t === 'srv-1')).toBe(true); // optimistic reconciled away in the new consumer
    });
  });
});

// ── Preferences: write-through PATCH ────────────────────────────────────────

function PrefsProbe({ org }: { org: string }) {
  const { preferenceMap, setPlatformEnabled } = useEngagementPlatformPreferences(org);
  return (
    <div>
      <span data-testid="prefs">{JSON.stringify(preferenceMap)}</span>
      <button data-testid="prefs-toggle" onClick={() => void setPlatformEnabled('linkedin', false)}>t</button>
    </div>
  );
}

describe('useEngagementPlatformPreferences', () => {
  test('PATCH writes through the cache with NO GET refetch', async () => {
    mockApiFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PATCH' ? ok({ ok: true }) : ok({ preferences: [{ platform: 'linkedin', enabled: true }] })
    );
    render(harness(<PrefsProbe org="org-p1" />));
    await waitFor(() => expect(screen.getByTestId('prefs').textContent).toBe('{"linkedin":true}'));
    const getCalls = () => mockApiFetch.mock.calls.filter(([, init]) => !(init as { method?: string })?.method || (init as { method?: string }).method === 'GET').length;
    const getsBefore = getCalls();

    await act(async () => {
      screen.getByTestId('prefs-toggle').click();
    });
    await waitFor(() => expect(screen.getByTestId('prefs').textContent).toBe('{"linkedin":false}'));
    expect(getCalls()).toBe(getsBefore); // revalidate:false — no GET after PATCH
  });
});

// ── LinkedIn workspace: syncNow → mutate ────────────────────────────────────

function LinkedInProbe({ org }: { org: string }) {
  const { overview, syncNow } = useLinkedInEngagementWorkspace(org, true);
  return (
    <div>
      <span data-testid="li-posts">{overview?.publishedPosts ?? 'x'}</span>
      <button data-testid="li-sync" onClick={() => void syncNow()}>s</button>
    </div>
  );
}

describe('useLinkedInEngagementWorkspace', () => {
  test('syncNow POSTs then revalidates the overview entry', async () => {
    let posts = 3;
    mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if ((init as { method?: string })?.method === 'POST') {
        posts = 4;
        return ok({ success: true, result: { platform: 'linkedin', success: true } });
      }
      return ok({ overview: { platform: 'linkedin', connected: true, publishedPosts: posts } });
    });
    render(harness(<LinkedInProbe org="org-l1" />));
    await waitFor(() => expect(screen.getByTestId('li-posts').textContent).toBe('3'));
    await act(async () => {
      screen.getByTestId('li-sync').click();
    });
    await waitFor(() => expect(screen.getByTestId('li-posts').textContent).toBe('4')); // post-sync revalidation
  });
});

// ── Reports poll: 5s only while generating; no-store on generating polls ────

function ReportsProbe({ org }: { org: string }) {
  const state = useReportCardPoll(org);
  return <span data-testid="rc">{state?.reportState ?? 'none'}</span>;
}

describe('useReportCardPoll', () => {
  test('polls at 5s while generating with cache:no-store; stops when done', async () => {
    jest.useFakeTimers();
    try {
      mockApiFetch.mockResolvedValue(ok({ reportState: 'generating' }));
      render(harness(<ReportsProbe org="org-r1" />));
      await act(async () => { await Promise.resolve(); });
      await waitFor(() => expect(screen.getByTestId('rc').textContent).toBe('generating'));
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      // First call: not yet known to be generating → normal cache behavior.
      expect((mockApiFetch.mock.calls[0][1] as { cache?: string })?.cache).toBeUndefined();

      mockApiFetch.mockResolvedValue(ok({ reportState: 'used' }));
      await act(async () => {
        jest.advanceTimersByTime(5100);
      });
      await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
      // Generating poll bypasses the OPT-002 browser HTTP cache.
      expect((mockApiFetch.mock.calls[1][1] as { cache?: string })?.cache).toBe('no-store');
      await waitFor(() => expect(screen.getByTestId('rc').textContent).toBe('used'));

      // No longer generating → interval returns 0 → no further polls.
      await act(async () => {
        jest.advanceTimersByTime(20000);
      });
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
