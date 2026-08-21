/**
 * @jest-environment jsdom
 *
 * Phase 2Z-BI — the super-admin membership controls must speak the governed
 * API contract.
 *
 * `/api/super-admin/users` PATCH is wrapped in withIdempotency and gated on
 * identity.admin.assign (phishing-resistant + trusted device). The tab's
 * status and role controls previously sent neither an Idempotency-Key nor any
 * step-up orchestration, so they failed at the first gate with
 * 400 IDEMPOTENCY_KEY_REQUIRED and could never elevate.
 *
 * These pin the client half of that contract: every mutation carries a key,
 * a step-up challenge is run at most once, and the retry reuses the SAME key
 * so elevation cannot turn one logical action into two mutations.
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
const COMPANY = '0eda0896-7814-4613-8b49-4a8f408e45f1';

/** Minimal Response double — jsdom in this repo has no global Response. */
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

/** Read the Idempotency-Key from a recorded fetchWithAuth call. */
const keyOf = (call: unknown[]) =>
  ((call[1] as { headers?: Record<string, string> })?.headers ?? {})['Idempotency-Key'];

const patchCalls = () => mockFetch.mock.calls.filter((c) => (c[1] as { method?: string })?.method === 'PATCH');

function seedLoad() {
  mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') return json({ user: { status: 'active' } });
    if (url.startsWith('/api/super-admin/companies')) {
      return json({ companies: [{ id: COMPANY, name: 'Ingestion Activation Test' }] });
    }
    if (url.startsWith('/api/super-admin/users')) {
      return json({ users: [{
        user_id: USER, email: 'target@example.test', company_id: COMPANY,
        company_name: 'Ingestion Activation Test', role: 'COMPANY_ADMIN',
        status: 'active', account_status: 'active', created_at: '2026-08-21T00:00:00Z',
      }] });
    }
    return json({});
  });
}

/** Render and wait for the seeded membership row to appear. */
async function renderTab() {
  render(<CompanyUsersTab authError={null} />);
  await waitFor(() => expect(screen.getByTitle('Make Inactive')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  seedLoad();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  // Default: the first response is fine — no challenge.
  mockStepUp.mockImplementation(async (initial: Response) => ({ kind: 'success', response: initial }));
});

describe('status mutation — governed contract', () => {
  it('CRITICAL: the PATCH carries an Idempotency-Key', async () => {
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    expect(keyOf(patchCalls()[0])).toBeTruthy();
  });

  it('400 IDEMPOTENCY_KEY_REQUIRED is now unreachable — every mutation is keyed', async () => {
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    for (const call of patchCalls()) expect(keyOf(call)).toBeTruthy();
  });

  it('sends only userId/companyId/status — no role field leaks in', async () => {
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    const body = JSON.parse((patchCalls()[0][1] as { body: string }).body);
    expect(body).toEqual({ userId: USER, companyId: COMPANY, status: 'inactive' });
    expect(body).not.toHaveProperty('role');
  });

  it('the mutation is routed through the step-up orchestrator', async () => {
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1));
  });

  it('a successful first response performs no retry', async () => {
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1));
    expect(patchCalls()).toHaveLength(1);
  });
});

describe('step-up elevation', () => {
  /** Simulate the helper: 401 → passkey ceremony → retry the SAME request once. */
  const elevateThenRetry = () =>
    mockStepUp.mockImplementation(async (_initial: Response, retry: () => Promise<Response>) => ({
      kind: 'success', response: await retry(),
    }));

  it('CRITICAL: the post-elevation retry reuses the SAME Idempotency-Key', async () => {
    elevateThenRetry();
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBe(2));

    const [first, second] = patchCalls();
    expect(keyOf(first)).toBeTruthy();
    // Same key ⇒ the server treats the retry as a replay, not a second
    // mutation. A fresh key here would mutate twice after one click.
    expect(keyOf(second)).toBe(keyOf(first));
  });

  it('elevation produces exactly ONE retry, not a loop', async () => {
    elevateThenRetry();
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBe(2));
    expect(patchCalls()).toHaveLength(2);
    expect(mockStepUp).toHaveBeenCalledTimes(1);
  });

  it('the retried request is byte-identical to the first', async () => {
    elevateThenRetry();
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBe(2));
    const [a, b] = patchCalls();
    expect((b[1] as { body: string }).body).toBe((a[1] as { body: string }).body);
    expect(b[0]).toBe(a[0]);
  });

  it('a cancelled challenge surfaces the failure and issues NO retry', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'step_up_user_cancelled', failure: { kind: 'step_up_required' }, response: initial,
    }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1));
    expect(patchCalls()).toHaveLength(1);
    expect(window.alert).toHaveBeenCalledWith('step-up cancelled');
  });

  it('an unavailable authenticator does not retry either', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'step_up_unavailable', failure: { kind: 'step_up_required' }, response: initial, reason: 'no authenticator',
    }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(patchCalls()).toHaveLength(1);
  });

  it('a lost session is reported without retrying', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'session_lost', failure: { kind: 'not_authenticated' }, response: initial,
    }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('session lost'));
    expect(patchCalls()).toHaveLength(1);
  });
});

describe('error behaviour is preserved', () => {
  it("a non-auth API failure still surfaces the server's own detail", async () => {
    mockStepUp.mockImplementation(async () => ({
      kind: 'success',
      response: json({ error: 'USER_NOT_FOUND', details: 'No role record found' }, 404),
    }));
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Error: No role record found'));
  });

  it('a confirm() decline performs no request at all', async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(mockStepUp).not.toHaveBeenCalled());
    expect(patchCalls()).toHaveLength(0);
  });
});

describe('role mutation — same governed contract', () => {
  const selectRole = () => {
    const select = document.querySelector('select[class*="border"]') as HTMLSelectElement | null;
    if (!select) throw new Error('role select not rendered');
    fireEvent.change(select, { target: { value: 'CONTENT_CREATOR' } });
  };

  it('CRITICAL: the role PATCH carries an Idempotency-Key', async () => {
    await renderTab();
    selectRole();
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    expect(keyOf(patchCalls()[0])).toBeTruthy();
  });

  it('is routed through the step-up orchestrator', async () => {
    await renderTab();
    selectRole();
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1));
  });

  it('reuses the SAME key across elevation', async () => {
    mockStepUp.mockImplementation(async (_i: Response, retry: () => Promise<Response>) => ({
      kind: 'success', response: await retry(),
    }));
    await renderTab();
    selectRole();
    await waitFor(() => expect(patchCalls().length).toBe(2));
    expect(keyOf(patchCalls()[1])).toBe(keyOf(patchCalls()[0]));
  });

  it('sends only userId/companyId/role — no status field leaks in', async () => {
    await renderTab();
    selectRole();
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    const body = JSON.parse((patchCalls()[0][1] as { body: string }).body);
    expect(body).toEqual({ userId: USER, companyId: COMPANY, role: 'CONTENT_CREATOR' });
    expect(body).not.toHaveProperty('status');
  });
});
