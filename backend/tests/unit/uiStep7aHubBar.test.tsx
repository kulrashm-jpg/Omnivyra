/**
 * @jest-environment jsdom
 *
 * UI step 7a: the shared integration hub bar on /external-apis (not in super-admin
 * platform catalog mode) and on /social-platforms, the "Social Platforms" title, and a
 * visible link to /external-apis-access.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

jest.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/', asPath: '/', query: {}, push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({ selectedCompanyId: 'co-1', userRole: 'COMPANY_ADMIN', isAdmin: true, companies: [] }),
}));

/** A stub for the pages' state hooks: arrays empty, functions inert, flags false. */
function stubState(overrides: Record<string, unknown>) {
  return new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop in overrides) return overrides[prop];
        if (/^(set|handle|load|toggle|update|validate|add|remove|delete|test|save|open|close|submit|apply|refresh|fetch|run|select|clear)/.test(prop)) return jest.fn();
        if (/(s|List|Apis|Accounts|Requests|Presets|Tabs|Items|Rows)$/.test(prop)) return [];
        return undefined;
      },
    },
  );
}

let mockExternal: Record<string, unknown> = {};
jest.mock('../../../hooks/useExternalApisState', () => ({
  useExternalApisState: () => stubState(mockExternal),
}));
jest.mock('../../../components/ExternalApisTabContent', () => () => null);

// eslint-disable-next-line import/first
import ExternalApisPage from '../../../pages/external-apis';
// eslint-disable-next-line import/first
import SocialPlatformsView from '../../../components/SocialPlatformsView';

function currentHubItem() {
  const hub = screen.getByRole('navigation', { name: 'Integration areas' });
  const current = within(hub).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  return current[0];
}

describe('/external-apis hub bar', () => {
  it('company mode: shows the hub bar with "API Integrations" current, and links to access', () => {
    mockExternal = { isPlatformCatalogMode: false, activeTab: 'trend', loading: false };
    render(<ExternalApisPage />);
    expect(currentHubItem()).toHaveTextContent('API Integrations');
    expect(screen.getByRole('link', { name: 'Manage company access' })).toHaveAttribute('href', '/external-apis-access');
  });

  it('platform catalog mode (super admin): no hub bar', () => {
    mockExternal = { isPlatformCatalogMode: true, activeTab: 'trend', loading: false };
    render(<ExternalApisPage />);
    expect(screen.queryByRole('navigation', { name: 'Integration areas' })).not.toBeInTheDocument();
    expect(screen.getByText('← Back to Super Admin')).toBeInTheDocument();
  });
});

describe('/social-platforms hub bar and title', () => {
  it('shows the hub bar with "Social Platforms" current and the matching title', () => {
    const d = stubState({ loading: true, activeTab: 'social', connectedCount: 0, notice: null });
    render(<SocialPlatformsView d={d as any} />);
    expect(currentHubItem()).toHaveTextContent('Social Platforms');
    expect(screen.getByRole('heading', { level: 1, name: 'Social Platforms' })).toBeInTheDocument();
    expect(screen.queryByText('API Connections')).not.toBeInTheDocument();
  });
});
