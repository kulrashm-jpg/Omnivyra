/**
 * @jest-environment jsdom
 *
 * "Data sources & usage" panel, rendered.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockApiFetch = jest.fn();
jest.mock('@/lib/apiFetch', () => ({ apiFetch: (u: string, init?: unknown) => mockApiFetch(u, init) }));
let mockCompany: string | null = 'c1';
jest.mock('@/components/CompanyContext', () => ({ useCompanyContext: () => ({ selectedCompanyId: mockCompany }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DataSourceUsagePanel = require('../../../components/prospects/DataSourceUsagePanel').default;
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const T = (o: Record<string, number> = {}) => ({ runs: 0, vendorUnits: 0, vendorUnitsUnknownRuns: 0, creditsCharged: 0, leadsReceived: 0, leadsAdded: 0, leadsUpdated: 0, heldForReview: 0, skippedDuplicates: 0, ...o });
const REPORT = {
  window: { from: '2026-10-11T00:00:00.000Z', to: '2026-11-10T00:00:00.000Z' },
  ledgers: { enrichment: 'ok', discovery: 'ok', capture: 'unavailable' },
  totals: T({ runs: 2, vendorUnits: 2, creditsCharged: 18, leadsAdded: 1 }),
  bySource: [{ source: 'apollo', kind: 'enrichment', ...T({ runs: 2, vendorUnits: 2, creditsCharged: 18, leadsAdded: 1 }) }],
  byUser: [{ userId: 'u1', label: 'Asha', ...T({ runs: 2, vendorUnits: 2, creditsCharged: 18 }) }],
  byDay: [{ day: '2026-11-10', ...T({ runs: 2 }) }],
  runs: [
    { kind: 'enrichment', source: 'apollo', runId: 'e2', at: '2026-11-10T11:00:00Z', userId: 'u1', funding: 'platform', vendorUnits: 1, creditsCharged: 0, outcome: null, leadsReceived: 0, leadsAdded: 0, heldForReview: 0, skippedDuplicates: 0 },
    { kind: 'enrichment', source: 'apollo', runId: 'e1', at: '2026-11-10T10:00:00Z', userId: 'u1', funding: 'tenant', vendorUnits: 1, creditsCharged: 0, outcome: 'enriched', leadsReceived: 0, leadsAdded: 1, heldForReview: 0, skippedDuplicates: 0 },
  ],
};

beforeEach(() => { mockApiFetch.mockReset(); mockCompany = 'c1'; });

it('shows totals, the vendor name, who paid, and a ledger that is not available yet (never as zero)', async () => {
  mockApiFetch.mockResolvedValue(json(200, REPORT));
  render(<DataSourceUsagePanel />);
  await waitFor(() => expect(screen.getByTestId('usage-totals')).toHaveTextContent('18 Omnivyra credits'));
  expect(screen.getByTestId('usage-by-source')).toHaveTextContent('Apollo');
  expect(screen.getByTestId('usage-runs')).toHaveTextContent('Omnivyra credits');
  expect(screen.getByTestId('usage-runs')).toHaveTextContent('Your key');
  expect(screen.getByTestId('usage-gap-capture')).toHaveTextContent('not available yet');
  expect(mockApiFetch.mock.calls[0][0]).toMatch(/^\/api\/prospect-sources\/usage\?companyId=c1&from=.+&to=.+/);
});

it('changing the period re-reads a 7-day window', async () => {
  mockApiFetch.mockResolvedValue(json(200, REPORT));
  render(<DataSourceUsagePanel />);
  await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
  await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
  const u = new URL(`http://x${mockApiFetch.mock.calls[1][0]}`);
  const span = Date.parse(u.searchParams.get('to')!) - Date.parse(u.searchParams.get('from')!);
  expect(Math.round(span / 86_400_000)).toBe(7);
});

it('a failed read says so', async () => {
  mockApiFetch.mockResolvedValue(json(500, {}));
  render(<DataSourceUsagePanel />);
  await waitFor(() => expect(screen.getByText('Usage could not be read.')).toBeInTheDocument());
});

it('no company selected -> renders nothing and reads nothing', () => {
  mockCompany = null;
  const { container } = render(<DataSourceUsagePanel />);
  expect(container).toBeEmptyDOMElement();
  expect(mockApiFetch).not.toHaveBeenCalled();
});

it('a 200 that is not a usage report is a failed read, never a crash', async () => {
  mockApiFetch.mockResolvedValue(json(200, { providers: [] }));
  render(<DataSourceUsagePanel />);
  await waitFor(() => expect(screen.getByText('Usage could not be read.')).toBeInTheDocument());
  expect(screen.queryByTestId('usage-totals')).toBeNull();
});
