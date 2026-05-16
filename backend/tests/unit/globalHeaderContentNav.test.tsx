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
  test('Writer Content expands to all 9 writer content types without category navigation', () => {
    renderHeader();
    const menu = openDesktopContentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Writer Content/i }));

    expect(push).not.toHaveBeenCalled();
    expect(within(menu).getByText('9 text-first content types')).toBeInTheDocument();
    ['Post', 'Thread', 'Blog', 'Newsletter', 'Ad Copy', 'Product Copy', 'Landing Page', 'SEO Content', 'Script']
      .forEach((label) => expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument());
  });

  test('Creator Content expands to all 6 creator content types', () => {
    renderHeader();
    const menu = openDesktopContentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Creator Content/i }));

    expect(within(menu).getByText('6 AI-supported creator content types')).toBeInTheDocument();
    ['Supporting Image', 'Banner', 'Infographic', 'Carousel', 'Brand Card', 'PDF/Slider']
      .forEach((label) => expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument());
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

  test('mobile Content menu uses nested accordion behavior', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }));
    const writerAccordion = screen.getAllByRole('button', { name: /Writer Content/i }).find((button) =>
      button.getAttribute('aria-expanded') === 'false'
    );
    expect(writerAccordion).toBeDefined();
    fireEvent.click(writerAccordion as HTMLElement);
    expect((writerAccordion as HTMLElement).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'SEO Content' })).toHaveAttribute('href', '/command-center/writer-content?type=seo-content');
  });

  test('counts, routes, and active item state are preserved', () => {
    expect(CONTENT_NAV_SECTIONS.find((section) => section.id === 'writer')?.description).toBe('9 text-first content types');
    expect(CONTENT_NAV_SECTIONS.find((section) => section.id === 'creator')?.description).toBe('6 AI-supported creator content types');
    expect(getContentNavRoutes().every((route) => route.startsWith('/'))).toBe(true);

    renderHeader('/command-center/creator-content/banner');
    const menu = openDesktopContentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Creator Content/i }));
    expect(within(menu).getByRole('menuitem', { name: 'Banner' })).toHaveClass('bg-sky-600');
  });
});
