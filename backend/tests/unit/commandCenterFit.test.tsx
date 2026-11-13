/**
 * @jest-environment jsdom
 *
 * UI D1 (owner rules 1 + 3): Command Center fits one laptop screen and has ONE control
 * per work-area card. F1: the Reports CTA is disabled and says "Generating..." while a
 * report is generating (the hook's ctaDisabled / showSpinner / ctaLabel are honoured).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('../../../components/command-center/CommandCenterPreflightModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/command-center/CategoryFactorsPanel', () => ({ __esModule: true, default: () => null }));
// No pending preflight guidance, so the CTA navigates directly (preflight has its own tests).
jest.mock('../../../components/command-center/preflightHelpers', () => ({
  ...jest.requireActual('../../../components/command-center/preflightHelpers'),
  toPreflightItems: () => ({ required: [], recommended: [] }),
}));

import CommandCenterView from '../../../components/CommandCenterView';

const summary = { completedCount: 1, inProgressCount: 0, totalCount: 2 };
const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `T-${id}`, description: 'd', hint: 'h', ctaLabel: 'Open', route: `/${id}`, state: 'ready', ...extra,
});
function renderView(cards: unknown[], handleCardClick = jest.fn()) {
  const d = {
    companyName: 'Acme', displayName: 'Kim', enhancedCards: cards, handleCardAnalytics: jest.fn(), handleCardClick,
    readinessScore: 50, setupPct: 80, setupEvaluation: {}, setupSummary: summary, readinessEvaluation: {},
    readinessSummary: summary, masteryPct: 10, masteryEvaluation: { overallPercent: 10 }, masterySummary: summary,
    selectedCompanyId: 'c1', features: [], profileStatus: null,
  };
  render(<CommandCenterView d={d as any} />);
  return handleCardClick;
}

describe('Command Center D1', () => {
  it('one control per card: the card body is not a button; the CTA opens the area once', () => {
    const click = renderView([card('reports'), card('blogs'), card('campaigns'), card('engagement')]);
    const reports = screen.getByTestId('command-center-card-reports');
    expect(reports).not.toHaveAttribute('role');
    expect(reports.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(reports);
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledWith('/reports?companyId=c1', 'ready');
  });
  it('cards size to their content (no forced min-height) and the repeated outcome box is gone', () => {
    renderView([card('reports')]);
    const reports = screen.getByTestId('command-center-card-reports');
    expect(reports.className).not.toMatch(/min-h-\[/);
    expect(screen.queryByText('What you can do here')).toBeNull();
  });
  it('F1: while a report is generating, the Reports CTA says so and is disabled', () => {
    const click = renderView([card('reports', { ctaLabel: 'Generating...', ctaDisabled: true, showSpinner: true, state: 'in_progress' })]);
    const btn = screen.getByRole('button', { name: /Generating\.\.\./ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(click).not.toHaveBeenCalled();
  });
  it('not generating: the short verb, enabled', () => {
    renderView([card('reports', { ctaLabel: 'Generate report', ctaDisabled: false })]);
    expect(screen.getByRole('button', { name: /^Generate/ })).toBeEnabled();
  });
});
