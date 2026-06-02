/**
 * @jest-environment jsdom
 *
 * CreatorConversionIntelligence — conversion-rate quality display.
 *
 * Verifies the card shows per-item conversion rate + exposed sessions + a
 * confidence tier badge, renders "Insufficient data" below the floor (never a
 * fabricated rate leader), and shows the "More data required" advisory when a
 * rate-bearing category has no evaluable item.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>
  ),
}));
// Isolate the card's own rendering — SuggestedActions has its own DOM test and
// would otherwise duplicate rate/badge text derived from the same payload.
jest.mock('@/components/engagement/SuggestedActions', () => ({ __esModule: true, default: () => null }));

import CreatorConversionIntelligence from '../../../components/engagement/CreatorConversionIntelligence';

const meta = (n: number) => ({ conversion_count: n, conversion_share: 1 });

function mockFetch(payload: any) {
  (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => payload }));
}

describe('CreatorConversionIntelligence (rate quality DOM)', () => {
  it('shows rate + exposed sessions + tier, "Insufficient data" below floor, and the advisory note', async () => {
    mockFetch({
      attribution_available: true,
      attribution_source: 'lead_attributions',
      strategies: {
        available: true,
        total_conversions: 20,
        items: [
          { id: 'authority_play', conversions: 14, conversion_share: 0.7, exposed_sessions: 200, conversion_rate: 0.07, confidence: 'low', campaigns: [], metadata: meta(14) },
          { id: 'data_led', conversions: 6, conversion_share: 0.3, exposed_sessions: 40, conversion_rate: 0.15, confidence: 'insufficient', campaigns: [], metadata: meta(6) },
        ],
      },
      variants: {
        available: true,
        total_conversions: 9,
        items: [{ id: 'v2', conversions: 9, conversion_share: 1, exposed_sessions: 150, conversion_rate: 0.06, confidence: 'medium', campaigns: [], metadata: meta(9) }],
      },
      assets: {
        available: true,
        total_conversions: 2,
        items: [{ id: 'asset-1', conversions: 2, conversion_share: 1, exposed_sessions: 12, conversion_rate: 0.1667, confidence: 'insufficient', campaigns: [], metadata: meta(2) }],
      },
      campaigns: {
        available: true,
        total_conversions: 12,
        items: [{ id: 'camp-A', conversions: 12, conversion_share: 1, exposed_sessions: 300, conversion_rate: 0.04, confidence: 'high', campaigns: ['camp-A'], metadata: meta(12) }],
      },
      platforms: { available: true, total_conversions: 0, items: [] },
      content_types: { available: true, total_conversions: 0, items: [] },
    });

    render(<CreatorConversionIntelligence organizationId="comp-1" days={30} />);

    // Evaluable strategy → rate + exposure + tier badge.
    expect(await screen.findByText('7.0%')).toBeInTheDocument();
    expect(screen.getByText(/of 200 exposed sessions/i)).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();

    // Below-floor items show "Insufficient data" (strategy data_led + asset).
    expect(screen.getAllByText(/Insufficient data/i).length).toBeGreaterThanOrEqual(2);

    // Assets category is all-insufficient → advisory note (never a rate leader).
    expect(screen.getByText(/More data required before conversion performance can be evaluated/i)).toBeInTheDocument();

    // Variant now renders quality at parity: rate + tier badge.
    expect(screen.getByText('6.0%')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    // Informational note on the variant card.
    expect(screen.getByText(/Variant conversion rates are most reliable for clickable creator-asset links/i)).toBeInTheDocument();

    // Marketing effectiveness section at parity (campaign rate + tier).
    expect(screen.getByText(/Marketing effectiveness/i)).toBeInTheDocument();
    expect(screen.getByText('Top Converting Campaigns')).toBeInTheDocument();
    expect(screen.getByText('camp-A')).toBeInTheDocument();
    expect(screen.getByText('4.0%')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });
});
