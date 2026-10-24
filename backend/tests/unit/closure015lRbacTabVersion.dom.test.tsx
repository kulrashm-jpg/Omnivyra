/**
 * @jest-environment jsdom
 *
 * Closure-015L — the RBAC tab carries the stale-edit token.
 *
 * GET /api/super-admin/rbac returns `version`; the tab sends it back as `expectedVersion` on save,
 * adopts the version the server returns after a confirmed save, and surfaces a 409
 * RBAC_CONFIG_STALE (another administrator saved first) without reporting success. Transport is
 * modelled as in closure015jRbacTabSave: performSuperAdminWrite → submitSuperAdminWrite (refused →
 * elevate → retry once), so each save is two POSTs with fresh Idempotency-Keys.
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
let serverVersion = 7;
let stale = false;
const mockFetchWithAuth = jest.fn(async (_url: string, init?: Init) => {
  if (!init || !init.method || init.method === 'GET') {
    return json({ roles: ROLES, permissions: { ASSIGN_ROLE: ['SUPER_ADMIN', 'COMPANY_ADMIN'] }, version: serverVersion });
  }
  posts.push(init);
  if (stale) {
    return json({ error: 'RBAC_CONFIG_STALE', message: 'The RBAC configuration was changed by another administrator. Reload it and re-apply your edit.', currentVersion: serverVersion + 1 }, 409);
  }
  const sent = JSON.parse(String(init.body));
  return json({ roles: sent.roles, permissions: sent.permissions, version: serverVersion + 1 }, 200);
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
  serverVersion = 7;
  stale = false;
  mockFetchWithAuth.mockClear();
  mockSubmit.mockReset();
  mockSubmit.mockImplementation(async (fire: () => Promise<Response>) => {
    await fire();
    const retried = await fire();
    return retried.ok ? { status: 'ok', response: retried } : { status: 'failed', response: retried };
  });
});

async function toggle(role: string) {
  const row = screen.getByText('ASSIGN_ROLE').closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByLabelText(role));
}

describe('RBAC tab — stale-edit token', () => {
  it('sends the loaded version as expectedVersion, then adopts the version the server returns', async () => {
    render(<RbacTab />);
    await waitFor(() => expect(screen.getByText('ASSIGN_ROLE')).toBeTruthy());
    await toggle('VIEW_ONLY');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(posts.length).toBe(2));
    for (const p of posts) expect(JSON.parse(String(p.body))).toMatchObject({ expectedVersion: 7 });
    await waitFor(() => expect(screen.getByText('RBAC permissions updated.')).toBeTruthy());

    // next edit uses the server's new version (8), not the stale 7
    posts = [];
    await toggle('CONTENT_CREATOR');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(posts.length).toBe(2));
    for (const p of posts) expect(JSON.parse(String(p.body))).toMatchObject({ expectedVersion: 8 });
  });

  it('a 409 RBAC_CONFIG_STALE is shown and never reported as saved', async () => {
    stale = true;
    render(<RbacTab />);
    await waitFor(() => expect(screen.getByText('ASSIGN_ROLE')).toBeTruthy());
    await toggle('VIEW_ONLY');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(posts.length).toBe(2));
    // the shared describeWriteFailure convention: "Conflict: <error code> Refresh and try again."
    await waitFor(() => expect(screen.getByText(/Conflict: RBAC_CONFIG_STALE/)).toBeTruthy());
    expect(screen.queryByText('RBAC permissions updated.')).toBeNull();
  });
});
