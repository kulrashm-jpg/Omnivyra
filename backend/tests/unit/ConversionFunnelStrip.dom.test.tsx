/**
 * @jest-environment jsdom
 *
 * ConversionFunnelStrip DOM tests — unified funnel narrative.
 *
 * Verifies the strip stitches THREE existing endpoints into the six funnel
 * stages, renders a context-bridge link per stage, degrades gracefully to "—"
 * + a readiness next-action when data is missing (never hidden), and renders
 * nothing without a selected company.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockUseCompanyContext = jest.fn();
jest.mock('@/components/CompanyContext', () => ({
  __esModule: true,
  useCompanyContext: () => mockUseCompanyContext(),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>
  ),
}));

import ConversionFunnelStrip from '../../../components/engagement/ConversionFunnelStrip';

function mockFetchByUrl(map: { conv?: any; dash?: any; opp?: any; fail?: boolean }) {
  (global as any).fetch = jest.fn(async (url: string) => {
    if (map.fail) return { ok: false, json: async () => ({}) };
    if (url.includes('creator-conversion')) return { ok: true, json: async () => map.conv };
    if (url.includes('website-intelligence/dashboard')) return { ok: true, json: async () => map.dash };
    if (url.includes('active-leads/opportunities')) return { ok: true, json: async () => map.opp };
    return { ok: false, json: async () => ({}) };
  });
}

beforeEach(() => {
  mockUseCompanyContext.mockReturnValue({ selectedCompanyId: 'comp-1' });
});

describe('ConversionFunnelStrip (DOM)', () => {
  it('stitches the six stages from the three existing endpoints, each a bridge link', async () => {
    mockFetchByUrl({
      conv: {
        attribution_available: true,
        strategies: { total_conversions: 14, items: [{ id: 's1' }] },
        variants: { total_conversions: 9, items: [{ id: 'v1' }] },
        assets: { total_conversions: 6, items: [{ id: 'a1' }, { id: 'a2' }] },
      },
      dash: { overview: { unique_visitors: 120, form_starts: 30, form_submits: 8 } },
      opp: { type_counts: { buying_intent: 3, hiring_signal: 2 } },
    });
    render(<ConversionFunnelStrip />);

    // Attributed Leads = max(14,9,6); Creator Content = assets.items.length (2);
    // Opportunities = 3+2.
    expect(await screen.findByText('14')).toBeInTheDocument(); // attributed leads
    expect(screen.getByText('2')).toBeInTheDocument();         // creator content (converting assets)
    expect(screen.getByText('120')).toBeInTheDocument();       // visits
    expect(screen.getByText('30')).toBeInTheDocument();        // form views
    expect(screen.getByText('8')).toBeInTheDocument();         // submissions
    expect(screen.getByText('5')).toBeInTheDocument();         // opportunities

    // All six stage labels present.
    ['Creator Content', 'Website Visits', 'Form Views', 'Lead Submissions', 'Attributed Leads', 'Opportunities'].forEach(
      (label) => expect(screen.getByText(label)).toBeInTheDocument(),
    );

    // Context bridges: each stage navigates to its surface.
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/engagement/analytics#creator-conversion',
        '/website-intelligence',
        '/lead-capture',
        '/command-center/active-leads',
      ]),
    );
  });

  it('degrades gracefully: missing data shows the stages + a readiness next-action (never hidden)', async () => {
    mockFetchByUrl({ fail: true });
    render(<ConversionFunnelStrip />);

    // Await the readiness footer (only rendered after the fetches resolve).
    expect(await screen.findByText(/funnel lights up as data flows/i)).toBeInTheDocument();
    // Stages still render (never hidden), with "—" placeholders + setup action.
    expect(screen.getByText('Website Visits')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/Set up tracking/i)).toBeInTheDocument();
  });

  it('renders nothing without a selected company', () => {
    mockUseCompanyContext.mockReturnValue({ selectedCompanyId: null });
    const { container } = render(<ConversionFunnelStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the organizationId prop over context (website-intelligence local-company path)', async () => {
    // No global company selected — the prop must still drive the strip.
    mockUseCompanyContext.mockReturnValue({ selectedCompanyId: null });
    mockFetchByUrl({
      conv: { strategies: { total_conversions: 4, items: [] }, variants: { total_conversions: 0, items: [] }, assets: { total_conversions: 0, items: [] } },
      dash: { overview: { unique_visitors: 50, form_starts: 10, form_submits: 3 } },
      opp: { type_counts: {} },
    });
    render(<ConversionFunnelStrip organizationId="comp-2" />);

    // Await the post-fetch value so we know data resolved.
    expect(await screen.findByText('50')).toBeInTheDocument();
    expect(screen.getByText('Website Visits')).toBeInTheDocument();
    const calledUrls = ((global as any).fetch as jest.Mock).mock.calls.map((c: any[]) => c[0] as string);
    expect(calledUrls.every((u) => u.includes('comp-2'))).toBe(true);
  });
});
