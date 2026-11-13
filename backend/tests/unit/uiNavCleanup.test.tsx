/**
 * @jest-environment jsdom
 *
 * UI step 4 — nav cleanup:
 *  - navigationConfig gains a "Company" section (profile, integrations, team) so the
 *    company profile has a menu path; the command palette lists each destination once.
 *  - /ops-center gets a UI admin guard that mirrors the server's enforceRole
 *    (COMPANY_ADMIN / SUPER_ADMIN = context isAdmin) and stops firing requests that
 *    can only 403 for non-admins.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import {
  COMMAND_ITEMS,
  PRIMARY_NAV_ITEMS,
  getPrimaryNavForPath,
  getSecondaryNavForPath,
} from '../../../components/layout/navigationConfig';

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), pathname: '/ops-center', query: {} }),
}));

const mockContext = jest.fn();
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => mockContext(),
}));

// eslint-disable-next-line import/first
import OpsCenterPage from '../../../pages/ops-center';

describe('navigationConfig — Company section', () => {
  it('resolves the company pages to the Company section', () => {
    for (const path of ['/company-profile', '/integrations', '/integrations/enrichment', '/external-apis', '/social-platforms', '/team-management']) {
      expect(getPrimaryNavForPath(path)?.label).toBe('Company');
    }
  });

  it('exposes profile, integrations and team as section tabs', () => {
    expect(getSecondaryNavForPath('/integrations').map((i) => i.href)).toEqual([
      '/company-profile',
      '/integrations',
      '/team-management',
    ]);
  });

  it('does not steal paths from existing sections', () => {
    expect(getPrimaryNavForPath('/command-center')?.label).toBe('Dashboard');
    expect(getPrimaryNavForPath('/dashboard')?.label).toBe('Dashboard');
    expect(getPrimaryNavForPath('/campaigns')?.label).toBe('Campaigns');
    expect(getPrimaryNavForPath('/command-center/billing')?.label).toBe('Credits & Billing');
    expect(getPrimaryNavForPath('/command-center/engagement')?.label).toBe('Engagement');
  });

  it('keeps every existing primary section', () => {
    expect(PRIMARY_NAV_ITEMS.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Dashboard', 'Content', 'Campaigns', 'Engagement', 'Credits & Billing', 'Company']),
    );
  });
});

describe('COMMAND_ITEMS (Ctrl+K palette)', () => {
  it('has unique ids (React keys) — one entry per destination', () => {
    const ids = COMMAND_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the section entry when a child shares its destination', () => {
    const campaigns = COMMAND_ITEMS.filter((i) => i.href === '/campaigns' && i.group === 'Navigate');
    expect(campaigns.map((i) => i.label)).toEqual(['Campaigns']);
    const company = COMMAND_ITEMS.filter((i) => i.href === '/company-profile');
    expect(company.map((i) => i.label)).toEqual(['Company']);
  });

  it('makes integrations and team reachable from the palette', () => {
    const hrefs = COMMAND_ITEMS.map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/integrations', '/team-management', '/company-profile']));
  });
});

describe('/ops-center UI admin guard', () => {
  const baseCtx = { selectedCompanyId: 'co-1', authChecked: true, isLoading: false };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    (global as any).fetch = fetchMock;
  });
  afterEach(() => {
    delete (global as any).fetch;
    mockContext.mockReset();
  });

  it('shows the access-restricted state to non-admins and calls no endpoint', async () => {
    mockContext.mockReturnValue({ ...baseCtx, isAdmin: false });
    render(<OpsCenterPage />);
    expect(screen.getByText(/You don.t have access to the Operations Center/)).toBeInTheDocument();
    expect(screen.queryByText('Operations Center')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the role to resolve before deciding or fetching', async () => {
    mockContext.mockReturnValue({ ...baseCtx, authChecked: false, isAdmin: false });
    render(<OpsCenterPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/You don.t have access/)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the console and loads data for admins', async () => {
    mockContext.mockReturnValue({ ...baseCtx, isAdmin: true });
    render(<OpsCenterPage />);
    expect(screen.getByText('Operations Center')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/website-intelligence/enterprise-readiness?company_id=co-1');
  });
});

describe('Home = Command Center (owner decision 2026-11-13)', () => {
  // Required lazily so a header import problem fails only this block.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { HOME_ROUTE, isHomePath } = require('../../../components/layout/GlobalHeaderMain');

  it('points home at the Command Center', () => {
    expect(HOME_ROUTE).toBe('/command-center');
  });

  it('is active only on the Command Center itself', () => {
    expect(isHomePath('/command-center')).toBe(true);
    expect(isHomePath('/command-center/')).toBe(true);
    expect(isHomePath('/command-center/content')).toBe(false);
    expect(isHomePath('/command-center/bolt-text')).toBe(false);
    expect(isHomePath('/dashboard')).toBe(false);
  });
});
