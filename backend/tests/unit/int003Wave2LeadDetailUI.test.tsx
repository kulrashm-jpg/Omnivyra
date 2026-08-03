/**
 * @jest-environment jsdom
 *
 * INT-003 Wave 2 — Lead Detail "Generated Intelligence" section.
 *
 * Presentation-only characterization: the section renders the persisted DTO
 * exactly as served by GET /api/leads/:id/intelligence. Fixture DTOs are REAL
 * (Phase 4 orchestrator → Phase 6 mapper), the network seam (apiFetch) is
 * mocked and every call recorded — proving one GET, zero writes, no polling.
 */

const mockCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
let mockResponder: (url: string) => { ok: boolean; status: number; body: unknown };

jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    mockCalls.push({ url, init });
    const r = mockResponder(url);
    return { ok: r.ok, status: r.status, json: async () => r.body };
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    chain.upsert = async () => ({ error: null });
    chain.update = () => chain;
    return chain;
  },
}));

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import LeadIntelligenceSection from '../../../components/lead-intelligence/LeadIntelligenceSection';
import { toLeadIntelligenceView } from '../../services/leadIntelligenceReadApi';
import type { LeadIntelligenceViewDTO } from '../../services/leadIntelligenceReadApi';
import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  ENGINE_VERSION,
  type RawLeadRows,
} from '../../services/leadIntelligenceOrchestration';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const REF = { companyId: 'co-1', leadId: 'L1' };

const baseRows = (): RawLeadRows => ({
  leadRow: {
    id: 'L1',
    company_id: 'co-1',
    email: 'cto@bigcorp.com',
    name: 'Sam',
    source: 'website',
    created_at: '2026-08-03T11:00:00.000Z',
    visitor_session_id: 'vs1',
    metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
  },
  trackingEventRows: [
    { id: 't1', event_name: 'page_view', page_url: '/pricing', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} },
    { id: 't2', event_name: 'page_view', page_url: '/enterprise', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:05:00.000Z', metadata: {} },
    { id: 't3', event_name: 'page_view', page_url: '/book-a-demo', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:10:00.000Z', metadata: {} },
  ],
  visitorSessionRows: [{ id: 'vs1', started_at: '2026-08-03T09:59:00.000Z' }],
  touchpointRows: [],
});

let fullView: LeadIntelligenceViewDTO;
const neverView = (): LeadIntelligenceViewDTO => toLeadIntelligenceView(null, REF);
const cloneView = (mutate: (v: LeadIntelligenceViewDTO) => void): LeadIntelligenceViewDTO => {
  const v = JSON.parse(JSON.stringify(fullView)) as LeadIntelligenceViewDTO;
  mutate(v);
  return v;
};

beforeAll(async () => {
  const orchestrator = createLeadIntelligenceOrchestrator({
    persistence: createInMemoryIntelligenceStore(),
    snapshotSource: { load: async () => baseRows() },
    clock: () => T0,
  });
  const record = (await orchestrator.generate(REF)).record!;
  fullView = toLeadIntelligenceView(record, REF);
});

beforeEach(() => {
  mockCalls.length = 0;
  mockResponder = () => ({ ok: true, status: 200, body: fullView });
});

const renderSection = (leadId: string | null = 'L1') =>
  render(<LeadIntelligenceSection companyId="co-1" leadId={leadId} />);

describe('INT-003 Wave 2 — Generated Intelligence section', () => {
  it('renders the full persisted envelope: overall, intent, persona, qualification, behavior, timeline, recommendations, channels, planning, automation, version', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());

    // Overall
    expect(screen.getByText(`${fullView.qualification!.totalScore}/100`)).toBeInTheDocument();
    expect(screen.getByText(fullView.qualification!.band)).toBeInTheDocument();

    // Intent with signal explanations
    expect(screen.getByText('Intent')).toBeInTheDocument();
    expect(screen.getAllByText('Pricing').length).toBeGreaterThan(0);

    // Persona with reasons (card title + field label both render)
    expect(screen.getAllByText('Persona').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('CTO').length).toBeGreaterThan(0);

    // Qualification — every dimension from the DTO renders (keys also appear
    // in the planning card, so ambiguity is expected and allowed).
    for (const s of fullView.qualification!.sections) {
      expect(screen.getAllByText(s.key, { selector: 'span' }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Behavior')).toBeInTheDocument();

    // Timeline
    expect(screen.getByText('Journey Timeline')).toBeInTheDocument();
    expect(screen.getByText('Lead Submitted')).toBeInTheDocument();

    // Recommendations incl. best channel + next best action + explanations
    // (headline KV labels intentionally repeat the list-item labels).
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.getAllByText('Best channel').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Next best action').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Why valuable').length).toBeGreaterThan(0);

    // Channels ranking + confidence
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText(`#1 ${fullView.qualificationPlanning!.channels[0].channel}`)).toBeInTheDocument();

    // Planning layers
    expect(screen.getByText('Qualification Planning')).toBeInTheDocument();
    expect(screen.getByText('Automation Planning')).toBeInTheDocument();

    // Version + freshness
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText(ENGINE_VERSION)).toBeInTheDocument();
    expect(screen.getByText(fullView.version!.fingerprint.slice(0, 12) + '…')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('never_generated renders the required empty state and nothing else', async () => {
    mockResponder = () => ({ ok: true, status: 200, body: neverView() });
    renderSection();
    await waitFor(() => expect(screen.getByText('No intelligence has been generated yet.')).toBeInTheDocument());
    expect(screen.getByText('Not generated')).toBeInTheDocument();
    expect(screen.queryByText('Overall Intelligence')).not.toBeInTheDocument();
    // exactly one read, no retries/regeneration
    expect(mockCalls).toHaveLength(1);
  });

  it('surfaces stale freshness exactly as served', async () => {
    mockResponder = () => ({ ok: true, status: 200, body: cloneView((v) => { v.freshness = 'stale'; }) });
    renderSection();
    await waitFor(() => expect(screen.getByText('Out of date')).toBeInTheDocument());
  });

  it('surfaces pending_regeneration freshness exactly as served', async () => {
    mockResponder = () => ({ ok: true, status: 200, body: cloneView((v) => { v.freshness = 'pending_regeneration'; }) });
    renderSection();
    await waitFor(() => expect(screen.getByText('Refresh queued')).toBeInTheDocument());
  });

  it('a non-conforming 200 body (missing arrays) degrades to omitted sections, never a throw', async () => {
    mockResponder = () => ({
      ok: true,
      status: 200,
      body: { status: 'available', freshness: 'fresh', qualification: fullView.qualification } as unknown as LeadIntelligenceViewDTO,
    });
    renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());
    expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
    expect(screen.queryByText('Journey Timeline')).not.toBeInTheDocument();
  });

  it('malformed/null sections render only what is available, never throwing', async () => {
    mockResponder = () => ({
      ok: true,
      status: 200,
      body: cloneView((v) => {
        v.intent = null;
        v.persona = null;
        v.timeline = [];
      }),
    });
    renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());
    expect(screen.queryByText('Intent')).not.toBeInTheDocument();
    expect(screen.queryByText('Persona')).not.toBeInTheDocument();
    expect(screen.queryByText('Journey Timeline')).not.toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
  });

  it('missing planning and automation layers hide those cards (legacy records)', async () => {
    mockResponder = () => ({
      ok: true,
      status: 200,
      body: cloneView((v) => {
        v.qualificationPlanning = null;
        v.automationPlanning = null;
        v.freshness = 'stale';
      }),
    });
    renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());
    expect(screen.queryByText('Qualification Planning')).not.toBeInTheDocument();
    expect(screen.queryByText('Automation Planning')).not.toBeInTheDocument();
    expect(screen.queryByText('Channels')).not.toBeInTheDocument();
    expect(screen.getByText('Out of date')).toBeInTheDocument();
  });

  it('renders the timeline in persisted order (deterministic)', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Journey Timeline')).toBeInTheDocument());
    const labels = fullView.timeline.map((t) => t.label);
    const rendered = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const timelineRendered = rendered.filter((text) => labels.some((l) => text.includes(l)));
    // every persisted entry appears, in DTO order
    let cursor = 0;
    for (const label of labels) {
      const idx = timelineRendered.findIndex((text, i) => i >= cursor && text.includes(label));
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
  });

  it('is deterministic — two renders of the same payload produce identical text', async () => {
    const first = renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());
    const a = first.container.textContent;
    cleanup();
    const second = renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());
    expect(second.container.textContent).toBe(a);
  });

  it('performs exactly one GET with the tenant param and never writes or polls', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Overall Intelligence')).toBeInTheDocument());
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].url).toBe('/api/leads/L1/intelligence?company_id=co-1');
    const init = mockCalls[0].init;
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init && 'body' in init ? init.body : undefined).toBeUndefined();
  });

  it('fetch failure fails open to a quiet unavailable state (no crash, no retry loop)', async () => {
    mockResponder = () => ({ ok: false, status: 403, body: { error: 'FORBIDDEN_ROLE' } });
    renderSection();
    await waitFor(() => expect(screen.getByText('Intelligence unavailable.')).toBeInTheDocument());
    expect(mockCalls).toHaveLength(1);
  });

  it('renders nothing and fetches nothing without a lead id', () => {
    const { container } = renderSection(null);
    expect(container.textContent).toBe('');
    expect(mockCalls).toHaveLength(0);
  });
});
