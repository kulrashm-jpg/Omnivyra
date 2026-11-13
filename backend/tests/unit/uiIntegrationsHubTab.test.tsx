/**
 * @jest-environment jsdom
 *
 * UI step 5a — /integrations is the hub's "Website & Analytics" section.
 * The page used to pass active="api", so it highlighted "API Integrations" (which
 * links away to /external-apis) and its Analytics & data view had no nav path.
 * Spine extended 2026-11-13 by coordinator approval; PI hub owner (e1) conditions:
 * exactly ONE hub item is aria-current on this page, and it is "Website & Analytics",
 * for BOTH focus=website and focus=data.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

jest.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/integrations', query: {}, push: jest.fn(), replace: jest.fn() }),
}));

// The page is a thin composition over this controller (all state/effects/fetching).
// A stub keeps the test about navigation: empty data, nothing loading, no flows open.
let mockFocus: 'website' | 'data' = 'website';
const ARRAY_FIELDS = new Set([
  'blogIntegrations', 'categoryCards', 'connectedPublishing', 'displayWebsites', 'failedPublishing',
  'integrations', 'leadIntegrations', 'providerCards', 'realWebsites', 'visibleCategoryCards', 'websites',
]);
jest.mock('../../../components/integrationsController', () => ({
  useIntegrationsPageController: () =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'focus') return mockFocus;
          if (prop === 'focusParam') return mockFocus;
          if (prop === 'showWebsiteFlow' || prop === 'showDataFlow') return false;
          if (prop === 'loading') return false;
          if (prop === 'isAdmin') return false;
          if (prop === 'highlightedIds') return new Set<string>();
          if (ARRAY_FIELDS.has(prop)) return [];
          if (prop.startsWith('set') || prop.startsWith('handle') || prop.startsWith('load')) return jest.fn();
          return undefined;
        },
      },
    ),
}));

// eslint-disable-next-line import/first
import IntegrationsPage from '../../../components/integrationsMain';

describe('/integrations — hub section and Website/Analytics switch', () => {
  for (const focus of ['website', 'data'] as const) {
    it(`focus=${focus}: exactly one hub item is current, and it is "Website & Analytics"`, () => {
      mockFocus = focus;
      render(<IntegrationsPage />);
      const hub = screen.getByRole('navigation', { name: 'Integration areas' });
      const current = within(hub).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent('Website & Analytics');
      expect(within(hub).getByText('API Integrations')).not.toHaveAttribute('aria-current');
    });

    it(`focus=${focus}: the view switch links both views and marks this one`, () => {
      mockFocus = focus;
      render(<IntegrationsPage />);
      const sw = screen.getByRole('navigation', { name: 'Website and analytics views' });
      const website = within(sw).getByRole('link', { name: 'Website & publishing' });
      const data = within(sw).getByRole('link', { name: 'Analytics & data' });
      expect(website).toHaveAttribute('href', '/integrations?focus=website');
      expect(data).toHaveAttribute('href', '/integrations?focus=data');
      expect(focus === 'website' ? website : data).toHaveAttribute('aria-current', 'true');
      expect(focus === 'website' ? data : website).not.toHaveAttribute('aria-current');
    });
  }
});
