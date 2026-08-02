/**
 * @jest-environment jsdom
 *
 * Phase 7 — Lead Intelligence Workspace UI rendering. Renders the panels with the
 * repository client mocked (the components do no aggregation/filtering themselves).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { CanonicalLeadView, LeadProfile, LeadStats } from '../../../lib/leadIntelligence';

const pushMock = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: pushMock, query: {} }) }));
// OPT-005 Phase 2C: the panels now read through SWR with the client's fetch
// functions as fetchers and its pure key builders for cache keys. Keep the
// fetch functions mocked (same assertions as before) but let the real key
// builders through via requireActual.
jest.mock('../../../components/lead-intelligence/leadIntelligenceClient', () => ({
  ...jest.requireActual('../../../components/lead-intelligence/leadIntelligenceClient'),
  fetchLeadStats: jest.fn(),
  fetchLeads: jest.fn(),
  downloadLeadExport: jest.fn(),
  emptyFilters: () => ({ search: '', source: [], status: '', campaign: '', content: '', owner: '', from: '', to: '', intentMin: '', interest: '' }),
}));

import { SWRConfig } from 'swr';
import * as client from '../../../components/lead-intelligence/leadIntelligenceClient';
import OverviewPanel from '../../../components/lead-intelligence/OverviewPanel';
import LeadListPanel from '../../../components/lead-intelligence/LeadListPanel';
import LeadProfileView from '../../../components/lead-intelligence/LeadProfileView';

/** Fresh, isolated SWR cache per render so mocked data never bleeds across tests. */
const withSwr = (ui: React.ReactElement) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
);

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: { email: 'jane@acme.com' }, scores: { intent: 0.82 }, status: 'new',
  campaign: 'spring', content: 'pricing', referrer: null,
  utm: { source: 'google', medium: 'cpc', campaign: 'spring', content: null, term: null },
  occurredAt: '2026-05-01T00:00:00Z', sourceRef: { table: 'leads', id: 'L1' },
  attribution: { originalSource: 'form_embed', originalChannel: 'cpc', campaign: 'spring', content: 'pricing', session: null, journey: null, referrer: null, utm: { source: 'google', medium: 'cpc', campaign: 'spring', content: null, term: null }, identity: { email: 'jane@acme.com' }, sourceMetadata: { name: 'Jane Doe', company_name: 'Acme' } },
  ...over,
});

const stats: LeadStats = { total: 5, bySource: { website: 3, community: 2 }, byStatus: { new: 2, qualified: 1, won: 1, contacted: 1 }, intentBands: { high: 2, medium: 1, low: 2 }, withIdentity: 4, withCampaign: 3 };

afterEach(() => jest.clearAllMocks());

describe('Phase 7 — Workspace UI', () => {
  it('Overview renders repository stats + distributions + recent activity', async () => {
    (client.fetchLeadStats as jest.Mock).mockResolvedValue(stats);
    (client.fetchLeads as jest.Mock).mockResolvedValue({ rows: [view()], total: 5, limit: 8, offset: 0 });
    render(withSwr(<OverviewPanel companyId="co1" />));
    expect(await screen.findByText('Total Leads')).toBeInTheDocument();
    expect(screen.getByText('Lead Source Distribution')).toBeInTheDocument();
    expect(screen.getByText('Intent Distribution')).toBeInTheDocument();
    expect(screen.getByText('Status Distribution')).toBeInTheDocument();
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('jane@acme.com')).toBeInTheDocument());
  });

  it('Lead list renders rows from the repository + source chips', async () => {
    (client.fetchLeads as jest.Mock).mockResolvedValue({ rows: [view(), view({ source: 'community', sourceLabel: 'Community', identity: { contactId: 'c2', platform: 'reddit' }, sourceRef: { table: 'opportunity_feed_items', id: 'O1' } })], total: 2, limit: 25, offset: 0 });
    render(withSwr(<LeadListPanel companyId="co1" />));
    expect(await screen.findByText('jane@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
    expect(screen.getByText('MarketPulse')).toBeInTheDocument(); // a source chip
    expect(client.fetchLeads).toHaveBeenCalled();
  });

  it('Lead list shows the empty state (no client-side anything)', async () => {
    (client.fetchLeads as jest.Mock).mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 });
    render(withSwr(<LeadListPanel companyId="co1" />));
    expect(await screen.findByText(/No leads match your filters/i)).toBeInTheDocument();
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('Lead list export triggers the repository export', async () => {
    (client.fetchLeads as jest.Mock).mockResolvedValue({ rows: [view()], total: 1, limit: 25, offset: 0 });
    (client.downloadLeadExport as jest.Mock).mockResolvedValue(undefined);
    render(withSwr(<LeadListPanel companyId="co1" />));
    await screen.findByText('jane@acme.com');
    fireEvent.click(screen.getByText('CSV'));
    expect(client.downloadLeadExport).toHaveBeenCalledWith('co1', expect.any(Object), 'csv');
  });

  it('Profile renders every section incl. timeline + AI summary + recommended action', () => {
    const profile: LeadProfile = {
      leadKey: 'id::website::leads::L1',
      view: view(),
      identity: { unifiedPersonId: null, email: 'jane@acme.com', phone: null, platforms: [], externalKeys: {} },
      campaign: { campaign: 'spring', campaignId: null, channel: 'cpc', touchpointCount: 0 },
      journey: [],
      content: { pagesViewed: [], blogs: [], assets: [], forms: [], downloads: [], campaignsTouched: [], timeSpentSeconds: 0, maxScrollDepth: 0, conversions: 0, engagementEvents: 0, journeySummary: '' },
      activity: { events: [], lastActivityAt: null, count: 0 },
      opportunity: { opportunityTypes: [], topScore: 0.82 },
      marketPulse: { signalCategories: [], riskClass: null },
      crm: { status: 'new', revenue: null, qualificationScore: null },
      engagement: { threads: 0, lastMessageAt: null },
      analytics: { intent: 0.82, icp: null, confidence: null, total: null },
      timeline: [{ origin: 'leads', source: 'website', entityId: 'L1', eventType: 'lead_captured', occurredAt: '2026-05-01T00:00:00Z', metadata: {} }],
      summary: 'jane@acme.com from Website via spring — high intent (82%), status new.',
      recommendedNextAction: 'Reach out now — high buying intent',
    };
    render(<LeadProfileView profile={profile} onExport={() => {}} />);
    expect(screen.getByText('AI Summary')).toBeInTheDocument();
    expect(screen.getByText(/high intent \(82%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Reach out now/)).toBeInTheDocument();
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Buying Intent')).toBeInTheDocument();
    expect(screen.getByText('Opportunity Signals')).toBeInTheDocument();
    expect(screen.getByText('MarketPulse Signals')).toBeInTheDocument();
    expect(screen.getByText('Engagement Signals')).toBeInTheDocument();
    expect(screen.getByText('Lead Timeline')).toBeInTheDocument();
    expect(screen.getByText('lead captured')).toBeInTheDocument();
  });
});
