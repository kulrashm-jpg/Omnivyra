/** @jest-environment jsdom */

/**
 * ONBOARD-006 §1 — the reusable IntegrationCard renders exactly the read-model
 * fields (name, category, status, required/optional, why, dependencies, estimate)
 * and the connect / reconnect / disconnect / learn-more actions, all routing to
 * existing surfaces. It computes nothing.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import IntegrationCard from '../../../components/onboarding/IntegrationCard';
import type { IntegrationView } from '../../../lib/integrations/integrationExperience';

const VIEW = (over: Partial<IntegrationView> = {}): IntegrationView => ({
  id: 'google_analytics', name: 'Google Analytics (GA4)', category: 'Analytics',
  provider: 'GA4', required: false, why: 'Ties content to real traffic.',
  connectHref: '/integrations?focus=data', learnMoreHref: '/integrations', estimatedMinutes: 3,
  status: 'available', detail: null, dependsOn: ['Connect your website / CMS'],
  unlocks: 'Traffic reporting.', blockedBy: [], connectedProvider: null, recommended: false,
  ...over,
});

describe('IntegrationCard', () => {
  test('renders name, category, status, why, estimate, dependency, and Connect + Learn more', () => {
    render(<IntegrationCard integration={VIEW()} />);
    expect(screen.getByText('Google Analytics (GA4)')).toBeInTheDocument();
    expect(screen.getByTestId('category')).toHaveTextContent('Analytics');
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Available');
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByText(/~3 min/)).toBeInTheDocument();
    expect(screen.getByTestId('depends-on')).toHaveTextContent('Connect your website / CMS');
    expect(screen.getByTestId('connect')).toHaveAttribute('href', '/integrations?focus=data');
    expect(screen.getByTestId('learn-more')).toHaveAttribute('href', '/integrations');
  });

  test('connected shows reconnect + disconnect, no Connect, and the connected provider', () => {
    render(<IntegrationCard integration={VIEW({ status: 'connected', connectedProvider: 'WordPress', name: 'Website / CMS', category: 'CMS' })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Connected');
    expect(screen.queryByTestId('connect')).not.toBeInTheDocument();
    expect(screen.getByTestId('reconnect')).toBeInTheDocument();
    expect(screen.getByTestId('disconnect')).toBeInTheDocument();
    expect(screen.getByText('WordPress connected')).toBeInTheDocument();
  });

  test('expired/error shows a Reconnect action', () => {
    render(<IntegrationCard integration={VIEW({ status: 'expired' })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Reconnect');
    expect(screen.getByTestId('connect')).toHaveTextContent('Reconnect');
  });

  test('blocked surfaces blocked-by and offers no Connect', () => {
    render(<IntegrationCard integration={VIEW({ status: 'blocked', blockedBy: ['Connect your website / CMS'] })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Blocked');
    expect(screen.getByTestId('blocked-by')).toHaveTextContent('Connect your website / CMS');
    expect(screen.queryByTestId('connect')).not.toBeInTheDocument();
  });

  test('detected reads as Detected and stays connectable', () => {
    render(<IntegrationCard integration={VIEW({ id: 'social_linkedin', name: 'LinkedIn', category: 'Social', status: 'detected' })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Detected');
    expect(screen.getByTestId('connect')).toBeInTheDocument();
  });

  test('required integration shows Required', () => {
    render(<IntegrationCard integration={VIEW({ required: true })} />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
