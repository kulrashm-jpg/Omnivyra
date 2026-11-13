/**
 * @jest-environment jsdom
 *
 * UI D8c (owner brief item 6; e9): BOLT Text strategy-card generation shows clear steps,
 * an HONEST stalled state (no spinning forever), and a plain failure with a retry that is
 * only offered once the request has ended. Also fixes a silent failure: a first-run error
 * used to be invisible because the cards section required hasGenerated || generating.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import StepTracker, { DEFAULT_STALLED_MESSAGE } from '../../../components/progress/StepTracker';

const STAGES = [
  { key: 'a', label: 'Step A', etaSeconds: 2 },
  { key: 'b', label: 'Step B', etaSeconds: 3 },
];

describe('StepTracker: stalled + failed-retry (additive props)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('says it is stalled once the running time passes the threshold, not before', () => {
    const t0 = Date.now();
    render(<StepTracker stages={STAGES} startedAt={t0} status="running" stalledAfterSeconds={10} />);
    expect(screen.queryByTestId('step-tracker-stalled')).toBeNull();
    act(() => { jest.setSystemTime(t0 + 11_000); jest.advanceTimersByTime(1_000); });
    expect(screen.getByTestId('step-tracker-stalled')).toHaveTextContent(DEFAULT_STALLED_MESSAGE);
  });

  it('without stalledAfterSeconds nothing changes (existing callers)', () => {
    const t0 = Date.now();
    render(<StepTracker stages={STAGES} startedAt={t0} status="running" />);
    act(() => { jest.setSystemTime(t0 + 600_000); jest.advanceTimersByTime(1_000); });
    expect(screen.queryByTestId('step-tracker-stalled')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('retry is offered only when FAILED (never while running)', () => {
    const onRetry = jest.fn();
    const { rerender } = render(<StepTracker stages={STAGES} startedAt={Date.now()} status="running" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    rerender(<StepTracker stages={STAGES} startedAt={Date.now()} status="failed" errorMessage="It broke." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('no percentage text is shown (only the bar)', () => {
    const { container } = render(<StepTracker stages={STAGES} startedAt={Date.now()} status="running" />);
    expect(container.textContent).not.toMatch(/\d+\s*%/);
  });
});

describe('BOLT Text wiring (D8c)', () => {
  const V = fs.readFileSync(path.join(process.cwd(), 'components/BoltStrategyViewMain.tsx'), 'utf8');
  it('stages mirror the strategy-cards route', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'pages/api/bolt/strategy-cards.ts'), 'utf8');
    expect(route).toContain('generateRichThemesForCampaignWeeks');
    expect(route).toContain('generateThemeFromTopic');
    expect(V).toContain("label: 'Drafting weekly themes for three options'");
    expect(V).toContain("label: \"Shaping each option's angle and title\"");
  });
  it('shows the tracker while generating, with the stalled threshold', () => {
    expect(V).toMatch(/\{generating && genStartedAt != null && \(\s*<StepTracker[\s\S]{0,400}stalledAfterSeconds=\{BOLT_TEXT_CARD_STALLED_AFTER_SECONDS\}/);
  });
  it('a first-run failure is visible (the section opens on genError)', () => {
    expect(V).toContain('{(hasGenerated || generating || Boolean(genError)) && (');
    expect(V).toContain("We couldn't generate strategy options");
  });
  it('the failure offers Try again only when not generating', () => {
    expect(V).toMatch(/\{!generating && \(\s*<button[\s\S]{0,200}void handleGenerate\(\);[\s\S]{0,300}Try again/);
  });
});
