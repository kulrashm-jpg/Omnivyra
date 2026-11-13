/**
 * @jest-environment jsdom
 *
 * UI D3 (owner rules 2 + 3; BETA-008): the campaign-modes hub.
 * - ONE control per mode card (its CTA); the card body is not a second button.
 * - Existing campaigns are one click away ("Your campaigns" → /campaigns), and the header
 *   Campaigns menu lists "All campaigns" first.
 * - The Variant Experience operator panel is shown to admins only, never to customers.
 * - The internal hero copy ("UX Goal: Consistent") is gone.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push, replace: jest.fn(), query: {}, pathname: '/command-center/campaigns' }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

let ctx: Record<string, unknown> = {};
jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ctx }));
jest.mock('../../../components/variant-experience/useVariantApi', () => ({
  useStrategyAnalytics: () => ({ data: null, loading: false, error: null }),
  useVariantExperiments: () => ({ experiments: [], loading: false, error: null, complete: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('../../../components/variant-experience/ExperimentResultsPanel', () => ({ ExperimentResultsPanel: () => null }));
jest.mock('../../../components/variant-experience/VariantWinnerCard', () => ({ VariantWinnerCard: () => null }));
jest.mock('../../../components/variant-experience/CampaignVariantConfigPanel', () => ({ CampaignVariantConfigPanel: () => null }));

import CampaignsSubPage from '../../../pages/command-center/campaigns';
import { HEADER_NAV_ITEMS } from '../../../components/layout/GlobalHeaderNav';

beforeEach(() => {
  push.mockClear();
  (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, campaigns: [] }) }));
});
const asRole = (userRole: string, isAdmin: boolean) => {
  ctx = { user: { userId: 'u1' }, authChecked: true, isLoading: false, userRole, selectedCompanyId: 'c1', isAdmin };
};

describe('campaign modes hub (D3)', () => {
  it('one control per card: clicking the card body does nothing; its CTA opens the mode', () => {
    asRole('CONTENT_CREATOR', false);
    render(<CampaignsSubPage />);
    const card = screen.getByTestId('campaign-mode-card-bolt-text');
    expect(card.querySelectorAll('button')).toHaveLength(1);
    expect(card.className).not.toMatch(/min-h-\[/);
    fireEvent.click(card);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(card.querySelector('button')!);
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('"Your campaigns" links to the campaign list; internal hero copy is gone', () => {
    asRole('CONTENT_CREATOR', false);
    render(<CampaignsSubPage />);
    expect(screen.getByRole('link', { name: /Your campaigns/ })).toHaveAttribute('href', '/campaigns');
    expect(screen.queryByText('UX Goal')).toBeNull();
    expect(screen.queryByText('Campaign Modes')).toBeNull();
  });
  it('customers never see the Variant Experience operator panel', () => {
    asRole('CONTENT_CREATOR', false);
    render(<CampaignsSubPage />);
    expect(screen.queryByText('Variant Experience')).toBeNull();
  });
  it('admins still get it', () => {
    asRole('COMPANY_ADMIN', true);
    render(<CampaignsSubPage />);
    expect(screen.getByText('Variant Experience')).toBeInTheDocument();
  });
});

describe('header Campaigns menu (D3)', () => {
  it('lists "All campaigns" (→ /campaigns) first, then the four modes', () => {
    const campaigns = HEADER_NAV_ITEMS.find((i: any) => i.label === 'Campaigns') as any;
    expect(campaigns.children.map((c: any) => c.label)).toEqual(['All campaigns', 'BOLT Text', 'BOLT Creator', 'Intelligent Mix', 'Strategic Mix']);
    expect(campaigns.children[0].href).toBe('/campaigns');
  });
});
