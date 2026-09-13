/**
 * @jest-environment jsdom
 *
 * STEP 3AH-46 K1 — the Super Admin email actions (create user + invite,
 * resend invitation) call routes gated on identity.admin.assign
 * (phishing-resistant passkey on a trusted device, 10-min freshness). They
 * must run the established step-up orchestrator (runStepUpFlowIfNeeded) so a
 * refused first attempt triggers the passkey ceremony instead of an alert.
 *
 * The post-elevation retry carries a FRESH Idempotency-Key. /api/super-admin/
 * users/create is wrapped in withIdempotency, which replays a stored step-up
 * denial for a reused key (stepUpRetryIdempotency.test.ts); the refused first
 * attempt wrote nothing because requireCapability runs before any write, so a
 * fresh key cannot produce a second mutation.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/utils/getAuthToken', () => ({ getAuthToken: jest.fn(async () => 'token') }));
jest.mock('../../../components/super-admin/tabs/RbacTab', () => () => null);
jest.mock('../../../components/super-admin/tabs/CompaniesTable', () => (props: { setSelectedCompanyId: (id: string) => void }) =>
  require('react').createElement(
    'button',
    { onClick: () => props.setSelectedCompanyId('0eda0896-7814-4613-8b49-4a8f408e45f1') },
    'select-company',
  ));
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
const INVITATION = '5b1d2a3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const INVITEE = 'invitee@example.test';
const NEW_USER = 'new.admin@example.test';

/** Minimal Response double — jsdom in this repo has no global Response. */
const json = (body: unknown, status = 200): Response => {
  const text = JSON.stringify(body);
  const res: Record<string, unknown> = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
  res.clone = () => res as unknown as Response;
  return res as unknown as Response;
};

const mockFetch = fetchWithAuth as jest.Mock;
const mockStepUp = runStepUpFlowIfNeeded as jest.Mock;

const keyOf = (call: unknown[]) =>
  ((call[1] as { headers?: Record<string, string> })?.headers ?? {})['Idempotency-Key'];
const postsTo = (prefix: string) =>
  mockFetch.mock.calls.filter((c) => (c[1] as { method?: string })?.method === 'POST' && String(c[0]).startsWith(prefix));
const createCalls = () => postsTo('/api/super-admin/users/create');
const resendCalls = () => postsTo(`/api/super-admin/invitations/${INVITATION}/resend`);

const STEP_UP_DENIAL = { error: 'Step-up required', code: 'STEP_UP_REQUIRED', capability: 'identity.admin.assign' };

/** First mutation attempt is refused with a step-up denial; later ones succeed. */
function seed() {
  let createAttempts = 0;
  let resendAttempts = 0;
  mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && url === '/api/super-admin/users/create') {
      createAttempts += 1;
      return createAttempts === 1
        ? json(STEP_UP_DENIAL, 401)
        : json({
          user: { email: NEW_USER, status: 'invited' },
          invitation: { mode: 'magic_link', id: 'inv-2' },
          delivery: { status: 'queued', job_id: 'job-12345678', queue_error: null },
        }, 201);
    }
    if (init?.method === 'POST' && url.endsWith('/resend')) {
      resendAttempts += 1;
      return resendAttempts === 1
        ? json(STEP_UP_DENIAL, 401)
        : json({ invitation_id: INVITATION, delivery: { status: 'queued', job_id: 'job-2' } }, 202);
    }
    if (url.startsWith('/api/super-admin/companies')) {
      return json({ companies: [{ id: COMPANY, name: 'Email Step-up Test Co' }] });
    }
    if (url.startsWith('/api/super-admin/invitations')) {
      return json({ invitations: [{ id: INVITATION, email: INVITEE, delivery_state: 'failed', latest_job: { retry_count: 1, max_retries: 5 } }] });
    }
    if (url.startsWith('/api/super-admin/users')) {
      return json({ users: [{
        user_id: USER, email: INVITEE, company_id: COMPANY, company_name: 'Email Step-up Test Co',
        role: 'COMPANY_ADMIN', status: 'invited', account_status: 'active', created_at: '2026-09-13T00:00:00Z',
      }] });
    }
    return json({});
  });
}

/** Simulate the helper: refused → passkey ceremony → retry once. */
const elevateThenRetry = () =>
  mockStepUp.mockImplementation(async (_initial: Response, retry: () => Promise<Response>) => ({
    kind: 'success', response: await retry(),
  }));

async function openCreateUserAndSubmit() {
  render(<CompanyUsersTab authError={null} />);
  fireEvent.click(await screen.findByText('select-company'));
  fireEvent.click(screen.getByText('Add User'));
  const email = document.querySelector('input[type="email"]') as HTMLInputElement;
  fireEvent.change(email, { target: { value: NEW_USER } });
  fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
}

async function clickResend() {
  render(<CompanyUsersTab authError={null} />);
  fireEvent.click(await screen.findByTitle('Resend invitation email'));
}

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  mockStepUp.mockImplementation(async (initial: Response) => ({ kind: 'success', response: initial }));
});

describe('create user + invite — step-up orchestration', () => {
  it('is routed through the step-up orchestrator and every attempt is keyed', async () => {
    elevateThenRetry();
    await openCreateUserAndSubmit();
    await waitFor(() => expect(createCalls()).toHaveLength(2));
    expect(mockStepUp).toHaveBeenCalledTimes(1);
    for (const c of createCalls()) expect(keyOf(c)).toBeTruthy();
  });

  it('after elevation: exactly one retry, byte-identical body, FRESH key, and the queued result is shown', async () => {
    elevateThenRetry();
    await openCreateUserAndSubmit();
    await waitFor(() => expect(createCalls()).toHaveLength(2));
    const [first, retry] = createCalls();
    expect((retry[1] as { body: string }).body).toBe((first[1] as { body: string }).body);
    expect(keyOf(retry)).not.toBe(keyOf(first));
    expect(await screen.findByText(`User created: ${NEW_USER}`)).toBeTruthy();
    expect(screen.getByText('queued')).toBeTruthy();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('a cancelled passkey challenge surfaces the outcome and issues NO retry', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'step_up_user_cancelled', failure: { kind: 'step_up_required' }, response: initial,
    }));
    await openCreateUserAndSubmit();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('step-up cancelled'));
    expect(createCalls()).toHaveLength(1);
    expect(screen.queryByText(`User created: ${NEW_USER}`)).toBeNull();
  });

  it('an unavailable authenticator issues NO retry', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'step_up_unavailable', failure: { kind: 'step_up_required' }, response: initial, reason: 'no passkey',
    }));
    await openCreateUserAndSubmit();
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(createCalls()).toHaveLength(1);
  });

  it('a lost session is reported without retrying', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'session_lost', failure: { kind: 'not_authenticated' }, response: initial,
    }));
    await openCreateUserAndSubmit();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('session lost'));
    expect(createCalls()).toHaveLength(1);
  });

  it('a request still refused after elevation surfaces the server error, not a success', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'auth_banner', failure: { kind: 'capability_not_held' }, response: initial,
    }));
    await openCreateUserAndSubmit();
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.queryByText(`User created: ${NEW_USER}`)).toBeNull();
  });
});

describe('resend invitation — step-up orchestration', () => {
  it('after elevation: exactly one retry with a FRESH key, then the list reloads', async () => {
    elevateThenRetry();
    await clickResend();
    await waitFor(() => expect(resendCalls()).toHaveLength(2));
    expect(mockStepUp).toHaveBeenCalledTimes(1);
    const [first, retry] = resendCalls();
    expect(keyOf(first)).toBeTruthy();
    expect(keyOf(retry)).toBeTruthy();
    expect(keyOf(retry)).not.toBe(keyOf(first));
    await waitFor(() => {
      const listLoads = mockFetch.mock.calls.filter((c) => String(c[0]).startsWith('/api/super-admin/invitations?status=pending'));
      expect(listLoads.length).toBeGreaterThanOrEqual(2);
    });
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('a cancelled passkey challenge surfaces the outcome and issues NO retry', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'step_up_user_cancelled', failure: { kind: 'step_up_required' }, response: initial,
    }));
    await clickResend();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('step-up cancelled'));
    expect(resendCalls()).toHaveLength(1);
  });

  it('a lost session is reported without retrying', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'session_lost', failure: { kind: 'not_authenticated' }, response: initial,
    }));
    await clickResend();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('session lost'));
    expect(resendCalls()).toHaveLength(1);
  });

  it('a request still refused after elevation surfaces the server error', async () => {
    mockStepUp.mockImplementation(async (initial: Response) => ({
      kind: 'auth_banner', failure: { kind: 'capability_not_held' }, response: initial,
    }));
    await clickResend();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Resend failed')));
  });
});
