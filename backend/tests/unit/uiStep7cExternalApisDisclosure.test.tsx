/**
 * @jest-environment jsdom
 *
 * UI step 7c: progressive disclosure on /external-apis in COMPANY mode only.
 * - The tab bar shows the 4 API categories; Request New / Approval Queue / Usage sit behind "More".
 * - Per row: Enable/Disable + "Details" up front; Test and Delete move into the details panel.
 * - The health legend is collapsed ("What do the health badges mean?").
 * Super-admin platform catalog mode (?mode=platform) is unchanged.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/external-apis', asPath: '/external-apis', query: {}, push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({ selectedCompanyId: 'co-1', userRole: 'COMPANY_ADMIN', isAdmin: true, companies: [] }),
}));

function stubState(overrides: Record<string, unknown>) {
  return new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop in overrides) return overrides[prop];
      if (/^(set|handle|load|toggle|update|validate|add|remove|delete|test|save|open|close|submit|apply|refresh|fetch|run|select|clear)/.test(prop)) return jest.fn();
      if (/(s|List|Apis|Accounts|Requests|Presets|Tabs|Items|Rows)$/.test(prop)) return [];
      return undefined;
    },
  });
}

let mockExternal: Record<string, unknown> = {};
jest.mock('../../../hooks/useExternalApisState', () => ({ useExternalApisState: () => stubState(mockExternal) }));
jest.mock('../../../components/ExternalApisTabContent', () => () => null);

// eslint-disable-next-line import/first
import ExternalApisPage from '../../../pages/external-apis';

const tabButtons = () => screen.getAllByRole('button').map((b) => b.textContent?.trim());

describe('/external-apis tab bar (step 7c)', () => {
  it('company mode: 4 categories + "More"; management tabs hidden until More is opened', () => {
    mockExternal = { isPlatformCatalogMode: false, isPlatformAdminView: false, activeTab: 'trend', loading: false };
    render(<ExternalApisPage />);
    expect(tabButtons()).toEqual(expect.arrayContaining(['Trend APIs', 'Social Platform APIs', 'Community APIs', 'Others', 'More']));
    expect(screen.queryByRole('button', { name: 'Approval Queue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    for (const name of ['Request New', 'Approval Queue', 'Usage Analytics']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('company mode: the active management tab stays visible even with More closed', () => {
    mockExternal = { isPlatformCatalogMode: false, isPlatformAdminView: false, activeTab: 'queue', loading: false };
    render(<ExternalApisPage />);
    expect(screen.getByRole('button', { name: 'Approval Queue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usage Analytics' })).not.toBeInTheDocument();
  });

  it('platform catalog mode: unchanged, all tabs and no More', () => {
    mockExternal = { isPlatformCatalogMode: true, isPlatformAdminView: true, activeTab: 'trend', loading: false };
    render(<ExternalApisPage />);
    for (const name of ['Trend APIs', 'Approval Queue', 'Usage Analytics']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});

describe('row actions + legend (step 7c, source-level: the row component needs the full controller)', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8') as string;
  const rows = read('components/ExternalApisSectionsA.tsx');

  it('header Test and Delete are platform-mode only; company mode gets "Details"', () => {
    expect(rows).toMatch(/\{showRunTestAndActions && isPlatformCatalogMode && \(\s*<button type="button" onClick=\{\(\) => testConnectionApi\(api\.id\)\}/);
    expect(rows).toMatch(/\{canManageExternalApis && isPlatformCatalogMode && \(\s*<button type="button" onClick=\{\(\) => \{ if \(confirm\(`Delete \$\{api\.name\}\?`\)\) deleteApi\(api\.id\)/);
    expect(rows).toMatch(/\{expanded \? 'Close' : \(isPlatformCatalogMode \? 'Configure' : 'Details'\)\}/);
  });

  it('company mode keeps Test and Delete reachable inside the details panel', () => {
    const panel = rows.slice(rows.indexOf('UI step 7c: in company mode, Test and Delete live here'));
    expect(panel).toMatch(/\{!isPlatformCatalogMode && \(/);
    expect(panel.slice(0, 1500)).toMatch(/testConnectionApi\(api\.id\)/);
    expect(panel.slice(0, 1500)).toMatch(/deleteApi\(api\.id\)/);
  });

  it('health legend is collapsed in company mode only', () => {
    const tc = read('components/ExternalApisTabContent.tsx');
    expect(tc).toMatch(/isPlatformCatalogMode \? \(/);
    expect(tc).toMatch(/<summary[^>]*>What do the health badges mean\?<\/summary>/);
  });
});

