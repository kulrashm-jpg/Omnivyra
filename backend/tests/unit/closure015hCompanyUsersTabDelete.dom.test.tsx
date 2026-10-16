/**
 * @jest-environment jsdom
 *
 * Closure-015H (F-5) — the super-admin tab's delete control speaks the governed
 * contract of DELETE /api/super-admin/users (withIdempotency + identity.admin.delete,
 * phishing-resistant + trusted device).
 *
 * Before: handleDeleteUser sent NO Idempotency-Key and ran no step-up flow, so
 * every "Remove from company" / "Delete unassigned user" failed at the first gate
 * with 400 IDEMPOTENCY_KEY_REQUIRED and could never elevate.
 *
 * Pinned here, following the repository convention established for the tab's
 * PATCH controls (companyUsersTabGovernedMutation.dom.test.tsx,
 * stepUpRetryIdempotency.test.ts): every attempt carries a FRESH key; a step-up
 * challenge is run at most once; the post-elevation retry carries a new key; the
 * delete mutates exactly once; cancel / session-lost surface a message and never
 * report success. idempotentServer() models the server's two relevant facts:
 * requireCapability refuses BEFORE any write until elevated, and withIdempotency
 * stores and replays every non-5xx response per key.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/utils/getAuthToken', () => ({ getAuthToken: jest.fn(async () => 'token') }));
jest.mock('../../../components/super-admin/tabs/RbacTab', () => () => null);
jest.mock('../../../components/super-admin/tabs/CompaniesTable', () => () => null);
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({ fetchWithAuth: jest.fn() }));
jest.mock('@/lib/security/superAdminStepUp', () => ({
  runStepUpFlowIfNeeded: jest.fn(),
  describeStepUpOutcome: jest.fn(() => 'step-up cancelled'),
}));
jest.mock('@/lib/security/superAdminAuthFailure', () => ({
  describeAuthFailure: jest.fn(() => 'session lost'),
}));

import CompanyUsersTab from '../../../components/super-admin/tabs/CompanyUsersTab';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';
import { runStepUpFlowIfNeeded } from '@/lib/security/superAdminStepUp';

const USER = '7fe51fbc-31a8-418b-b69f-ad687109deca';
const LONER = '1b2c3d4e-0000-4000-8000-00000000abcd';
const COMPANY = '0eda0896-7814-4613-8b49-4a8f408e45f1';

const json = (body: unknown, status = 200): Response => {
  const text = JSON.stringify(body);
  const res: Record<string, unknown> = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
  res.clone = () => res as unknown as Response;
  return res as unknown as Response;
};

const mockFetch = fetchWithAuth as jest.Mock;
const mockStepUp = runStepUpFlowIfNeeded as jest.Mock;
type Init = { method?: string; headers?: Record<string, string>; body?: string };
const deleteCalls = () => mockFetch.mock.calls.filter((c) => (c[1] as Init | undefined)?.method === 'DELETE');
const keyOf = (call: unknown[]) => ((call[1] as Init)?.headers ?? {})['Idempotency-Key'];
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as Init)?.body ?? '{}'));

const USERS = [
  { user_id: USER, email: 'target@example.test', company_id: COMPANY, company_name: 'Acme', role: 'CONTENT_CREATOR', status: 'active', account_status: 'active', created_at: '2026-08-21T00:00:00Z' },
  { user_id: LONER, email: 'loner@example.test', company_id: null, company_name: null, role: null, status: null, account_status: 'active', created_at: '2026-08-21T00:00:00Z' },
];
const STEP_UP_DENIAL = { error: 'Step-up required', code: 'STEP_UP_REQUIRED', capability: 'identity.admin.delete' };

function idempotentServer() {
  const stored = new Map<string, { status: number; body: unknown }>();
  const state = { elevated: false, mutations: 0, keylessCalls: 0 };
  mockFetch.mockImplementation(async (url: string, init?: Init) => {
    if (init?.method === 'DELETE') {
      const key = init.headers?.['Idempotency-Key'] ?? '';
      if (!key) { state.keylessCalls += 1; return json({ error: 'Idempotency-Key header required', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400); }
      if (!stored.has(key)) {
        if (state.elevated) {
          state.mutations += 1;
          stored.set(key, { status: 200, body: { success: true } });
        } else {
          stored.set(key, { status: 401, body: STEP_UP_DENIAL });
        }
      }
      const r = stored.get(key)!;
      return json(r.body, r.status);
    }
    if (url.startsWith('/api/super-admin/companies')) return json({ companies: [{ id: COMPANY, name: 'Acme' }] });
    if (url.startsWith('/api/super-admin/users')) return json({ users: USERS });
    return json({});
  });
  mockStepUp.mockImplementation(async (initial: Response, retry: () => Promise<Response>) => {
    if (initial.status !== 401) return { kind: 'success', response: initial };
    state.elevated = true;
    const retried = await retry();
    return retried.ok ? { kind: 'success', response: retried } : { kind: 'auth_banner', failure: { kind: 'step_up_required' }, response: retried };
  });
  return state;
}

async function renderTab() {
  render(<CompanyUsersTab authError={null} />);
  await waitFor(() => expect(screen.getByTitle('Remove from company')).toBeTruthy());
}

beforeEach(() => {
  mockFetch.mockReset();
  mockStepUp.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('CompanyUsersTab — delete speaks the governed contract', () => {
  it('"Remove from company": the request carries an Idempotency-Key and the {userId, companyId} body; never a keyless call', async () => {
    const state = idempotentServer();
    await renderTab();
    fireEvent.click(screen.getByTitle('Remove from company'));
    await waitFor(() => expect(deleteCalls().length).toBeGreaterThan(0));
    for (const c of deleteCalls()) {
      expect(typeof keyOf(c)).toBe('string');
      expect(String(keyOf(c)).length).toBeGreaterThan(0);
      expect(bodyOf(c)).toEqual({ userId: USER, companyId: COMPANY });
    }
    expect(state.keylessCalls).toBe(0);
  });

  it('step-up is run once; the post-elevation retry carries a FRESH key; the delete mutates exactly once; the list reloads', async () => {
    const state = idempotentServer();
    await renderTab();
    const listLoadsBefore = mockFetch.mock.calls.filter((c) => String(c[0]).startsWith('/api/super-admin/users') && !(c[1] as Init | undefined)?.method).length;
    fireEvent.click(screen.getByTitle('Remove from company'));
    await waitFor(() => expect(state.mutations).toBe(1));
    expect(mockStepUp).toHaveBeenCalledTimes(1);
    const calls = deleteCalls();
    expect(calls).toHaveLength(2);
    expect(keyOf(calls[0])).not.toEqual(keyOf(calls[1]));
    await waitFor(() => expect(mockFetch.mock.calls.filter((c) => String(c[0]).startsWith('/api/super-admin/users') && !(c[1] as Init | undefined)?.method).length).toBeGreaterThan(listLoadsBefore));
  });

  it('"Delete unassigned user" sends companyId null through the same governed flow', async () => {
    const state = idempotentServer();
    await renderTab();
    fireEvent.click(screen.getByTitle('Delete unassigned user'));
    await waitFor(() => expect(state.mutations).toBe(1));
    for (const c of deleteCalls()) {
      expect(bodyOf(c)).toEqual({ userId: LONER, companyId: null });
      expect(String(keyOf(c)).length).toBeGreaterThan(0);
    }
  });

  it('step-up cancelled → the outcome message is shown and nothing is mutated', async () => {
    const state = idempotentServer();
    mockStepUp.mockImplementation(async () => ({ kind: 'step_up_user_cancelled' }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Remove from company'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('step-up cancelled'));
    expect(state.mutations).toBe(0);
  });

  it('session lost → the auth-failure message is shown', async () => {
    idempotentServer();
    mockStepUp.mockImplementation(async () => ({ kind: 'session_lost', failure: { kind: 'session_expired' } }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Remove from company'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('session lost'));
  });

  it('a server refusal (e.g. 403 SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE) is surfaced, never reported as success', async () => {
    idempotentServer();
    mockStepUp.mockImplementation(async () => ({
      kind: 'success',
      response: json({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE', details: 'Platform super-admin authority is removed only through the governed revoke flow.' }, 403),
    }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Remove from company'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('governed revoke flow')));
  });
});
