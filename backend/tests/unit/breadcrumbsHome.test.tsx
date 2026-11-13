/**
 * @jest-environment jsdom
 *
 * UI D2: one Home. The breadcrumb Home icon goes to the Command Center (same as the logo
 * and the header Home icon), the Command Center is named "Command Center" (not
 * "Dashboard"), and it isn't repeated as a crumb after the Home icon.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

let pathname = '/';
jest.mock('next/router', () => ({ useRouter: () => ({ pathname }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import Breadcrumbs from '../../../components/layout/Breadcrumbs';
import { HOME_ROUTE } from '../../../components/layout/homeRoute';

describe('Breadcrumbs: one Home (D2)', () => {
  it('the Home icon links to the Command Center', () => {
    pathname = '/command-center/campaigns';
    render(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'Home (Command Center)' })).toHaveAttribute('href', HOME_ROUTE);
    expect(HOME_ROUTE).toBe('/command-center');
  });
  it('under the Command Center, Home is not repeated as a crumb (and never called "Dashboard")', () => {
    pathname = '/command-center/campaigns';
    render(<Breadcrumbs />);
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Command Center')).toBeNull();
    expect(screen.getByText('Campaigns')).toBeInTheDocument();
  });
  it('/dashboard is its own page now, so it keeps its crumb', () => {
    pathname = '/dashboard/settings';
    render(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
