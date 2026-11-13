/**
 * @jest-environment jsdom
 *
 * UI step 1 — company-profile "Refine with AI" shows step-by-step progress via the
 * shared StepTracker, using the existing REFINE_STEPS / REFINE_STEP_DELAYS.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import CompanyProfileRefineProgress, {
  buildRefineStages,
  FINAL_STEP_ETA_SECONDS,
} from '@/components/company/CompanyProfileRefineProgress';

// Mirrors hooks/useCompanyProfileState.tsx REFINE_STEPS / REFINE_STEP_DELAYS.
const STEPS = [
  'Crawling website…',
  'Reading social profiles & digital assets…',
  'Cleaning and analysing evidence…',
  'Extracting profile fields with AI…',
  'Saving updated profile…',
];
const DELAYS = [0, 9000, 20000, 28000, 40000];

describe('buildRefineStages', () => {
  it('derives each ETA from the gap to the next step, final step uses the fallback', () => {
    const stages = buildRefineStages(STEPS, DELAYS);
    expect(stages.map((s) => s.etaSeconds)).toEqual([9, 11, 8, 12, FINAL_STEP_ETA_SECONDS]);
    expect(stages.map((s) => s.key)).toEqual([
      'refine-step-1', 'refine-step-2', 'refine-step-3', 'refine-step-4', 'refine-step-5',
    ]);
  });

  it('strips the trailing ellipsis from labels', () => {
    expect(buildRefineStages(STEPS, DELAYS)[0].label).toBe('Crawling website');
    expect(buildRefineStages(['Saving...'], [0])[0].label).toBe('Saving');
  });

  it('never yields a zero or negative ETA for missing / non-increasing offsets', () => {
    const stages = buildRefineStages(['a', 'b', 'c'], [0, 0]);
    expect(stages.every((s) => (s.etaSeconds ?? 0) > 0)).toBe(true);
  });
});

describe('CompanyProfileRefineProgress', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders every step, with the first step in progress at start', () => {
    render(<CompanyProfileRefineProgress steps={STEPS} delaysMs={DELAYS} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Refining your company profile with AI')).toBeInTheDocument();
    for (const label of ['Crawling website', 'Reading social profiles & digital assets', 'Saving updated profile']) {
      expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
    }
    // Current step is not struck through; later steps are pending (grey), not done.
    expect(screen.getByText('Crawling website', { exact: false }).className).toContain('text-gray-800');
    expect(screen.getByText('Saving updated profile', { exact: false }).className).toContain('text-gray-300');
  });

  it('advances to the next step as time passes and marks earlier steps done', () => {
    render(<CompanyProfileRefineProgress steps={STEPS} delaysMs={DELAYS} />);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Crawling website', { exact: false }).className).toContain('line-through');
    expect(
      screen.getByText('Reading social profiles & digital assets', { exact: false }).className,
    ).toContain('text-gray-800');
  });

  it('holds on the final step (never shows done) while the request is still running', () => {
    render(<CompanyProfileRefineProgress steps={STEPS} delaysMs={DELAYS} />);
    act(() => {
      jest.advanceTimersByTime(300_000);
    });
    expect(screen.getByText('Saving updated profile', { exact: false }).className).toContain('text-gray-800');
    expect(screen.queryByText(/— done/)).not.toBeInTheDocument();
  });
});
