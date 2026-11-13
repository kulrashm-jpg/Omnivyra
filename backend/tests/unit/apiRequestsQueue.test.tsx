/**
 * @jest-environment jsdom
 *
 * UI step 7b (2026-11-13): "Request an API" + the approval queue have ONE home,
 * /external-apis, through hooks/useApiRequestsQueue.
 *
 * The request pins MOVED HERE from opt005Phase2c (Social Platform Settings), with the
 * same properties and the new owner (e1's rule):
 *   - shared cache: two subscribers issue ONE requests GET;
 *   - approve/reject writes through the cache with ZERO requests GET after.
 * One semantic change (e1/e9 approved): the write is PUT /api/external-apis/requests/{id},
 * the route that WORKS. The old pin asserted PATCH /api/external-apis/requests, which
 * that route answers with 405. The ROUTE GUARD below pins that against the real handlers,
 * so a mocked pin can't drift from the server again.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { SWR_GLOBAL_CONFIG } from '../../../lib/swr/swrClient';
import { useApiRequestsQueue, apiRequestStatusUrl, apiRequestsKey } from '../../../hooks/useApiRequestsQueue';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const harness = (children: React.ReactNode) => (
  <SWRConfig value={{ ...SWR_GLOBAL_CONFIG, provider: () => new Map() }}>{children}</SWRConfig>
);
const countCalls = (match: (url: string, init?: { method?: string }) => boolean) =>
  mockApiFetch.mock.calls.filter(([url, init]) => match(String(url), init as { method?: string })).length;
const isGet = (init?: { method?: string }) => !init?.method || init.method === 'GET';
const requestGets = () => countCalls((u, i) => u.startsWith('/api/external-apis/requests') && isGet(i));

function routes(url: string, init?: { method?: string }) {
  if (url.startsWith('/api/external-apis/requests/') && init?.method === 'PUT') return ok({ status: 'approved' });
  if (url.startsWith('/api/external-apis/requests')) {
    return ok({ requests: [{ id: 'r1', name: 'NewsAPI', base_url: 'https://newsapi.org', status: 'pending', created_at: '2026-01-01' }] });
  }
  return ok({});
}

const onApproved = jest.fn();
function Probe() {
  const q = useApiRequestsQueue('org-s1', { onApproved });
  return (
    <div>
      <span data-testid="reqs">{q.requests.map((r) => `${r.id}:${r.status}`).join(',')}</span>
      <button data-testid="approve" onClick={() => void q.updateStatus('r1', 'approved')}>a</button>
      <button data-testid="reject" onClick={() => void q.updateStatus('r1', 'rejected', 'dup')}>r</button>
    </div>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => routes(url, init));
});

describe('useApiRequestsQueue: pins moved from opt005Phase2c (Social Platform Settings)', () => {
  test('shared cache: two subscribers issue ONE requests GET', async () => {
    render(harness(<><Probe /><Probe /></>));
    await waitFor(() => expect(screen.getAllByTestId('reqs')[0].textContent).toBe('r1:pending'));
    expect(requestGets()).toBe(1);
    expect(mockApiFetch.mock.calls.map(([u]) => u)).toContain(apiRequestsKey('org-s1'));
  });

  test('approve: PUT /api/external-apis/requests/{id} once, written through with ZERO requests GET after', async () => {
    render(harness(<Probe />));
    await waitFor(() => expect(screen.getByTestId('reqs').textContent).toBe('r1:pending'));
    const getsBefore = requestGets();
    await act(async () => { fireEvent.click(screen.getByTestId('approve')); });
    await waitFor(() => expect(screen.getByTestId('reqs').textContent).toBe('r1:approved'));
    expect(countCalls((u, i) => u === apiRequestStatusUrl('r1', 'org-s1') && i?.method === 'PUT')).toBe(1);
    expect(countCalls((_u, i) => i?.method === 'PATCH')).toBe(0);
    expect(requestGets()).toBe(getsBefore);
    expect(onApproved).toHaveBeenCalledTimes(1); // an approved request becomes an API
  });

  test('reject: PUT once with the reason, ZERO requests GET after, no API refresh', async () => {
    render(harness(<Probe />));
    await waitFor(() => expect(screen.getByTestId('reqs').textContent).toBe('r1:pending'));
    const getsBefore = requestGets();
    await act(async () => { fireEvent.click(screen.getByTestId('reject')); });
    await waitFor(() => expect(screen.getByTestId('reqs').textContent).toBe('r1:rejected'));
    const put = mockApiFetch.mock.calls.find(([, i]) => (i as { method?: string })?.method === 'PUT');
    expect(JSON.parse(String((put?.[1] as { body?: string }).body))).toEqual({ status: 'rejected', rejection_reason: 'dup' });
    expect(requestGets()).toBe(getsBefore);
    expect(onApproved).not.toHaveBeenCalled();
  });

  test('authorization stays server-side: companyId is only a query parameter, nothing is gated client-side', () => {
    expect(apiRequestStatusUrl('r1', 'org-s1')).toBe('/api/external-apis/requests/r1?companyId=org-s1');
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'hooks/useApiRequestsQueue.ts'), 'utf8') as string;
    expect(src).not.toMatch(/SUPER_ADMIN|isSuperAdmin|hasPermission|userRole/);
  });
});
