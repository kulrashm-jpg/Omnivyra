/**
 * @jest-environment jsdom
 *
 * CreatorConversionSummary (discovery hook) DOM tests.
 *
 * Verifies the compact hook used on the engagement portal + intelligence
 * Supporting Signals: renders attributed leads + top strategy/asset with data,
 * never hides (invites setup when attribution not live, prompts to publish when
 * live-but-empty), links to the analytics anchor, and renders nothing without a
 * selected company.
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

import CreatorConversionSummary from '../../../components/engagement/CreatorConversionSummary';

const HREF = '/engagement/analytics#creator-conversion';

function mockFetch(payload: any) {
  (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => payload }));
}

beforeEach(() => {
  mockUseCompanyContext.mockReturnValue({ selectedCompanyId: 'comp-1' });
});

describe('CreatorConversionSummary (DOM)', () => {
  it('renders attributed leads + top strategy/asset and links to the anchor', async () => {
    mockFetch({
      attribution_available: true,
      strategies: { available: true, total_conversions: 14, items: [{ id: 'authority_play', conversions: 14 }] },
      variants: { available: true, total_conversions: 9, items: [{ id: 'v2_punchy', conversions: 9 }] },
      assets: { available: true, total_conversions: 6, items: [{ id: 'asset-77', conversions: 6 }] },
    });
    render(<CreatorConversionSummary />);
    expect(await screen.findByText('14')).toBeInTheDocument();
    expect(screen.getByText('authority_play')).toBeInTheDocument();
    expect(screen.getByText('asset-77')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', HREF);
  });

  it('invites setup (never hides) when attribution is not live', async () => {
    mockFetch({
      attribution_available: false,
      strategies: { available: false, total_conversions: 0, items: [] },
      variants: { available: false, total_conversions: 0, items: [] },
      assets: { available: false, total_conversions: 0, items: [] },
    });
    render(<CreatorConversionSummary />);
    expect(await screen.findByText(/See which creator work generates leads/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', HREF);
  });

  it('prompts to publish when attribution is live but empty', async () => {
    mockFetch({
      attribution_available: true,
      strategies: { available: true, total_conversions: 0, items: [] },
      variants: { available: true, total_conversions: 0, items: [] },
      assets: { available: true, total_conversions: 0, items: [] },
    });
    render(<CreatorConversionSummary />);
    expect(await screen.findByText(/No creator-attributed leads yet/i)).toBeInTheDocument();
  });

  it('renders nothing when no company is selected', () => {
    mockUseCompanyContext.mockReturnValue({ selectedCompanyId: null });
    const { container } = render(<CreatorConversionSummary />);
    expect(container).toBeEmptyDOMElement();
  });
});
