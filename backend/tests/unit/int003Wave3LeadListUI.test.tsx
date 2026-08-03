/**
 * @jest-environment jsdom
 *
 * INT-003 Wave 3 — Lead List intelligence columns (presentation only).
 *
 * Pins: badge rendering per DTO field, never_generated/stale/pending states,
 * rows never hidden by absent intelligence, exactly ONE authenticated GET per
 * page (no polling, no background refresh), endpoint-driven sorting and
 * filtering (params pinned; ordering taken from the response), pagination
 * re-reads, zero write operations, malformed-payload and error fail-open,
 * and deterministic ordering.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { CanonicalLeadView } from '../../../lib/leadIntelligence';

const pushMock = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: pushMock, query: {} }) }));

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({ apiFetch: (...a: unknown[]) => mockApiFetch(...a) }));

jest.mock('../../../components/lead-intelligence/leadIntelligenceClient', () => ({
  ...jest.requireActual('../../../components/lead-intelligence/leadIntelligenceClient'),
  fetchLeads: jest.fn(),
  downloadLeadExport: jest.fn(),
}));

import * as client from '../../../components/lead-intelligence/leadIntelligenceClient';
import LeadListPanel from '../../../components/lead-intelligence/LeadListPanel';

const withSwr = (ui: React.ReactElement) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
);

const view = (id: string, email: string): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: { email }, scores: { intent: 0.5 }, status: 'new',
  campaign: null, content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null },
  occurredAt: '2026-08-01T00:00:00Z', sourceRef: { table: 'leads', id },
  attribution: { originalSource: 'form', originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: { email }, sourceMetadata: {} },
} as unknown as CanonicalLeadView);

const intelItem = (leadId: string, over: Record<string, unknown> = {}) => ({
  leadId, status: 'available', freshness: 'fresh', overallScore: 82,
  qualificationBand: 'hot', intentBand: 'high', primaryPersona: 'Founder',
  primarySegment: 'High Intent Buyers', topAction: 'Assign SDR', confidence: 0.8,
  generatedAt: '2026-08-03T12:00:00.000Z', engineVersion: 'lie-1.0.0', ...over,
});

const DEFAULT_ITEMS = [
  intelItem('L1'),
  intelItem('L2', { freshness: 'stale', overallScore: 55, qualificationBand: 'warm', primaryPersona: 'Marketing', intentBand: 'medium', confidence: 0.5, topAction: null }),
  { leadId: 'L3', status: 'never_generated', freshness: 'never_generated', overallScore: null, qualificationBand: null, intentBand: null, primaryPersona: null, primarySegment: null, topAction: null, confidence: null, generatedAt: null, engineVersion: null },
];

let intelResponder: (url: string) => unknown = () => ({ items: DEFAULT_ITEMS, total: 3, limit: 3, offset: 0 });
const intelCalls = (): string[] =>
  mockApiFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/leads/intelligence'));

beforeEach(() => {
  jest.clearAllMocks();
  intelResponder = () => ({ items: DEFAULT_ITEMS, total: 3, limit: 3, offset: 0 });
  mockApiFetch.mockImplementation(async (url: string) => ({
    ok: true, status: 200, json: async () => intelResponder(String(url)),
  }));
  (client.fetchLeads as jest.Mock).mockResolvedValue({
    rows: [view('L1', 'a@x.co'), view('L2', 'b@x.co'), view('L3', 'c@x.co')], total: 3, limit: 25, offset: 0,
  });
});

const renderPanel = () => render(withSwr(<LeadListPanel companyId="co1" />));
const settle = async () => { await screen.findByText('a@x.co'); await waitFor(() => expect(intelCalls().length).toBeGreaterThanOrEqual(1)); };

describe('INT-003 W3 — intelligence columns', () => {
  test('renders score, band chip, persona, intent band, confidence %, top action, freshness badge and generated date', async () => {
    renderPanel();
    await settle();
    await waitFor(() => expect(screen.getAllByTestId('intel-badges').length).toBe(2)); // L1 + L2
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(within(screen.getAllByTestId('intel-badges')[0]).getByText('hot')).toBeInTheDocument();
    expect(screen.getByText('Founder')).toBeInTheDocument();
    expect(screen.getByText('intent: high')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Assign SDR')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('Out of date')).toBeInTheDocument(); // stale row
    expect(screen.getAllByText('2026-08-03').length).toBeGreaterThanOrEqual(1); // generatedAt short date (both available rows carry it)
    expect(screen.getByText('Intelligence')).toBeInTheDocument(); // column header
  });

  test('never_generated row shows the "No intelligence" badge and the row stays fully usable (never hidden)', async () => {
    renderPanel();
    await settle();
    await waitFor(() => expect(screen.getByTestId('intel-empty')).toHaveTextContent('No intelligence'));
    expect(screen.getByText('c@x.co')).toBeInTheDocument(); // the L3 row renders all lead data
  });

  test('pending_regeneration renders its badge', async () => {
    intelResponder = () => ({ items: [intelItem('L1', { freshness: 'pending_regeneration' })], total: 1, limit: 3, offset: 0 });
    renderPanel();
    await settle();
    await waitFor(() => expect(screen.getByText('Refresh queued')).toBeInTheDocument());
  });

  test('exactly ONE authenticated GET per page — no polling, no background refresh, zero writes', async () => {
    renderPanel();
    await settle();
    await waitFor(() => expect(screen.getAllByTestId('intel-badges').length).toBe(2));
    const [url] = intelCalls();
    expect(url).toContain('company_id=co1');
    expect(url).toContain(`ids=${encodeURIComponent('L1,L2,L3')}`);
    expect(url).toContain('limit=3');
    expect(url).toContain('offset=0');
    await new Promise((r) => setTimeout(r, 400)); // longer than the list debounce
    expect(intelCalls().length).toBe(1); // still exactly one — nothing polls
    // zero write operations anywhere
    for (const call of mockApiFetch.mock.calls) {
      const method = (call[1] as { method?: string } | undefined)?.method ?? 'GET';
      expect(method).toBe('GET');
    }
  });

  test('sorting: intelligence sort issues a new GET with sort/order and rows follow the ENDPOINT order', async () => {
    renderPanel();
    await settle();
    intelResponder = () => ({ items: [intelItem('L2', { overallScore: 55 }), intelItem('L1')], total: 2, limit: 3, offset: 0 });
    fireEvent.change(screen.getByTestId('lead-sort'), { target: { value: 'intel:score:asc' } });
    await waitFor(() => expect(intelCalls().length).toBe(2));
    expect(intelCalls()[1]).toContain('sort=score');
    expect(intelCalls()[1]).toContain('order=asc');
    await waitFor(() => {
      const emails = screen.getAllByText(/@x\.co/).map((n) => n.textContent);
      expect(emails).toEqual(['b@x.co', 'a@x.co', 'c@x.co']); // endpoint order L2,L1; L3 (no intel) keeps its place at the end
    });
  });

  test('filtering: band / freshness / min-score hit the endpoint and narrow visible rows to the filtered set', async () => {
    renderPanel();
    await settle();
    intelResponder = () => ({ items: [intelItem('L1')], total: 1, limit: 3, offset: 0 });
    fireEvent.change(screen.getByTestId('intel-band-filter'), { target: { value: 'hot' } });
    await waitFor(() => expect(intelCalls().length).toBe(2));
    expect(intelCalls()[1]).toContain('band=hot');
    await waitFor(() => {
      expect(screen.getByText('a@x.co')).toBeInTheDocument();
      expect(screen.queryByText('b@x.co')).not.toBeInTheDocument();
      expect(screen.queryByText('c@x.co')).not.toBeInTheDocument();
    });

    intelResponder = () => ({ items: [intelItem('L2', { freshness: 'stale' })], total: 1, limit: 3, offset: 0 });
    fireEvent.change(screen.getByTestId('intel-freshness-filter'), { target: { value: 'stale' } });
    await waitFor(() => expect(intelCalls().length).toBe(3));
    expect(intelCalls()[2]).toContain('freshness=stale');

    fireEvent.change(screen.getByTestId('intel-min-score'), { target: { value: '60' } });
    await waitFor(() => expect(intelCalls().length).toBe(4));
    expect(intelCalls()[3]).toContain('min_score=60');
  });

  test('pagination: the next page issues a fresh intelligence GET for the new page ids', async () => {
    (client.fetchLeads as jest.Mock)
      .mockResolvedValueOnce({ rows: [view('L1', 'a@x.co'), view('L2', 'b@x.co'), view('L3', 'c@x.co')], total: 28, limit: 25, offset: 0 })
      .mockResolvedValueOnce({ rows: [view('L4', 'd@x.co')], total: 28, limit: 25, offset: 25 });
    renderPanel();
    await settle();
    fireEvent.click(screen.getByText('Next'));
    await screen.findByText('d@x.co');
    await waitFor(() => expect(intelCalls().length).toBe(2));
    expect(intelCalls()[1]).toContain(`ids=${encodeURIComponent('L4')}`);
  });

  test('malformed payload degrades to empty badges without hiding rows or crashing', async () => {
    intelResponder = () => ({ items: 'not-an-array' });
    renderPanel();
    await settle();
    await waitFor(() => expect(screen.getAllByTestId('intel-empty').length).toBe(3));
    expect(screen.getByText('a@x.co')).toBeInTheDocument();
    expect(screen.getByText('c@x.co')).toBeInTheDocument();
  });

  test('fail-open: a 500 from the intelligence endpoint NEVER hides rows, even with filters active', async () => {
    renderPanel();
    await settle();
    mockApiFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({ error: 'x' }) }));
    fireEvent.change(screen.getByTestId('intel-band-filter'), { target: { value: 'hot' } });
    await waitFor(() => expect(intelCalls().length).toBe(2));
    // all three lead rows remain visible despite the active filter (failed read)
    await waitFor(() => {
      expect(screen.getByText('a@x.co')).toBeInTheDocument();
      expect(screen.getByText('b@x.co')).toBeInTheDocument();
      expect(screen.getByText('c@x.co')).toBeInTheDocument();
    });
  });

  test('deterministic ordering: identical fixtures render identical row order across mounts', async () => {
    renderPanel();
    await settle();
    const first = screen.getAllByText(/@x\.co/).map((n) => n.textContent);
    const second = render(withSwr(<LeadListPanel companyId="co1" />));
    await waitFor(() => expect(second.container.textContent).toContain('a@x.co'));
    const emailsSecond = Array.from(second.container.querySelectorAll('td p'))
      .map((n) => n.textContent)
      .filter((t) => t && t.includes('@x.co'));
    expect(emailsSecond).toEqual(first);
  });
});
