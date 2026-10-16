/**
 * @jest-environment jsdom
 *
 * Closure-015J — the super-admin RBAC tab save.
 *
 * POST /api/super-admin/rbac is wrapped by withIdempotency and gated on identity.admin with
 * step-up, but the tab sent no Idempotency-Key (every save was refused 400
 * IDEMPOTENCY_KEY_REQUIRED) and never ran the step-up ceremony. Pinned: the save goes through
 * performSuperAdminWrite with a FRESH Idempotency-Key per attempt, carries the full replacement
 * config (declared roles + every permission shown), and local state only changes on a
 * confirmed 2xx; a refusal reaches the error banner. The step-up transport
 * (submitSuperAdminWrite) is modelled: refused → elevate → retry once.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

type Init = { method?: string; headers?: Record<string, string>; body?: string };
const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
  clone() { return this; },
}) as unknown as Response;

const ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'CONTENT_CREATOR', 'VIEW_ONLY'];
let posts: Init[] = [];
let postStatus = 200;
const mockFetchWithAuth = jest.fn(async (url: string, init?: Init) => {
  if (!init || !init.method || init.method === 'GET') {
    return json({ roles: ROLES, permissions: { ASSIGN_ROLE: ['SUPER_ADMIN', 'COMPANY_ADMIN'] } });
  }
  posts.push(init);
  const sent = JSON.parse(String(init.body));
  return postStatus === 200 ? json(sent, 200) : json({ error: 'RBAC_ROLES_REQUIRED' }, postStatus);
});
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: (url: string, init?: Init) => mockFetchWithAuth(url, init),
}));
jest.mock('@/utils/getAuthToken', () => ({ getAuthToken: jest.fn(async () => 'token') }));
const mockSubmit = jest.fn();
jest.mock('@/lib/security/superAdminStepUp', () => ({
  submitSuperAdminWrite: (...a: unknown[]) => mockSubmit(...a),
}));

import RbacTab from '../../../components/super-admin/tabs/RbacTab';

beforeEach(() => {
  posts = [];
  postStatus = 200;
  mockFetchWithAuth.mockClear();
  mockSubmit.mockReset();
  mockSubmit.mockImplementation(async (fire: () => Promise<Response>) => {
    await fire();
    const retried = await fire();
    return retried.ok ? { status: 'ok', response: retried } : { status: 'failed', response: retried };
  });
});

async function editAndSave() {
  render(<RbacTab />);
  await waitFor(() => expect(screen.getByText('ASSIGN_ROLE')).toBeTruthy());
  const row = screen.getByText('ASSIGN_ROLE').closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByLabelText('VIEW_ONLY'));
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(posts.length).toBe(2));
}

describe('RBAC tab save → governed write', () => {
  it('every attempt carries a FRESH Idempotency-Key and the full replacement config', async () => {
    await editAndSave();
    const keys = posts.map((p) => p.headers?.['Idempotency-Key']);
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(2);
    for (const p of posts) {
      expect(p.method).toBe('POST');
      expect(JSON.parse(String(p.body))).toEqual({
        roles: ROLES,
        permissions: { ASSIGN_ROLE: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'] },
        expectedVersion: null, // Closure-015L: the GET mock carries no version
      });
    }
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('RBAC permissions updated.')).toBeTruthy());
  });

  it('a refused save shows the error and never reports success', async () => {
    postStatus = 400;
    await editAndSave();
    await waitFor(() => expect(screen.queryByText('RBAC permissions updated.')).toBeNull());
    await waitFor(() => expect(screen.getByText(/RBAC_ROLES_REQUIRED|Request failed/)).toBeTruthy());
  });
});
