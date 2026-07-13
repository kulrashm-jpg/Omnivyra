/** @jest-environment jsdom */

/**
 * ONBOARD-007 §3 — the reusable ActivationDashboard renders the activation
 * read-model: Platform Ready, capability availability (with unlock explanations
 * for unavailable ones), recently unlocked, next recommended, and optional
 * enhancements. It computes nothing.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ActivationDashboard from '../../../components/onboarding/ActivationDashboard';
import type { PlatformActivation, CapabilityView } from '../../../lib/activation/platformActivation';

const capability = (over: Partial<CapabilityView> & { id: string; name: string }): CapabilityView => ({
  why: 'does a thing', status: 'available', missingPrerequisites: [], unlocks: 'more', actionHref: null, recommended: false,
  ...over,
});

const ACTIVATION = (over: Partial<PlatformActivation> = {}): PlatformActivation => ({
  platformReady: false,
  completionPercentage: 60,
  capabilities: [
    capability({ id: 'content_writer', name: 'Content Writer', status: 'available' }),
    capability({ id: 'analytics', name: 'Analytics', status: 'unavailable', missingPrerequisites: ['Google Analytics (GA4)'], unlocks: 'Traffic reporting.', actionHref: '/integrations?focus=data' }),
    capability({ id: 'publishing', name: 'Publishing', status: 'requires_setup', missingPrerequisites: ['a connected website or social channel'], unlocks: 'Publishing.', actionHref: '/onboarding/integrations' }),
  ],
  recentlyUnlocked: [capability({ id: 'content_writer', name: 'Content Writer', status: 'available' })],
  nextRecommended: [{ integrationId: 'website_cms', name: 'Website / CMS', href: '/website-setup', unlocks: ['Analytics', 'SEO'] }],
  optionalImprovements: [{ id: 'improve_company_profile', label: 'Improve your company profile', why: 'sharper output', href: '/company-profile' }],
  ...over,
});

describe('ActivationDashboard', () => {
  test('renders capability statuses and the unavailable capability’s missing prereq + unlocks', () => {
    render(<ActivationDashboard activation={ACTIVATION()} />);
    expect(screen.getByTestId('capability-content_writer')).toHaveAttribute('data-status', 'available');
    const analytics = screen.getByTestId('capability-analytics');
    expect(analytics).toHaveAttribute('data-status', 'unavailable');
    expect(screen.getByText(/Needs: Google Analytics/)).toBeInTheDocument();
    expect(screen.getByText(/Unlocks: Traffic reporting/)).toBeInTheDocument();
    expect(screen.getAllByTestId('capability-action').length).toBeGreaterThan(0);
  });

  test('shows in-progress Platform Ready with the authority completion percentage', () => {
    render(<ActivationDashboard activation={ACTIVATION()} />);
    const banner = screen.getByTestId('platform-ready');
    expect(banner).toHaveAttribute('data-ready', 'false');
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  test('shows the Platform Ready banner when ready', () => {
    render(<ActivationDashboard activation={ACTIVATION({ platformReady: true })} />);
    expect(screen.getByTestId('platform-ready')).toHaveAttribute('data-ready', 'true');
    expect(screen.getByText(/Your platform is ready/)).toBeInTheDocument();
  });

  test('renders next recommended (with unlocks) and optional enhancements', () => {
    render(<ActivationDashboard activation={ACTIVATION()} />);
    expect(screen.getByTestId('next-website_cms')).toHaveTextContent('Connect Website / CMS');
    expect(screen.getByTestId('next-website_cms')).toHaveTextContent('Analytics, SEO');
    expect(screen.getByTestId('optional-improve_company_profile')).toHaveTextContent('Improve your company profile');
  });

  test('recommended capability shows the recommended set-up affordance', () => {
    render(<ActivationDashboard activation={ACTIVATION({
      capabilities: [capability({ id: 'analytics', name: 'Analytics', status: 'recommended', missingPrerequisites: ['Google Analytics (GA4)'], unlocks: 'Traffic.', actionHref: '/x', recommended: true })],
    })} />);
    expect(screen.getByTestId('capability-analytics')).toHaveAttribute('data-status', 'recommended');
    expect(screen.getByText(/Set up \(recommended\)/)).toBeInTheDocument();
  });
});
