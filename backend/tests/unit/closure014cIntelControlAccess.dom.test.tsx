/**
 * @jest-environment jsdom
 *
 * Closure-014C (Finding E) — /admin/intelligence-control must render for a
 * canonical platform SUPER_ADMIN.
 *
 * Closure-014B: the page gated on the CLIENT role from CompanyContext, which
 * deliberately downgrades a 'SUPER_ADMIN' membership to 'COMPANY_ADMIN' under a
 * normal Supabase session (components/CompanyContext.tsx normalizeCompanyRole),
 * so a real super admin saw "Loading intelligence control…" forever.
 *
 * The page now asks the SERVER: its own data read (GET scheduler-config,
 * super_admin.dashboard.view). Rendering grants nothing — every write on the
 * page stays behind intelligence.override.manage + the central platform guard
 * + passkey step-up on the server.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockCtx = { userRole: 'COMPANY_ADMIN', companies: [] as unknown[], selectedCompanyId: null };
jest.mock('../../../components/CompanyContext', () => ({ __esModule: true, useCompanyContext: () => mockCtx }));
jest.mock('../../../lib/security/stepUpClient', () => ({ triggerWebAuthnStepUp: jest.fn() }));

import IntelControlPage from '../../../components/admin/intelligenceControlMain';

type Reply = { status: number; body?: unknown } | 'network';
let probeReply: Reply;
let calls: Array<{ url: string; method: string }> = [];
function res(status: number, body: unknown = {}): Response {
  const make = (): unknown => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body), clone: () => make() });
  return make() as Response;
}

beforeEach(() => {
  calls = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/api/admin/intelligence/scheduler-config') && method === 'GET') {
      if (probeReply === 'network') throw new TypeError('Failed to fetch');
      return res(probeReply.status, probeReply.body ?? { configs: [] });
    }
    return res(200, {});
  });
});

it('a canonical SUPER_ADMIN whose client role CompanyContext downgraded to COMPANY_ADMIN: the page renders', async () => {
  probeReply = { status: 200, body: { configs: [] } };
  render(<IntelControlPage />);
  expect(await screen.findByRole('button', { name: /Global Config/ })).toBeInTheDocument();
  expect(screen.queryByText('Loading intelligence control…')).not.toBeInTheDocument();
});

it('a tenant user without the capability (403): access denied, no tabs, no writes', async () => {
  probeReply = { status: 403, body: { code: 'CAPABILITY_NOT_HELD' } };
  render(<IntelControlPage />);
  expect(await screen.findByText(/does not have access to intelligence control/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Global Config/ })).not.toBeInTheDocument();
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
});

it('a signed-out user (401): asked to sign in, no tabs', async () => {
  probeReply = { status: 401, body: { code: 'NOT_AUTHENTICATED' } };
  render(<IntelControlPage />);
  expect(await screen.findByText(/Sign in again/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Global Config/ })).not.toBeInTheDocument();
});

it('a server error (500): a data-fetch error with Retry, never an endless loader and never the tabs', async () => {
  probeReply = { status: 500, body: { error: 'db down' } };
  render(<IntelControlPage />);
  expect(await screen.findByText(/Could not load intelligence control \(HTTP 500\)/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Global Config/ })).not.toBeInTheDocument();
  probeReply = { status: 200, body: { configs: [] } };
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: /Global Config/ })).toBeInTheDocument();
});

it('a network failure: a data-fetch error, no tabs', async () => {
  probeReply = 'network';
  render(<IntelControlPage />);
  expect(await screen.findByText(/Network error while loading intelligence control/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Global Config/ })).not.toBeInTheDocument();
});

it('rendering the page for an allowed user issues no write request (rendering grants no write authority)', async () => {
  probeReply = { status: 200, body: { configs: [] } };
  render(<IntelControlPage />);
  await screen.findByRole('button', { name: /Global Config/ });
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
});
