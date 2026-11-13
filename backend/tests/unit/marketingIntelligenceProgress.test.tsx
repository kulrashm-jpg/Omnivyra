/**
 * @jest-environment jsdom
 *
 * UI step 6.6: "Generate marketing intelligence" shows real steps (StepTracker), traced to
 * /api/company-profile/generate-marketing-intelligence.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import MarketingIntelligenceProgress, { MARKETING_INTELLIGENCE_STAGES } from '../../../components/company/MarketingIntelligenceProgress';

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-13T10:00:00Z')); });
afterEach(() => jest.useRealTimers());

it('shows the three traced steps, first one current', () => {
  render(<MarketingIntelligenceProgress />);
  expect(screen.getByText('Generating marketing intelligence')).toBeInTheDocument();
  for (const s of MARKETING_INTELLIGENCE_STAGES) expect(screen.getByText(s.label, { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Reading your company profile', { exact: false }).className).toContain('text-gray-800');
});

it('advances to the AI drafting step, then holds on the last step until done', () => {
  render(<MarketingIntelligenceProgress />);
  act(() => { jest.advanceTimersByTime(5_000); });
  expect(screen.getByText('Drafting marketing intelligence with AI', { exact: false }).className).toContain('text-gray-800');
  act(() => { jest.advanceTimersByTime(600_000); });
  expect(screen.getByText('Preparing your draft for review', { exact: false }).className).toContain('text-gray-800');
  expect(screen.queryByText(/— done/)).not.toBeInTheDocument();
});

it('the company-profile form uses it instead of the timer bar', () => {
  const src = require('fs').readFileSync(require('path').join(process.cwd(), 'components/CompanyProfileFormSectionsC.tsx'), 'utf8') as string;
  expect(src).toMatch(/<MarketingIntelligenceProgress \/>/);
  expect(src).not.toMatch(/Generating marketing intelligence…/);
});
