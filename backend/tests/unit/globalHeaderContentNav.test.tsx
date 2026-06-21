/**
 * @jest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GlobalHeader from '../../../components/layout/GlobalHeader';
import { CONTENT_NAV_SECTIONS, getContentNavRoutes } from '../../../components/layout/contentNavigationConfig';

const push = jest.fn();
let pathname = '/dashboard';
let asPath = '/dashboard';

jest.mock('next/router', () => ({
  useRouter: () => ({
    pathname,
    asPath,
    push,
  }),
}));

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return <a href={href} {...props}>{children}</a>;
  };
});

jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({
    userName: 'Kai',
    selectedCompanyId: 'company-1',
    userRole: 'COMPANY_ADMIN',
    isAuthenticated: true,
  }),
}));

jest.mock('@/hooks/useCredits', () => ({
  useCredits: () => ({ totalCredits: 100, remainingCredits: 80 }),
}));

jest.mock('../../../components/tour/TourContext', () => ({
  useTour: () => ({ startTour: jest.fn() }),
}));

jest.mock('../../../components/tour/TourOverlay', () => ({
  TourOverlay: () => null,
}));

jest.mock('../../../components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

function renderHeader(route = '/dashboard') {
  pathname = route.split('?')[0];
  asPath = route;
  push.mockClear();
  render(<GlobalHeader />);
}

function openDesktopContentMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Content/i }));
  return screen.getByRole('menu', { name: /Content menu/i });
}

describe('GlobalHeader Content expandable navigation', () => {
  test('Writer Content is expanded by default and lists all 5 writer content types', () => {
    renderHeader();
    const menu = openDesktopContentMenu();

    expect(within(menu).getByText('5 text-first content types')).toBeInTheDocument();
    ['Post', 'Blog', 'Article', 'Story', 'Thread']
      .forEach((label) => expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument());
    // Retired writer types are no longer surfaced in the launcher.
    ['Whitepaper', 'Case Study', 'Guide', 'Newsletter']
      .forEach((label) => expect(within(menu).queryByRole('menuitem', { name: label })).not.toBeInTheDocument());
  });

  test('hovering Creator Content reveals all 3 creator content types', () => {
    renderHeader();
    const menu = openDesktopContentMenu();
    fireEvent.mouseEnter(within(menu).getByRole('menuitem', { name: /Creator Content/i }));

    expect(within(menu).getByText('3 AI-supported creator content types')).toBeInTheDocument();
    ['Image', 'Carousel', 'Infographic']
      .forEach((label) => expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument());
  });

  test('clicking a section header navigates to its landing page', () => {
    renderHeader();
    let menu = openDesktopContentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Writer Content/i }));
    expect(push).toHaveBeenCalledWith('/command-center/writer-content');

    push.mockClear();
    menu = openDesktopContentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Creator Content/i }));
    expect(push).toHaveBeenCalledWith('/command-center/creator-content');
  });

  test('clicking a content item routes to the configured page', () => {
    renderHeader();
    const menu = openDesktopContentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Thread' }));
    expect(push).toHaveBeenCalledWith('/threads/create');
  });

  test('keyboard navigation switches section and enter selects the focused item', () => {
    renderHeader();
    const menu = openDesktopContentMenu();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/command-center/creator-content/image');
  });

  test('mobile Content menu links section headers to their landing pages with sub-items always visible', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }));

    expect(screen.getByRole('link', { name: /Writer Content/i })).toHaveAttribute('href', '/command-center/writer-content');
    expect(screen.getByRole('link', { name: /Creator Content/i })).toHaveAttribute('href', '/command-center/creator-content');
    // Sub-items are rendered without needing to expand an accordion.
    expect(screen.getByRole('link', { name: /Article/i })).toHaveAttribute('href', '/articles/create');
    expect(screen.getByRole('link', { name: /Infographic/i })).toHaveAttribute('href', '/command-center/creator-content/infographic');
  });

  test('counts, routes, and active item state are preserved', () => {
    expect(CONTENT_NAV_SECTIONS.find((section) => section.id === 'writer')?.description).toBe('5 text-first content types');
    expect(CONTENT_NAV_SECTIONS.find((section) => section.id === 'creator')?.description).toBe('3 AI-supported creator content types');
    expect(getContentNavRoutes().every((route) => route.startsWith('/'))).toBe(true);

    renderHeader('/command-center/creator-content/carousel');
    const menu = openDesktopContentMenu();
    // The active route auto-expands the Creator section on open (no click needed).
    expect(within(menu).getByRole('menuitem', { name: 'Carousel' })).toHaveClass('bg-sky-600');
  });
});
