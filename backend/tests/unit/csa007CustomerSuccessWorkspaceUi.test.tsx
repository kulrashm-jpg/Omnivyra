/** @jest-environment jsdom */

/**
 * CSA-007 §1/§6/§8 — the CustomerSuccessWorkspace component renders every section
 * from the composed view, links actions/playbooks to existing surfaces, and fires
 * read-only telemetry on section view / playbook open. It computes nothing.
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomerSuccessWorkspace from '../../../components/customerSuccess/CustomerSuccessWorkspace';
import type { CustomerSuccessWorkspace as WorkspaceView } from '../../../lib/customerSuccess/workspace';

const WORKSPACE: WorkspaceView = {
  companyId: 'org1', generatedAt: '2026-07-14T00:00:00.000Z',
  sections: ['overview', 'health', 'lifecycle', 'platform_ready', 'usage', 'next_best_action', 'recommended_actions', 'playbooks'],
  overview: { companyId: 'org1', lifecycleStage: 'ONBOARDING', healthState: 'AT_RISK', healthScore: 30, platformReady: false },
  health: { score: 30, state: 'AT_RISK', riskLevel: 'HIGH', majorContributors: [], recommendedImprovements: ['Complete Website / CMS.'] },
  lifecycle: { stage: 'ONBOARDING', previousStage: null, transitionReason: 'Initial lifecycle classification.', trajectory: 'UNKNOWN', nextMilestone: 'Activated' },
  platformReady: { ready: false, readinessScore: 30 },
  usage: { totalEvents: 0, activeUsers: 0, activeDays: 0, capabilitiesUsed: [] },
  nextBestAction: { id: 'complete_onboarding', title: 'Complete onboarding', priorityTier: 'CRITICAL', reason: 'Setup gates the platform.', expectedImpact: 'Unlocks everything.', href: '/onboarding/journey' },
  recommendedActions: [{ id: 'complete_onboarding', title: 'Complete onboarding', priorityTier: 'CRITICAL', reason: 'Setup gates the platform.', expectedImpact: 'Unlocks everything.', href: '/onboarding/journey' }],
  playbooks: {
    recommended: { id: 'onboarding_playbook', actionId: 'complete_onboarding', title: 'Onboarding Playbook', objective: 'Reach Platform Ready.', expectedOutcome: 'Platform Ready.', status: 'AVAILABLE', steps: [{ title: 'Verify email', description: 'x', required: true }], progress: { completed: 0, total: 1 }, href: '/onboarding/journey' },
    all: [{ id: 'onboarding_playbook', actionId: 'complete_onboarding', title: 'Onboarding Playbook', objective: 'Reach Platform Ready.', expectedOutcome: 'Platform Ready.', status: 'AVAILABLE', steps: [{ title: 'Verify email', description: 'x', required: true }], progress: { completed: 0, total: 1 }, href: '/onboarding/journey' }],
  },
};

describe('CustomerSuccessWorkspace', () => {
  test('renders health, lifecycle, usage, next best action, and playbook sections', () => {
    render(<CustomerSuccessWorkspace workspace={WORKSPACE} />);
    expect(screen.getByTestId('cs-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('health-card')).toHaveTextContent('AT_RISK · 30/100');
    expect(screen.getByTestId('lifecycle-card')).toHaveTextContent('ONBOARDING');
    expect(screen.getByTestId('usage-card')).toHaveTextContent('0 active day');
    // The next-best action + recommended playbook legitimately render in two
    // sections, so these test-ids appear more than once.
    expect(screen.getAllByTestId('action-complete_onboarding')[0]).toHaveTextContent('Complete onboarding');
    expect(screen.getAllByTestId('playbook-onboarding_playbook')[0]).toHaveTextContent('Onboarding Playbook');
  });

  test('actions and playbooks link to existing surfaces (§6)', () => {
    render(<CustomerSuccessWorkspace workspace={WORKSPACE} />);
    const actionLink = screen.getAllByTestId('action-complete_onboarding')[0].querySelector('a');
    expect(actionLink).toHaveAttribute('href', '/onboarding/journey');
    expect(screen.getAllByTestId('playbook-open-onboarding_playbook')[0]).toHaveAttribute('href', '/onboarding/journey');
  });

  test('fires telemetry on section view and playbook open (§8)', () => {
    const onTelemetry = jest.fn();
    render(<CustomerSuccessWorkspace workspace={WORKSPACE} onTelemetry={onTelemetry} />);
    fireEvent.mouseEnter(screen.getByTestId('section-health'));
    expect(onTelemetry).toHaveBeenCalledWith('section_view', 'health');
    fireEvent.click(screen.getAllByTestId('playbook-open-onboarding_playbook')[0]);
    expect(onTelemetry).toHaveBeenCalledWith('playbook_open', 'onboarding_playbook');
  });
});
