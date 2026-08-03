/**
 * @jest-environment jsdom
 *
 * INT-003A — dashboard hardening characterization.
 *
 * Pins: cohort-scoped title + explanatory subtitle (Gap 1, never implying
 * company-wide analytics), the data-adapter boundary with the bulk adapter
 * preserving Wave 4 behaviour byte-for-byte and an injected adapter driving
 * the SAME UI with zero fetches (Gap 2), and the presence/shape of the
 * technical-debt documentation (Gap 3). No SWR, no polling, no writes.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { CanonicalLeadView } from '../../../lib/leadIntelligence';

const pushMock = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: pushMock, query: {} }) }));

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({ apiFetch: (...a: unknown[]) => mockApiFetch(...a) }));

jest.mock('../../../components/lead-intelligence/leadIntelligenceClient', () => ({
  ...jest.requireActual('../../../components/lead-intelligence/leadIntelligenceClient'),
  fetchLeads: jest.fn(),
}));

import * as client from '../../../components/lead-intelligence/leadIntelligenceClient';
import IntelligenceDashboard from '../../../components/lead-intelligence/IntelligenceDashboard';
import {
  bulkReadDashboardAdapter,
  DASHBOARD_LIMITATIONS,
  DASHBOARD_COHORT_LIMIT,
  type IntelligenceDashboardDataAdapter,
  type DashboardSourceSnapshot,
} from '../../../components/lead-intelligence/dashboardDataAdapter';

const view = (id: string, email: string): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: { email }, scores: { intent: 0.5 }, status: 'new',
  campaign: null, content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null },
  occurredAt: '2026-08-01T00:00:00Z', sourceRef: { table: 'leads', id },
  attribution: { originalSource: 'form', originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: { email }, sourceMetadata: {} },
} as unknown as CanonicalLeadView);

const item = (leadId: string, over: Record<string, unknown> = {}) => ({
  leadId, status: 'available', freshness: 'fresh', overallScore: 80,
  qualificationBand: 'hot', intentBand: 'high', primaryPersona: 'CTO',
  primarySegment: null, topAction: 'Book the demo now', confidence: 0.9,
  generatedAt: '2026-08-03T10:00:00.000Z', engineVersion: 'lie-1.0.0', ...over,
});

const NOW = () => Date.parse('2026-08-03T12:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  (client.fetchLeads as jest.Mock).mockResolvedValue({
    rows: [view('L1', 'a@x.co'), view('L2', 'b@x.co')], total: 42, limit: 100, offset: 0,
  });
  mockApiFetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ items: [item('L1'), item('L2', { overallScore: 60, qualificationBand: 'warm', confidence: 0.7 })], total: 2 }),
  });
});

describe('INT-003A Gap 1 — cohort wording', () => {
  test('title says Latest Lead Intelligence; subtitle names the loaded cohort and disclaims company-wide analytics', async () => {
    render(<IntelligenceDashboard companyId="co1" now={NOW} />);
    await waitFor(() => expect(screen.getByText('Latest Lead Intelligence')).toBeInTheDocument());
    await waitFor(() => {
      const subtitle = screen.getByTestId('dashboard-cohort-subtitle');
      expect(subtitle).toHaveTextContent('currently loaded lead cohort');
      expect(subtitle).toHaveTextContent('the latest 2 of 42 leads');
      expect(subtitle).toHaveTextContent('not company-wide analytics');
    });
    expect(screen.queryByText('Intelligence Dashboard')).not.toBeInTheDocument(); // old title gone
    expect(screen.queryByText(/portfolio/i)).not.toBeInTheDocument(); // no company-wide implication anywhere
  });

  test('loading state uses the cohort wording too', async () => {
    let resolveLeads!: (v: unknown) => void;
    (client.fetchLeads as jest.Mock).mockReturnValue(new Promise((r) => { resolveLeads = r; }));
    render(<IntelligenceDashboard companyId="co1" now={NOW} />);
    expect(screen.getByText('Loading latest lead intelligence…')).toBeInTheDocument();
    resolveLeads({ rows: [], total: 0, limit: 100, offset: 0 });
    await waitFor(() => expect(screen.getByText('No leads to analyze yet.')).toBeInTheDocument());
  });
});

describe('INT-003A Gap 2 — adapter boundary', () => {
  test('default path is unchanged Wave 4 behaviour: cohort read + ONE bulk intelligence GET with the same params', async () => {
    render(<IntelligenceDashboard companyId="co1" now={NOW} />);
    await waitFor(() => expect(screen.getByText('Total Leads')).toBeInTheDocument());
    expect(client.fetchLeads).toHaveBeenCalledWith(
      'co1', expect.any(Object), { limit: DASHBOARD_COHORT_LIMIT, offset: 0 }, { by: 'occurredAt', order: 'desc' },
    );
    const urls = mockApiFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/leads/intelligence'));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('company_id=co1');
    expect(urls[0]).toContain(`ids=${encodeURIComponent('L1,L2')}`);
    expect(urls[0]).toContain('sort=score');
    expect(urls[0]).toContain('order=desc');
    expect(screen.getByTestId('kpi-total-leads')).toHaveTextContent('42');
    expect(screen.getByTestId('kpi-intelligence-generated')).toHaveTextContent('2');
  });

  test('an injected adapter drives the SAME UI with zero network calls (future Aggregate API plug-in point)', async () => {
    const snapshot: DashboardSourceSnapshot = {
      portfolioTotal: 7,
      cohort: new Map([['L9', { leadId: 'L9', leadKey: 'k-l9', label: 'agg@x.co' }]]),
      items: [item('L9', { overallScore: 91 }) as never],
      failed: false,
    };
    const aggregateAdapter: IntelligenceDashboardDataAdapter = {
      id: 'future-server-aggregate',
      serverAggregated: true,
      load: jest.fn(async () => snapshot),
    };
    render(<IntelligenceDashboard companyId="co1" now={NOW} adapter={aggregateAdapter} />);
    await waitFor(() => expect(screen.getByTestId('kpi-total-leads')).toHaveTextContent('7'));
    expect(screen.getByText('agg@x.co')).toBeInTheDocument();
    expect(aggregateAdapter.load).toHaveBeenCalledWith('co1');
    expect(client.fetchLeads).not.toHaveBeenCalled(); // the UI itself performs no acquisition
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('bulk adapter contract: id + serverAggregated pinned; failed reads and thrown errors fail open in the snapshot', async () => {
    expect(bulkReadDashboardAdapter.id).toBe('bulk-read-client-aggregation');
    expect(bulkReadDashboardAdapter.serverAggregated).toBe(false);

    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const failedRead = await bulkReadDashboardAdapter.load('co1');
    expect(failedRead.failed).toBe(true);
    expect(failedRead.items).toEqual([]);
    expect(failedRead.portfolioTotal).toBe(42); // cohort read still reported

    (client.fetchLeads as jest.Mock).mockRejectedValueOnce(new Error('down'));
    const thrown = await bulkReadDashboardAdapter.load('co1');
    expect(thrown.failed).toBe(true);
    expect(thrown.items).toEqual([]);
  });
});

describe('INT-003A Gap 3 — technical-debt documentation', () => {
  test('every mandated limitation is documented WITH a substantive why', () => {
    const limitations = DASHBOARD_LIMITATIONS.map((l) => l.limitation.toLowerCase());
    for (const required of [
      'cohort-based analytics',
      'latest leads only',
      'no portfolio aggregation',
      'no server aggregation',
      'best channel unavailable',
      'raw intent score unavailable',
      'schema version unavailable',
      'generation distribution unavailable',
    ]) {
      expect(limitations).toContain(required);
    }
    for (const entry of DASHBOARD_LIMITATIONS) {
      expect(entry.why.length).toBeGreaterThan(60); // a reason, not a restatement
    }
    // the deferred-aggregation entry names the prepared plug-in point
    const serverAgg = DASHBOARD_LIMITATIONS.find((l) => l.limitation.toLowerCase() === 'no server aggregation')!;
    expect(serverAgg.why).toContain('adapter boundary');
  });
});
