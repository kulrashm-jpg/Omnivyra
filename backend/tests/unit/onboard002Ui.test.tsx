/**
 * @jest-environment jsdom
 *
 * ONBOARD-002 §3/§4/§5 — the journey-backed dashboard onboarding card, the Platform
 * Ready completion banner, the global Resume link, blocked/required rendering, and
 * resume-after-refresh parity. All consume the server-derived journey authority.
 */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { apiFetch } from '../../../lib/apiFetch';
import DashboardOnboardingCard from '../../../components/onboarding/DashboardOnboardingCard';
import ResumeSetupLink from '../../../components/onboarding/ResumeSetupLink';
import { isOnboardingIncomplete, CANONICAL_JOURNEY_HREF } from '../../../hooks/useOnboardingJourney';

const mockApiFetch = apiFetch as jest.Mock;

function journey(over: Record<string, unknown> = {}) {
  return {
    companyId: 'c1',
    currentStep: 'company',
    platformReady: false,
    stages: [
      { id: 'company', title: 'Set up your company', why: 'Creates your workspace', mandatory: true, skippable: false, dismissible: false, dependsOn: [], href: '/onboarding/company', status: 'in_progress', detail: null },
      { id: 'social_accounts', title: 'Connect social accounts', why: 'Publishing needs a channel', mandatory: false, skippable: true, dismissible: true, dependsOn: ['company'], href: '/social-platforms', status: 'blocked', detail: null },
    ],
    readiness: {
      platformReady: false,
      reason: 'Blocked by required step: Set up your company.',
      blockingItems: [{ id: 'company', title: 'Set up your company' }],
      remainingItems: [],
      completionPercentage: 40,
      estimatedRemainingTime: '~10 min',
      recommendations: [{ id: 'company', title: 'Set up your company', why: 'Creates your workspace', href: '/onboarding/company' }],
    },
    ...over,
  };
}

function mockJourney(j: any) {
  mockApiFetch.mockResolvedValue({ ok: true, json: async () => j } as any);
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => cleanup());

describe('ONBOARD-002 §3 — dashboard onboarding card', () => {
  test('incomplete → progress, current stage, required actions, continue, blocked note', async () => {
    mockJourney(journey());
    render(<DashboardOnboardingCard />);
    await waitFor(() => expect(screen.getByText('Finish setting up Omnivyra')).toBeInTheDocument());
    expect(screen.getByText('40% complete')).toBeInTheDocument();
    expect(screen.getByText(/Current step:/)).toBeInTheDocument();
    expect(screen.getAllByText('Set up your company').length).toBeGreaterThan(0); // current + action
    expect(screen.getByText('Continue setup →').closest('a')).toHaveAttribute('href', CANONICAL_JOURNEY_HREF);
    expect(screen.getByText(/waiting on earlier steps/)).toBeInTheDocument(); // blocked state (§3)
  });

  test('platformReady → completion banner replaces the card (§3/§7)', async () => {
    mockJourney(journey({ platformReady: true, currentStep: 'platform_ready', readiness: { ...journey().readiness, platformReady: true, completionPercentage: 100 } }));
    render(<DashboardOnboardingCard />);
    await waitFor(() => expect(screen.getByText('🎉 Platform Ready')).toBeInTheDocument());
    expect(screen.queryByText('Finish setting up Omnivyra')).not.toBeInTheDocument();
  });

  test('required-only (no blocked) journey renders actions without the blocked note', async () => {
    const j = journey({ stages: [{ id: 'company', title: 'Set up your company', why: 'x', mandatory: true, skippable: false, dismissible: false, dependsOn: [], href: '/onboarding/company', status: 'in_progress', detail: null }] });
    mockJourney(j);
    render(<DashboardOnboardingCard />);
    await waitFor(() => expect(screen.getByText('Finish setting up Omnivyra')).toBeInTheDocument());
    expect(screen.queryByText(/waiting on earlier steps/)).not.toBeInTheDocument();
  });
});

describe('ONBOARD-002 §4 — global resume link', () => {
  test('renders when incomplete, points at the canonical journey', async () => {
    mockJourney(journey());
    render(<ResumeSetupLink />);
    await waitFor(() => expect(screen.getByText(/Resume setup/)).toBeInTheDocument());
    expect(screen.getByText(/Resume setup/).closest('a')).toHaveAttribute('href', CANONICAL_JOURNEY_HREF);
  });

  test('renders nothing when Platform Ready', async () => {
    mockJourney(journey({ platformReady: true }));
    const { container } = render(<ResumeSetupLink />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('ONBOARD-002 §5/parity — resume-after-refresh + helpers', () => {
  test('re-mount (refresh) re-derives from the server → identical card', async () => {
    mockJourney(journey());
    const first = render(<DashboardOnboardingCard />);
    await waitFor(() => expect(screen.getByText('40% complete')).toBeInTheDocument());
    first.unmount();
    render(<DashboardOnboardingCard />); // simulate refresh
    await waitFor(() => expect(screen.getByText('40% complete')).toBeInTheDocument());
  });

  test('isOnboardingIncomplete reflects server platformReady only', () => {
    expect(isOnboardingIncomplete(null)).toBe(false);
    expect(isOnboardingIncomplete(journey() as any)).toBe(true);
    expect(isOnboardingIncomplete(journey({ platformReady: true }) as any)).toBe(false);
  });
});
