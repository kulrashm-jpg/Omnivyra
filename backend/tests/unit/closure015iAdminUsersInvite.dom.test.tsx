/**
 * @jest-environment jsdom
 *
 * Closure-015I (F-3) — /admin/users invites through the governed POST /api/admin/invite-user
 * (the legacy POST /api/users/invite is retired).
 *
 * Pinned: the request goes to /api/admin/invite-user with a FRESH Idempotency-Key per
 * attempt (withIdempotency) through performSuperAdminWrite (step-up ceremony on
 * STEP_UP_REQUIRED, one retry); the invite role list is the governed invitation vocabulary
 * (COMPANY_ADMIN for super-admin viewers only); nothing is sent to /api/users/invite.
 * The step-up transport (submitSuperAdminWrite) is modelled: refused → elevate → retry once.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockContext = { userRole: 'SUPER_ADMIN' as string };
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({
    companies: [{ company_id: 'co-1', name: 'Acme' }],
    selectedCompanyId: 'co-1',
    setSelectedCompanyId: jest.fn(),
    isLoading: false,
    userRole: mockContext.userRole,
  }),
}));
jest.mock('@/lib/utils/safeFetchJson', () => ({
  safeFetchJson: jest.fn(async () => ({ ok: true, data: { users: [] } })),
}));
const mockSubmit = jest.fn();
jest.mock('@/lib/security/superAdminStepUp', () => ({
  submitSuperAdminWrite: (...a: unknown[]) => mockSubmit(...a),
}));

import AdminUsersPage from '../../../pages/admin/users';

type Init = { method?: string; headers?: Record<string, string>; body?: string };
const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
  clone() { return this; },
}) as unknown as Response;

let fetchCalls: Array<[string, Init]> = [];
beforeEach(() => {
  fetchCalls = [];
  mockContext.userRole = 'SUPER_ADMIN';
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: Init) => {
    fetchCalls.push([url, init]);
    return json({ invitationId: 'inv-1' }, 201);
  });
  mockSubmit.mockReset();
  // Model: the first attempt is refused with STEP_UP_REQUIRED; the ceremony elevates; one retry.
  mockSubmit.mockImplementation(async (fire: () => Promise<Response>) => {
    await fire();
    const retried = await fire();
    return { status: 'ok', response: retried };
  });
});

function fillAndInvite(role?: string) {
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.test' } });
  if (role) fireEvent.change(screen.getByDisplayValue('CONTENT_CREATOR'), { target: { value: role } });
  fireEvent.click(screen.getByText('Invite'));
}

describe('/admin/users invite → governed /api/admin/invite-user', () => {
  it('posts to /api/admin/invite-user (never /api/users/invite) with email, companyId and role', async () => {
    render(<AdminUsersPage />);
    fillAndInvite();
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(fetchCalls.every(([url]) => url === '/api/admin/invite-user')).toBe(true);
    expect(fetchCalls.some(([url]) => url === '/api/users/invite')).toBe(false);
    for (const [, init] of fetchCalls) {
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ email: 'new@example.test', companyId: 'co-1', role: 'CONTENT_CREATOR' });
    }
  });

  it('every attempt carries a FRESH Idempotency-Key (the post-step-up retry gets a new one)', async () => {
    render(<AdminUsersPage />);
    fillAndInvite();
    await waitFor(() => expect(fetchCalls).toHaveLength(2));
    const keys = fetchCalls.map(([, init]) => init.headers?.['Idempotency-Key']);
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it('the invite role list is the governed invitation vocabulary; COMPANY_ADMIN for a super-admin viewer', async () => {
    render(<AdminUsersPage />);
    const select = screen.getByDisplayValue('CONTENT_CREATOR') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY', 'COMPANY_ADMIN']);
    for (const legacy of ['CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'ADMIN']) expect(options).not.toContain(legacy);
  });

  it('a company-admin viewer is not offered COMPANY_ADMIN', async () => {
    mockContext.userRole = 'ADMIN';
    render(<AdminUsersPage />);
    const options = Array.from((screen.getByDisplayValue('CONTENT_CREATOR') as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY']);
  });

  it('the selected governed role is sent', async () => {
    render(<AdminUsersPage />);
    fillAndInvite('CONTENT_REVIEWER');
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(JSON.parse(String(fetchCalls[0][1].body)).role).toBe('CONTENT_REVIEWER');
  });

  it('a refused invite surfaces the error and does not report success', async () => {
    // submitSuperAdminWrite classifies a non-2xx, non-step-up response as 'failed' (superAdminAuthFailure).
    mockSubmit.mockImplementation(async () => ({ status: 'failed', response: json({ error: 'role must be one of: …' }, 400) }));
    render(<AdminUsersPage />);
    fillAndInvite();
    await waitFor(() => expect(screen.queryByText('User invited')).toBeNull());
    await waitFor(() => expect(screen.getByText(/role must be one of|Request failed|Not allowed/)).toBeTruthy());
  });
});
