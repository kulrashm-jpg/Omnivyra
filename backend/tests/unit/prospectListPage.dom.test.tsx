/**
 * @jest-environment jsdom
 *
 * WS-10 — Prospect list page DOM tests.
 *
 * Follows the repository's existing `.dom.test.tsx` convention: RTL scoped to one
 * surface, opting into jsdom via the pragma above.
 *
 * The load-bearing assertions are the ones a careless list page would fail:
 * an unscored prospect must not render as "0", a malformed payload must not
 * render as "no prospects", and every row must resolve to the canonical
 * `/prospects/[id]` detail route rather than a re-invented one.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SWRConfig } from 'swr';

const mockApiFetch = jest.fn();
let mockCompanyId = 'company-1';

jest.mock('@/lib/apiFetch', () => ({ apiFetch: (u: string) => mockApiFetch(u) }));
jest.mock('@/components/CompanyContext', () => ({
  useCompanyContext: () => ({ selectedCompanyId: mockCompanyId }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProspectListPage = require('../../../pages/prospects/index').default;

/** Fresh, isolated SWR cache per render so mocked data never bleeds across tests. */
const withSwr = (ui: React.ReactElement) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
);

const row = (over: Record<string, unknown> = {}) => ({
  prospectId: 'p-1',
  personId: 'person-1',
  source: 'crm',
  externalLeadKey: 'CRM-123',
  createdAt: '2026-09-01T10:00:00.000Z',
  qualificationScore: 0,
  scored: false,
  ...over,
});

const result = (rows: unknown[]) => ({
  version: 'ws10.1',
  organizationId: 'company-1',
  rows,
  page: { limit: 50, offset: 0, returned: rows.length },
});

const respond = (body: unknown) => mockApiFetch.mockResolvedValue({ json: async () => body });

beforeEach(() => {
  mockApiFetch.mockReset();
  mockCompanyId = 'company-1';
});

describe('A — prospects render from the API response', () => {
  it('renders a row per prospect returned', async () => {
    respond(result([row(), row({ prospectId: 'p-2', externalLeadKey: 'CRM-456' })]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('CRM-123')).toBeInTheDocument());
    expect(screen.getByText('CRM-456')).toBeInTheDocument();
  });

  it('requests the tenant-scoped endpoint with the selected company', async () => {
    respond(result([row()]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/prospects?companyId=company-1');
  });

  it('renders only fields the API actually returns', async () => {
    respond(result([row()]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('CRM-123')).toBeInTheDocument());
    expect(screen.getByText('crm')).toBeInTheDocument();
  });
});

describe('B — a prospect resolves to /prospects/[id]', () => {
  it('links each row to the canonical detail route', async () => {
    respond(result([row()]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('CRM-123')).toBeInTheDocument());
    expect(screen.getByText('CRM-123').closest('a')).toHaveAttribute('href', '/prospects/p-1');
  });

  it('encodes ids that are not URL-safe', async () => {
    respond(result([row({ prospectId: 'p/1', externalLeadKey: null })]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('p/1')).toBeInTheDocument());
    expect(screen.getByText('p/1').closest('a')).toHaveAttribute('href', '/prospects/p%2F1');
  });
});

describe('C — empty state', () => {
  it('an empty list says there are none, and is not an error', async () => {
    respond(result([]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('No prospects yet')).toBeInTheDocument());
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });
});

describe('D — failure states', () => {
  it('an API failure reports unavailable, never an empty list', async () => {
    mockApiFetch.mockRejectedValue(new Error('503 prospect_repository_unavailable'));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText(/Prospects are unavailable/i)).toBeInTheDocument());
    expect(screen.queryByText('No prospects yet')).not.toBeInTheDocument();
  });

  it('CRITICAL: a malformed payload is unavailable, not "no prospects"', async () => {
    respond({ version: 'ws10.1', organizationId: 'company-1' });
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText(/Prospects are unavailable/i)).toBeInTheDocument());
    expect(screen.queryByText('No prospects yet')).not.toBeInTheDocument();
  });

  it('no company selected reads nothing and asks for one', async () => {
    mockCompanyId = '';
    render(withSwr(<ProspectListPage />));
    expect(screen.getByText(/Select a company/i)).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

describe('E — evidence discipline', () => {
  it('CRITICAL: an unscored prospect reads "Not scored", never 0', async () => {
    respond(result([row({ qualificationScore: 0, scored: false })]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('Not scored')).toBeInTheDocument());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('a scored prospect shows its measured score verbatim', async () => {
    respond(result([row({ qualificationScore: 72, scored: true })]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('72')).toBeInTheDocument());
    expect(screen.queryByText('Not scored')).not.toBeInTheDocument();
  });

  it('a null source renders an em dash, not a blank cell', async () => {
    respond(result([row({ source: null })]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('CRM-123')).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('an unparseable createdAt renders an em dash, never "Invalid Date"', async () => {
    respond(result([row({ createdAt: 'not-a-date' })]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('CRM-123')).toBeInTheDocument());
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('preserves API order — it does not re-rank', async () => {
    respond(result([
      row({ prospectId: 'p-a', externalLeadKey: 'AAA', qualificationScore: 10, scored: true }),
      row({ prospectId: 'p-b', externalLeadKey: 'BBB', qualificationScore: 90, scored: true }),
    ]));
    render(withSwr(<ProspectListPage />));
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    const body = document.body.textContent ?? '';
    expect(body.indexOf('AAA')).toBeLessThan(body.indexOf('BBB'));
  });
});
