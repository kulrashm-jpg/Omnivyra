/**
 * @jest-environment jsdom
 *
 * e9 ruling 2026-11-13: /external-apis-access stays for launch (it owns per-company API
 * config) and carries the integration hub bar, with "API Integrations" current, so the
 * user is never stranded.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

jest.mock('next/router', () => ({ useRouter: () => ({ pathname: '/external-apis-access', query: {}, push: jest.fn() }) }));
jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ({ selectedCompanyId: 'co-1' }) }));
jest.mock('../../../components/ExtApisAccessViewController', () => ({
  useExtApisAccessViewController: ({ d }: { d: unknown }) =>
    new Proxy({ d }, {
      get: (t: any, p: string) => {
        if (p in t) return t[p];
        if (/^(set|load|save|submit|update|toggle|handle)/.test(p)) return jest.fn();
        if (/(s|Apis|Presets|Requests|Defaults|Totals)$/.test(p)) return [];
        return undefined;
      },
    }),
}));
jest.mock('../../../components/ExtApisAccessSectionsA', () => () => null);
jest.mock('../../../components/ExtApisAccessSectionsB', () => () => null);

// eslint-disable-next-line import/first
import ExtApisAccessView from '../../../components/ExtApisAccessView';

it('renders the integration hub bar with "API Integrations" current', () => {
  render(<ExtApisAccessView d={{} as any} />);
  const hub = screen.getByRole('navigation', { name: 'Integration areas' });
  const current = within(hub).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  expect(current[0]).toHaveTextContent('API Integrations');
  expect(screen.getByRole('heading', { level: 1, name: 'External API Access' })).toBeInTheDocument();
});
