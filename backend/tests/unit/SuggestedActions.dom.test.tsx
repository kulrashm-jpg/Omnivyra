/**
 * @jest-environment jsdom
 *
 * Suggested Actions — advisory action layer.
 *
 * Proves observed performance → suggested action: an expand action for the
 * high-confidence leader, a review action for a low evaluable, a collect-more-
 * data action for an insufficient-only category, and a funnel action from the
 * existing bottleneck. Every action shows its observation + reason (no black
 * box), and the section is labelled advisory-only.
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

import SuggestedActions from '../../../components/engagement/SuggestedActions';

const cat = (items: any[]) => ({ available: true, total_conversions: items.reduce((s, i) => s + i.conversions, 0), items });

const payload = {
  strategies: cat([
    { id: 'authority_play', conversions: 14, conversion_rate: 0.08, exposed_sessions: 200, confidence: 'high' },
    { id: 'data_led', conversions: 6, conversion_rate: 0.02, exposed_sessions: 300, confidence: 'medium' },
  ]),
  variants: cat([{ id: 'v1', conversions: 2, conversion_rate: 0.1, exposed_sessions: 12, confidence: 'insufficient' }]),
  assets: cat([]),
  campaigns: cat([]),
  platforms: cat([]),
  content_types: cat([]),
} as any;

beforeEach(() => {
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ bottleneckStage: 'form_submit', stages: [{ stage: 'form_submit', count: 4, dropFromPrev: 0.6 }] }),
  }));
});

describe('SuggestedActions (DOM)', () => {
  it('derives expand / review / collect-more-data / funnel actions with explainability', async () => {
    render(<SuggestedActions payload={payload} organizationId="comp-1" />);

    // Funnel action (async, from the existing bottleneck) — await it.
    expect(await screen.findByText(/Review form abandonment fields/i)).toBeInTheDocument();

    // Expand the high-confidence leader.
    expect(screen.getByText(/Consider expanding authority_play/i)).toBeInTheDocument();
    expect(screen.getByText(/authority_play converts at 8\.0%/i)).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();

    // Review the low evaluable.
    expect(screen.getByText(/Review data_led/i)).toBeInTheDocument();

    // Collect-more-data for the insufficient-only category.
    expect(screen.getByText(/Collect more data/i)).toBeInTheDocument();

    // Explainability present (no black box) + advisory framing.
    expect(screen.getAllByText(/^Why:/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Advisory only/i)).toBeInTheDocument();

    // Funnel action links into the place to act.
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/lead-capture');
  });

  it('shows a graceful empty state when there is nothing to act on', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const empty = {
      strategies: cat([]), variants: cat([]), assets: cat([]),
      campaigns: cat([]), platforms: cat([]), content_types: cat([]),
    } as any;
    render(<SuggestedActions payload={empty} organizationId="comp-1" />);
    expect(await screen.findByText(/No suggested actions yet/i)).toBeInTheDocument();
  });
});
