/**
 * @jest-environment jsdom
 *
 * Owner rule 3 (e9): the preemption subsystem is undeployed, so on campaign details →
 * Settings the Preemption History panel would only ever say "No preemption activity".
 * It now renders nothing unless there is at least one preemption event.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { PreemptionHistory, type GovernanceEvent } from '../../../components/governance/PreemptionHistory';

const ev = (eventType: string, id = eventType): GovernanceEvent => ({
  id,
  campaignId: 'c1',
  eventType,
  eventStatus: 'DONE',
  metadata: { targetCampaignId: 'Spring launch', justification: 'Higher priority' },
  createdAt: '2026-11-10T09:00:00Z',
});

describe('PreemptionHistory', () => {
  it('renders nothing when there are no events', () => {
    const { container } = render(<PreemptionHistory events={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when there are only NON-preemption events', () => {
    const { container } = render(<PreemptionHistory events={[ev('DURATION_NEGOTIATED'), ev('FREEZE_BLOCK')]} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('No preemption activity.')).toBeNull();
  });

  it('shows the panel with the rows when there is a preemption event', () => {
    render(<PreemptionHistory events={[ev('PREEMPTION_EXECUTED'), ev('DURATION_NEGOTIATED')]} />);
    expect(screen.getByRole('heading', { name: 'Preemption History' })).toBeInTheDocument();
    expect(screen.getByText('Spring launch')).toBeInTheDocument();
    expect(screen.getByText('Higher priority')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + the one preemption event
  });
});
