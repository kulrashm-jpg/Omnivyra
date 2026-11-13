/**
 * @jest-environment jsdom
 *
 * e9 ruling 2026-11-13: hide the campaign AI provider picker (the server picks the
 * model) and remove "Demo AI" (canned replies presented as AI) from the customer UI.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CampaignAIInfoPanels } from '../../../components/campaign-ai/CampaignAIInfoPanels';
import { CAMPAIGN_AI_PROVIDER_KEY, getStoredProvider } from '../../../components/campaign-ai/types';

jest.mock('@/components/shared/EmptyState', () => () => null);
jest.mock('@/components/shared/ExamplePreview', () => () => null);

describe('getStoredProvider', () => {
  afterEach(() => window.localStorage.clear());

  it('maps a previously stored "demo" to the real assistant', () => {
    window.localStorage.setItem(CAMPAIGN_AI_PROVIDER_KEY, 'demo');
    expect(getStoredProvider()).toBe('claude');
  });

  it('keeps gpt / claude, defaults to claude', () => {
    window.localStorage.setItem(CAMPAIGN_AI_PROVIDER_KEY, 'gpt');
    expect(getStoredProvider()).toBe('gpt');
    window.localStorage.setItem(CAMPAIGN_AI_PROVIDER_KEY, 'claude');
    expect(getStoredProvider()).toBe('claude');
    window.localStorage.removeItem(CAMPAIGN_AI_PROVIDER_KEY);
    expect(getStoredProvider()).toBe('claude');
  });
});

describe('CampaignAIInfoPanels', () => {
  it('never renders the AI provider picker, even when asked to show settings', () => {
    render(
      <CampaignAIInfoPanels
        showLearning={false}
        showSettings
        campaignLearnings={[]}
        selectedProvider="demo"
        onProviderChange={() => {}}
      />,
    );
    expect(screen.queryByText('AI Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo AI')).not.toBeInTheDocument();
    expect(screen.queryByText(/simulated responses/i)).not.toBeInTheDocument();
  });

  it('still renders campaign learnings', () => {
    render(
      <CampaignAIInfoPanels
        showLearning
        campaignLearnings={[{ campaignName: 'Spring', learnings: ['Short hooks win'] } as any]}
      />,
    );
    expect(screen.getByText(/Campaign Learnings \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Short hooks win/)).toBeInTheDocument();
  });
});

describe('CampaignAIChatShell has no settings button', () => {
  it('does not render a toggle for the retired settings panel', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'components/campaign-ai/CampaignAIChatShell.tsx'),
      'utf8',
    ) as string;
    expect(src).not.toMatch(/setShowSettings\(/);
    expect(src).not.toMatch(/<Settings\b/);
  });
});
