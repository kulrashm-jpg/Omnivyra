/**
 * @jest-environment jsdom
 *
 * Owner decision 2026-11-13: campaign menu items use the PRODUCT NAME plus a short
 * plain-English hint underneath. The wording below was approved verbatim by the owner;
 * this test pins it so a later edit is a deliberate change, not drift.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { PRIMARY_NAV_ITEMS, COMMAND_ITEMS } from '../../../components/layout/navigationConfig';

const mockPathname = { current: '/campaigns' };
jest.mock('next/router', () => ({
  useRouter: () => ({ pathname: mockPathname.current, asPath: mockPathname.current, push: jest.fn(), query: {} }),
}));
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({ userRole: 'COMPANY_ADMIN' }),
}));

// eslint-disable-next-line import/first
import SectionNav from '../../../components/layout/SectionNav';

const APPROVED = [
  { label: 'All Campaigns', hint: 'See and manage every campaign', href: '/campaigns' },
  { label: 'BOLT Text', hint: 'Quick text posts in minutes', href: '/command-center/bolt-text' },
  { label: 'BOLT Creator', hint: 'Image, carousel and infographic campaigns', href: '/command-center/bolt-creator-strategy' },
  { label: 'Intelligent Mix', hint: 'Text and visuals together in one campaign', href: '/command-center/intelligent-mix-strategy' },
  { label: 'Strategic Mix', hint: 'Plan a full campaign step by step, your way', href: '/campaign-planner?mode=direct' },
];

describe('Campaigns menu — product names with owner-approved hints', () => {
  it('lists exactly the approved items, labels, hints and destinations, in order', () => {
    const campaigns = PRIMARY_NAV_ITEMS.find((i) => i.label === 'Campaigns');
    expect((campaigns?.children ?? []).map(({ label, hint, href }) => ({ label, hint, href }))).toEqual(APPROVED);
  });

  it('retires the old descriptive labels from the sidebar and palette', () => {
    const labels = COMMAND_ITEMS.map((i) => i.label);
    for (const old of ['Create Quick Posts', 'Creator Strategy', 'Multi-Channel Campaigns']) {
      expect(labels).not.toContain(old);
    }
  });

  it('shows the hint in the Ctrl+K palette description', () => {
    const bolt = COMMAND_ITEMS.find((i) => i.label === 'BOLT Text');
    expect(bolt?.description).toBe('Quick text posts in minutes');
  });

  it('renders each hint under its label in the section tabs', () => {
    mockPathname.current = '/campaigns';
    render(<SectionNav />);
    for (const item of APPROVED) {
      const link = screen.getByText(item.label).closest('a');
      expect(link).not.toBeNull();
      expect(link).toHaveTextContent(item.hint);
    }
  });

  it('leaves sections without hints unchanged (single-line pill)', () => {
    mockPathname.current = '/command-center/billing';
    render(<SectionNav />);
    const link = screen.getByText('Credit Advisor').closest('a');
    expect(link?.className).toContain('rounded-full');
    expect(link?.querySelectorAll('span').length).toBe(1);
  });
});
