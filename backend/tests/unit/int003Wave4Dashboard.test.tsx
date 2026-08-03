/**
 * @jest-environment jsdom
 *
 * INT-003 Wave 4 — Intelligence Dashboard characterization.
 *
 * Presentation-only: two authenticated GETs (cohort via the existing leads
 * client + ONE bulk intelligence read), every displayed number a count/mean of
 * persisted DTO values, filters pure selection (never refetch), rows navigate
 * to the existing Lead Detail page. Network seams mocked and recorded —
 * zero writes, no polling, deterministic (injected clock).
 */

const mockCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
let mockBulkResponder: () => { ok: boolean; status: number; body: unknown };

jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    mockCalls.push({ url, init });
    const r = mockBulkResponder();
    return { ok: r.ok, status: r.status, json: async () => r.body };
  },
}));

const mockFetchLeads = jest.fn();
jest.mock('../../../components/lead-intelligence/leadIntelligenceClient', () => ({
  ...jest.requireActual('../../../components/lead-intelligence/leadIntelligenceClient'),
  fetchLeads: (...args: unknown[]) => mockFetchLeads(...args),
}));

const pushMock = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: pushMock, query: {} }) }));

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import IntelligenceDashboard from '../../../components/lead-intelligence/IntelligenceDashboard';
import { leadKeyFor } from '../../../lib/leadIntelligence';
import type { LeadIntelligenceListItemDTO } from '../../services/leadIntelligenceReadApi';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const CO = 'co-1';

const view = (id: string, email: string) =>
  ({
    source: 'website',
    sourceRef: { table: 'leads', id },
    unifiedPersonId: `up-${id}`,
    identity: { email },
    occurredAt: '2026-08-01T00:00:00.000Z',
  }) as never;

const cohortViews = [view('L1', 'ceo@hot.com'), view('L2', 'dev@warm.com'), view('L3', 'ops@cool.com'), view('L4', 'new@none.com')];

const item = (over: Partial<LeadIntelligenceListItemDTO>): LeadIntelligenceListItemDTO => ({
  leadId: 'L?',
  status: 'available',
  freshness: 'fresh',
  overallScore: null,
  qualificationBand: null,
  intentBand: null,
  primaryPersona: null,
  primarySegment: null,
  topAction: null,
  confidence: null,
  generatedAt: null,
  engineVersion: null,
  ...over,
});

const ITEMS: LeadIntelligenceListItemDTO[] = [
  item({ leadId: 'L1', overallScore: 80, qualificationBand: 'hot', intentBand: 'high', primaryPersona: 'CTO', confidence: 0.9, freshness: 'fresh', generatedAt: '2026-08-03T09:00:00.000Z', engineVersion: 'lie-2.0.0', topAction: 'Book the demo now' }),
  item({ leadId: 'L2', overallScore: 60, qualificationBand: 'warm', intentBand: 'medium', primaryPersona: 'Developer', confidence: 0.7, freshness: 'stale', generatedAt: '2026-07-30T09:00:00.000Z', engineVersion: 'lie-2.0.0', topAction: 'Personalized follow-up' }),
  item({ leadId: 'L3', overallScore: 30, qualificationBand: 'cool', intentBand: 'low', primaryPersona: 'CTO', confidence: 0.4, freshness: 'pending_regeneration', generatedAt: '2026-07-10T09:00:00.000Z', engineVersion: 'lie-1.0.0', topAction: 'Send the top recommended content and re-score after next visit' }),
  item({ leadId: 'L4', status: 'never_generated', freshness: 'never_generated' }),
];

beforeEach(() => {
  mockCalls.length = 0;
  pushMock.mockReset();
  mockFetchLeads.mockReset();
  mockFetchLeads.mockResolvedValue({ rows: cohortViews, total: 42, limit: 100, offset: 0 });
  mockBulkResponder = () => ({ ok: true, status: 200, body: { items: ITEMS, total: 4, limit: 100, offset: 0 } });
});

const renderDash = () => render(<IntelligenceDashboard companyId={CO} now={() => NOW} />);
const ready = () => waitFor(() => expect(screen.getByText('Total Leads')).toBeInTheDocument());

describe('INT-003 Wave 4 — Intelligence Dashboard', () => {
  it('renders every top KPI from persisted values', async () => {
    renderDash();
    await ready();
    const tile = (id: string) => screen.getByTestId(`kpi-${id}`);
    expect(tile('total-leads')).toHaveTextContent('42');
    expect(tile('intelligence-generated')).toHaveTextContent('3');
    expect(tile('never-generated')).toHaveTextContent('1');
    expect(tile('fresh')).toHaveTextContent('1');
    expect(tile('stale')).toHaveTextContent('1');
    expect(tile('pending-regeneration')).toHaveTextContent('1');
    expect(tile('average-score')).toHaveTextContent('56.7'); // mean(80,60,30)
    expect(tile('average-confidence')).toHaveTextContent('67%'); // mean(.9,.7,.4)
  });

  it('renders qualification, persona, freshness and intent distributions with deterministic ordering', async () => {
    renderDash();
    await ready();

    for (const [band, count] of [['hot', '1'], ['warm', '1'], ['cool', '1'], ['cold', '0']] as const) {
      const row = screen.getByTestId(`bar-${band}`);
      expect(row).toHaveTextContent(band);
      expect(row).toHaveTextContent(count);
    }

    const personas = screen.getByText('Persona Distribution').closest('section')!;
    const personaText = personas.textContent!;
    expect(personaText.indexOf('CTO')).toBeGreaterThan(-1);
    expect(personaText.indexOf('CTO')).toBeLessThan(personaText.indexOf('Developer')); // count desc: CTO(2) first

    const fresh = screen.getByText('Freshness Distribution').closest('section')!;
    for (const label of ['Fresh', 'Stale', 'Pending regeneration', 'Never generated']) {
      expect(fresh).toHaveTextContent(label);
    }

    const intent = screen.getByText('Intent Distribution').closest('section')!;
    expect(intent).toHaveTextContent('high');
    expect(intent).toHaveTextContent('1 (33%)');
    expect(intent).toHaveTextContent('none');
    expect(intent).toHaveTextContent('0 (0%)');
  });

  it('renders recommendation, version and timeline summaries', async () => {
    renderDash();
    await ready();

    const recs = screen.getByText('Recommendation Summary').closest('section')!;
    expect(recs).toHaveTextContent('Book the demo now');
    expect(recs).toHaveTextContent('Most common persona');
    expect(recs).toHaveTextContent('CTO (2)');
    expect(recs).toHaveTextContent('Most common band');
    expect(recs).toHaveTextContent('cool (1)'); // 3-way tie → count desc, name asc

    const version = screen.getByText('Version & Timeline').closest('section')!;
    expect(version).toHaveTextContent('lie-2.0.0');
    expect(version).toHaveTextContent('lie-1.0.0');
    expect(version).toHaveTextContent('Generated today');
    // today=1 (L1), 7d=2 (L1,L2), 30d=3 (+L3) — against the injected clock
    const rows = version.textContent!;
    expect(rows).toContain('Generated today1');
    expect(rows).toContain('Last 7 days2');
    expect(rows).toContain('Last 30 days3');
  });

  it('renders the intelligence table with all columns and never_generated placeholders', async () => {
    renderDash();
    await ready();
    for (const col of ['Lead', 'Score', 'Qualification', 'Persona', 'Intent', 'Confidence', 'Freshness', 'Generated', 'Version']) {
      expect(screen.getByText(col, { selector: 'th' })).toBeInTheDocument();
    }
    const row1 = screen.getByTestId('intel-row-L1');
    expect(row1).toHaveTextContent('ceo@hot.com');
    expect(row1).toHaveTextContent('80');
    expect(row1).toHaveTextContent('hot');
    expect(row1).toHaveTextContent('CTO');
    expect(row1).toHaveTextContent('high');
    expect(row1).toHaveTextContent('90%');
    expect(row1).toHaveTextContent('2026-08-03');
    expect(row1).toHaveTextContent('lie-2.0.0');

    const row4 = screen.getByTestId('intel-row-L4');
    expect(row4).toHaveTextContent('Never generated');
    expect(row4).toHaveTextContent('—');
  });

  it('row click navigates to the existing Lead Detail page', async () => {
    renderDash();
    await ready();
    fireEvent.click(screen.getByTestId('intel-row-L1'));
    const expectedKey = leadKeyFor(cohortViews[0]);
    expect(pushMock).toHaveBeenCalledWith(`/lead-intelligence/${encodeURIComponent(expectedKey)}`);
  });

  it('filters select over persisted values without refetching', async () => {
    renderDash();
    await ready();
    const callsAfterLoad = mockCalls.length;

    fireEvent.change(screen.getByLabelText('Qualification band'), { target: { value: 'hot' } });
    expect(screen.getByTestId('intel-row-L1')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L2')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Qualification band'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'Developer' } });
    expect(screen.getByTestId('intel-row-L2')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Minimum score'), { target: { value: '50' } });
    expect(screen.getByTestId('intel-row-L1')).toBeInTheDocument();
    expect(screen.getByTestId('intel-row-L2')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L4')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Minimum score'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Minimum confidence'), { target: { value: '0.8' } });
    expect(screen.getByTestId('intel-row-L1')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L2')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Minimum confidence'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Freshness'), { target: { value: 'stale' } });
    expect(screen.getByTestId('intel-row-L2')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Freshness'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Generated from'), { target: { value: '2026-07-20' } });
    fireEvent.change(screen.getByLabelText('Generated to'), { target: { value: '2026-08-01' } });
    expect(screen.getByTestId('intel-row-L2')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L3')).not.toBeInTheDocument();

    // Filters never trigger network activity.
    expect(mockCalls.length).toBe(callsAfterLoad);
  });

  it('performs exactly one authenticated bulk GET (plus the cohort read) and never writes or polls', async () => {
    renderDash();
    await ready();
    expect(mockFetchLeads).toHaveBeenCalledTimes(1);
    expect(mockCalls).toHaveLength(1);
    const { url, init } = mockCalls[0];
    expect(url).toContain('/api/leads/intelligence?');
    expect(url).toContain(`company_id=${CO}`);
    expect(url).toContain('ids=');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init && 'body' in init ? init.body : undefined).toBeUndefined();

    // Interactions do not re-poll.
    fireEvent.change(screen.getByLabelText('Qualification band'), { target: { value: 'hot' } });
    expect(mockCalls).toHaveLength(1);
    expect(mockFetchLeads).toHaveBeenCalledTimes(1);
  });

  it('is deterministic — two renders of the same payload produce identical text', async () => {
    const a = renderDash();
    await ready();
    const textA = a.container.textContent;
    cleanup();
    const b = renderDash();
    await ready();
    expect(b.container.textContent).toBe(textA);
  });

  it('malformed bulk payloads degrade safely (junk entries dropped, no crash)', async () => {
    mockBulkResponder = () => ({
      ok: true,
      status: 200,
      body: { items: ['garbage', null, { leadId: '' }, ITEMS[0], { unexpected: true }] },
    });
    renderDash();
    await ready();
    expect(screen.getByTestId('intel-row-L1')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L2')).not.toBeInTheDocument();

    cleanup();
    mockBulkResponder = () => ({ ok: true, status: 200, body: { items: 'not-an-array' } });
    renderDash();
    await waitFor(() => expect(screen.getByText('No leads to analyze yet.')).toBeInTheDocument());
  });

  it('partial datasets render only returned items (no fabricated rows)', async () => {
    mockBulkResponder = () => ({ ok: true, status: 200, body: { items: [ITEMS[0], ITEMS[3]] } });
    renderDash();
    await ready();
    expect(screen.getByTestId('intel-row-L1')).toBeInTheDocument();
    expect(screen.getByTestId('intel-row-L4')).toBeInTheDocument();
    expect(screen.queryByTestId('intel-row-L2')).not.toBeInTheDocument();
  });

  it('empty dataset: no leads → empty state and no bulk request', async () => {
    mockFetchLeads.mockResolvedValue({ rows: [], total: 0, limit: 100, offset: 0 });
    renderDash();
    await waitFor(() => expect(screen.getByText('No leads to analyze yet.')).toBeInTheDocument());
    expect(mockCalls).toHaveLength(0);
  });

  it('bulk read failure fails open to a quiet unavailable state', async () => {
    mockBulkResponder = () => ({ ok: false, status: 403, body: { error: 'FORBIDDEN_ROLE' } });
    renderDash();
    await waitFor(() => expect(screen.getByText('Intelligence unavailable.')).toBeInTheDocument());
    expect(mockCalls).toHaveLength(1); // no retry
  });

  it('renders nothing without a company id', () => {
    const { container } = render(<IntelligenceDashboard companyId="" now={() => NOW} />);
    expect(container.textContent).toBe('');
    expect(mockFetchLeads).not.toHaveBeenCalled();
  });
});
