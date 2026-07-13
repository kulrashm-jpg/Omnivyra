/** @jest-environment jsdom */

/**
 * ONBOARD-005 §2 — the reusable SetupCard renders exactly the server-derived
 * card fields (title, status, why, guidance, required action, skip/dismiss when
 * allowed, estimate, dependencies, providers) and computes nothing itself.
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SetupCard from '../../../components/onboarding/SetupCard';
import type { JourneyStage } from '../../../hooks/useOnboardingJourney';

const STAGE = (over: Partial<JourneyStage> = {}): JourneyStage => ({
  id: 'website_cms',
  title: 'Connect your website / CMS',
  why: 'Lets Omnivyra publish blogs to your site.',
  mandatory: false,
  skippable: true,
  dismissible: true,
  dependsOn: ['company'],
  href: '/website-setup',
  status: 'pending',
  detail: 'Not connected yet',
  estimatedMinutes: 5,
  dependencies: [{ id: 'company', title: 'Set up your company', met: true }],
  guidance: { unlocks: 'Publishing blogs and analytics.', blockedWithout: 'Analytics can’t attach yet.' },
  ...over,
});

describe('SetupCard', () => {
  test('renders title, status, why, guidance unlocks, estimate, and the continue action', () => {
    render(<SetupCard stage={STAGE()} />);
    expect(screen.getByText('Connect your website / CMS')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Pending');
    expect(screen.getByText(/publish blogs to your site/i)).toBeInTheDocument();
    expect(screen.getByText(/Unlocks: Publishing blogs and analytics/i)).toBeInTheDocument();
    expect(screen.getByText(/~5 min/)).toBeInTheDocument();
    expect(screen.getByTestId('continue')).toHaveAttribute('href', '/website-setup');
    expect(screen.getByText('Optional')).toBeInTheDocument();
  });

  test('skip / dismiss fire the action handler only when allowed', () => {
    const onAction = jest.fn();
    render(<SetupCard stage={STAGE()} onAction={onAction} />);
    fireEvent.click(screen.getByText('Skip for now'));
    expect(onAction).toHaveBeenCalledWith('website_cms', 'skip');
    fireEvent.click(screen.getByText("Don't need this"));
    expect(onAction).toHaveBeenCalledWith('website_cms', 'dismiss');
  });

  test('mandatory stage shows Required and offers no skip/dismiss', () => {
    render(<SetupCard stage={STAGE({ mandatory: true, skippable: false, dismissible: false, title: 'Set up your company', id: 'company' })} onAction={jest.fn()} />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('Skip for now')).not.toBeInTheDocument();
  });

  test('blocked stage surfaces unmet dependencies and blocked guidance, hides the action', () => {
    render(<SetupCard stage={STAGE({ status: 'blocked', dependencies: [{ id: 'website_cms', title: 'Connect your website / CMS', met: false }] })} onAction={jest.fn()} />);
    expect(screen.getByTestId('deps')).toHaveTextContent('Connect your website / CMS');
    expect(screen.getByText(/Analytics can’t attach yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('continue')).not.toBeInTheDocument();
  });

  test('providers render with connected + detected states (§6)', () => {
    render(<SetupCard stage={STAGE({
      id: 'social_accounts', title: 'Connect social accounts',
      providers: [{ platform: 'x', state: 'connected' }, { platform: 'linkedin', state: 'detected' }],
    })} onAction={jest.fn()} />);
    const providers = screen.getByTestId('providers');
    expect(providers).toHaveTextContent('x: connected');
    expect(providers).toHaveTextContent('linkedin: detected');
  });

  test('completed stage shows the check and offers no actions', () => {
    render(<SetupCard stage={STAGE({ status: 'completed' })} onAction={jest.fn()} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Completed');
    expect(screen.queryByTestId('continue')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip for now')).not.toBeInTheDocument();
  });
});
