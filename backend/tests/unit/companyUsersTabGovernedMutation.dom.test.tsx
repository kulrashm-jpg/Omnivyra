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
 * a step-up challenge is run at most once, and the post-elevation retry carries
 * a FRESH key. withIdempotency stores the first attempt's step-up denial as a
 * completed response and replays it for a reused key, so a same-key retry never
 * reaches the handler (stepUpRetryIdempotency.test.ts). The refused attempt
 * wrote nothing — requireCapability runs before any write — so a fresh key
 * still yields exactly one mutation. `idempotentServer()` below models that
 * server behaviour so the "exactly once" claim is asserted, not assumed.
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

const STEP_UP_DENIAL = { error: 'Step-up required', code: 'STEP_UP_REQUIRED', capability: 'identity.admin.assign' };

/**
 * Server model for PATCH /api/super-admin/users, faithful to the two facts the
 * contract depends on:
 *   - requireCapability refuses with 401 STEP_UP_REQUIRED BEFORE any write
 *     until the operator is elevated;
 *   - withIdempotency stores every non-5xx response per key and replays it.
 * The step-up helper is modelled as: refused → passkey ceremony (elevate) →
 * retry once.
 */
function idempotentServer() {
  const stored = new Map<string, { status: number; body: unknown }>();
  const state = { elevated: false, mutations: 0 };
  mockFetch.mockImplementation(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    if (init?.method === 'PATCH') {
      const key = init.headers?.['Idempotency-Key'] ?? '';
      if (!stored.has(key)) {
        if (state.elevated) {
          state.mutations += 1;
          stored.set(key, { status: 200, body: { user: { status: 'inactive' } } });
        } else {
          stored.set(key, { status: 401, body: STEP_UP_DENIAL });
        }
      }
      const r = stored.get(key)!;
      return json(r.body, r.status);
    }
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
  mockStepUp.mockImplementation(async (initial: Response, retry: () => Promise<Response>) => {
    if (initial.status !== 401) return { kind: 'success', response: initial };
    state.elevated = true; // passkey ceremony succeeded
    const retried = await retry();
    return retried.ok
      ? { kind: 'success', response: retried }
      : { kind: 'auth_banner', failure: { kind: 'step_up_required' }, response: retried };
  });
  return state;
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

  it('CRITICAL: the post-elevation retry carries a FRESH Idempotency-Key', async () => {
    elevateThenRetry();
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBe(2));

    const [first, second] = patchCalls();
    expect(keyOf(first)).toBeTruthy();
    expect(keyOf(second)).toBeTruthy();
    // A reused key would replay the stored step-up denial instead of reaching
    // the handler; the refused first attempt mutated nothing.
    expect(keyOf(second)).not.toBe(keyOf(first));
  });

  it('CRITICAL: against the idempotent server, the refused attempt does not mutate and the action mutates exactly once', async () => {
    const server = idempotentServer();
    await renderTab();
    fireEvent.click(screen.getByTitle('Make Inactive'));
    await waitFor(() => expect(patchCalls().length).toBe(2));
    await waitFor(() => expect(server.mutations).toBe(1));
    expect(window.alert).not.toHaveBeenCalled();
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

  it('uses a FRESH key across elevation', async () => {
    mockStepUp.mockImplementation(async (_i: Response, retry: () => Promise<Response>) => ({
      kind: 'success', response: await retry(),
    }));
    await renderTab();
    selectRole();
    await waitFor(() => expect(patchCalls().length).toBe(2));
    expect(keyOf(patchCalls()[1])).toBeTruthy();
    expect(keyOf(patchCalls()[1])).not.toBe(keyOf(patchCalls()[0]));
  });

  it('against the idempotent server, the refused attempt does not mutate and the role change applies exactly once', async () => {
    const server = idempotentServer();
    await renderTab();
    selectRole();
    await waitFor(() => expect(patchCalls().length).toBe(2));
    await waitFor(() => expect(server.mutations).toBe(1));
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('a cancelled challenge on the role change issues NO retry and no mutation', async () => {
    const server = idempotentServer();
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'step_up_user_cancelled', failure: { kind: 'step_up_required' }, response: initial,
    }));
    await renderTab();
    selectRole();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('step-up cancelled'));
    expect(patchCalls()).toHaveLength(1);
    expect(server.mutations).toBe(0);
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
