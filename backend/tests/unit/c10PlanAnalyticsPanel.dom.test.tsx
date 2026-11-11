/**
 * @jest-environment jsdom
 *
 * C10 (2026-11-11): the plan analytics panel used to draw "feature adoption"
 * bars from Math.random() values. The API now returns feature_adoption: null
 * (no canonical source); the panel must say "not available" and render NO
 * percentage for it - never a bar, never a number.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const payload = {
  usage_status: 'ok',
  plans: [{
    plan_id: 'p1', plan_key: 'pro', plan_name: 'Pro', org_count: 1, avg_llm_tokens_used: 10, avg_api_calls_used: 2,
    avg_automation_executions: 1, total_cost_usd: 0, avg_cost_per_org: 0, monthly_price: 10, monthly_credits: null,
    feature_adoption: null, usage_health: 'low',
  }],
  summary: { total_organizations: 1, total_monthly_revenue: 10, average_monthly_spend_per_org: 10, plan_distribution: { pro: 1 } },
};

jest.mock('@/lib/utils/safeFetchJson', () => ({
  safeFetchJson: jest.fn(async () => ({ ok: true, data: payload })),
}), { virtual: true });

import PlanAnalyticsPanel from '../../../components/super-admin/PlanAnalyticsPanel';

it('feature adoption null renders "not available", with no adoption labels or percentages', async () => {
  render(<PlanAnalyticsPanel />);
  await waitFor(() => expect(screen.getByTestId('feature-adoption-unavailable')).toBeInTheDocument());
  expect(screen.getByTestId('feature-adoption-unavailable')).toHaveTextContent(/not available/i);
  for (const label of ['Campaigns Created', 'Ai Content Generated', 'Engagement Ai', 'Automation Enabled']) {
    expect(screen.queryByText(label)).toBeNull();
  }
});
