/**
 * @jest-environment jsdom
 *
 * Owner ruling 2026-11-13: /market-pulse (Executive room) is the one customer entry.
 * Admins get a "Configure / run scan" link to the V2 console; members do not.
 * The link only hides the entry; the server-side gate on the V2 routes protects them.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

const mockRouter = { query: {} as Record<string, string> };
jest.mock('next/router', () => ({
  useRouter: () => ({ ...mockRouter, pathname: '/market-pulse', push: jest.fn() }),
}));
const mockContext = jest.fn();
jest.mock('@/components/CompanyContext', () => ({
  useCompanyContext: () => mockContext(),
}));
// The executive experience fetches data; it is out of scope for this link test.
jest.mock('@/components/market-pulse/ExecutiveMarketPulseExperience', () => () => null);

// eslint-disable-next-line import/first
import MarketPulsePage from '../../../pages/market-pulse';

afterEach(() => {
  mockContext.mockReset();
  mockRouter.query = {};
});

describe('/market-pulse admin "Configure / run scan" link', () => {
  it('is shown to admins and opens the V2 console for the selected company', () => {
    mockContext.mockReturnValue({ selectedCompanyId: 'co 1', isAdmin: true });
    render(<MarketPulsePage />);
    const link = screen.getByRole('link', { name: /Configure \/ run scan/ });
    expect(link).toHaveAttribute('href', '/dashboard/intelligence?intelTab=market-pulse&companyId=co%201');
  });

  it('is hidden when the URL shows a different company than the selected one (isAdmin is for the selected company)', () => {
    mockRouter.query = { companyId: 'other-co' };
    mockContext.mockReturnValue({ selectedCompanyId: 'co-1', isAdmin: true });
    render(<MarketPulsePage />);
    expect(screen.queryByRole('link', { name: /Configure \/ run scan/ })).not.toBeInTheDocument();
  });

  it('is shown when the URL companyId is the selected company', () => {
    mockRouter.query = { companyId: 'co-1' };
    mockContext.mockReturnValue({ selectedCompanyId: 'co-1', isAdmin: true });
    render(<MarketPulsePage />);
    expect(screen.getByRole('link', { name: /Configure \/ run scan/ })).toHaveAttribute(
      'href',
      '/dashboard/intelligence?intelTab=market-pulse&companyId=co-1',
    );
  });

  it('is hidden from regular members', () => {
    mockContext.mockReturnValue({ selectedCompanyId: 'co-1', isAdmin: false });
    render(<MarketPulsePage />);
    expect(screen.queryByRole('link', { name: /Configure \/ run scan/ })).not.toBeInTheDocument();
    expect(screen.getByText('Executive intelligence operating room')).toBeInTheDocument();
  });

  it('is hidden when no company is selected', () => {
    mockContext.mockReturnValue({ selectedCompanyId: null, isAdmin: true });
    render(<MarketPulsePage />);
    expect(screen.queryByRole('link', { name: /Configure \/ run scan/ })).not.toBeInTheDocument();
  });
});
