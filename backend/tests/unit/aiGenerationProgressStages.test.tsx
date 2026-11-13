/**
 * @jest-environment jsdom
 *
 * UI step 2 — AIGenerationProgress gains optional `stages` (step-by-step via the shared
 * StepTracker). Without `stages` the rendered markup must be byte-identical to the
 * pre-change component: the fixture was captured from origin/main ecfc2baf1 with the
 * same props and the same frozen clock.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AIGenerationProgress, { toStepDefs } from '@/components/AIGenerationProgress';
import base from '../fixtures/ui/aiGenerationProgress.base.json';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
});
afterEach(() => {
  jest.useRealTimers();
});

describe('AIGenerationProgress without stages (default rendering unchanged)', () => {
  it('basic props after 5s match the pre-change markup', () => {
    const { container } = render(<AIGenerationProgress isActive message="Generating strategic themes…" />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(container.innerHTML).toBe(base.basic5s);
  });

  it('all optional props after 20s match the pre-change markup', () => {
    const { container } = render(
      <AIGenerationProgress
        isActive
        message="Working"
        expectedSeconds={10}
        maxSecondsHint={180}
        rotatingMessages={['one', 'two']}
        onCancel={() => {}}
        className="mt-4"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(20000);
    });
    expect(container.innerHTML).toBe(base.full20s);
  });

  it('inactive renders nothing, as before', () => {
    const { container } = render(<AIGenerationProgress isActive={false} message="x" />);
    expect(container.innerHTML).toBe(base.inactive);
  });

  it('an empty stages array keeps the default rendering', () => {
    const { container } = render(<AIGenerationProgress isActive message="Generating strategic themes…" stages={[]} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(container.innerHTML).toBe(base.basic5s);
  });
});

describe('toStepDefs', () => {
  it('splits expectedSeconds evenly across bare labels', () => {
    expect(toStepDefs(['a', 'b', 'c'], 45).map((s) => s.etaSeconds)).toEqual([15, 15, 15]);
  });

  it('keeps explicit ETAs and shares the remainder among the rest', () => {
    expect(toStepDefs([{ label: 'a', etaSeconds: 20 }, 'b', 'c'], 40).map((s) => s.etaSeconds)).toEqual([20, 10, 10]);
  });

  it('never yields a zero ETA when explicit ETAs exceed expectedSeconds', () => {
    const defs = toStepDefs([{ label: 'a', etaSeconds: 60 }, 'b'], 30);
    expect(defs.map((s) => s.etaSeconds)).toEqual([60, 1]);
  });

  it('gives stable, unique keys and keeps labels', () => {
    const defs = toStepDefs(['Reading your brief', { label: 'Drafting' }], 10);
    expect(defs.map((s) => s.key)).toEqual(['ai-stage-1', 'ai-stage-2']);
    expect(defs.map((s) => s.label)).toEqual(['Reading your brief', 'Drafting']);
  });
});

describe('AIGenerationProgress with stages (step-by-step)', () => {
  const STAGES = ['Reading your brief', 'Drafting ideas', 'Polishing'];

  it('renders every step titled with the message, first step current', () => {
    render(<AIGenerationProgress isActive message="Generating content" expectedSeconds={30} stages={STAGES} />);
    expect(screen.getByText('Generating content')).toBeInTheDocument();
    expect(screen.getByText('Reading your brief', { exact: false }).className).toContain('text-gray-800');
    expect(screen.getByText('Polishing', { exact: false }).className).toContain('text-gray-300');
  });

  it('advances through steps over time and holds on the last one', () => {
    render(<AIGenerationProgress isActive message="Generating content" expectedSeconds={30} stages={STAGES} />);
    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(screen.getByText('Reading your brief', { exact: false }).className).toContain('line-through');
    expect(screen.getByText('Drafting ideas', { exact: false }).className).toContain('text-gray-800');
    act(() => {
      jest.advanceTimersByTime(600_000);
    });
    expect(screen.getByText('Polishing', { exact: false }).className).toContain('text-gray-800');
    expect(screen.queryByText(/— done/)).not.toBeInTheDocument();
  });

  it('shows rotating messages as the sub-label and keeps Cancel working', () => {
    const onCancel = jest.fn();
    render(
      <AIGenerationProgress
        isActive
        message="Generating content"
        stages={STAGES}
        rotatingMessages={['Tip one', 'Tip two']}
        onCancel={onCancel}
      />,
    );
    // Step view is active (not the single-line fallback).
    expect(screen.getByText('Drafting ideas', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Tip one')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(3300);
    });
    expect(screen.getByText('Tip two')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when inactive', () => {
    const { container } = render(<AIGenerationProgress isActive={false} message="x" stages={STAGES} />);
    expect(container.innerHTML).toBe('');
  });
});
