/**
 * @jest-environment jsdom
 *
 * When /api/track/analytics cannot read its data (500 ANALYTICS_UNAVAILABLE), the panel SAYS the
 * analytics are unavailable - it does not vanish, and it never shows zero views (e9, 2026-11-12).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import BlogAnalyticsPanel from '../../../components/blog/BlogAnalyticsPanel';

const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body });

function stubFetch(analytics: () => Promise<unknown>) {
  (global as any).fetch = jest.fn((url: string) => {
    if (url.startsWith('/api/track/analytics')) return analytics();
    if (url.startsWith('/api/track/clusters')) return json(200, { clusters: [], top_cluster: null, bottom_cluster: null });
    if (url.startsWith('/api/track/hot')) return json(200, { hot: [] });
    return json(200, {});
  });
}

afterEach(() => { delete (global as any).fetch; });

it('analytics 500 -> an "unavailable" alert, no numbers', async () => {
  stubFetch(() => json(500, { code: 'ANALYTICS_UNAVAILABLE', error: 'Blog analytics are temporarily unavailable.' }));
  render(<BlogAnalyticsPanel accountId="co-a" />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/temporarily unavailable/i);
  expect(alert).toHaveTextContent(/not zero/i);
  expect(screen.queryByText('Views (30d)')).not.toBeInTheDocument();
});

it('network failure -> the same "unavailable" alert', async () => {
  stubFetch(() => Promise.reject(new Error('offline')));
  render(<BlogAnalyticsPanel accountId="co-a" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
});

it('NEGATIVE CONTROL: analytics readable (cold start) -> no unavailable alert', async () => {
  stubFetch(() => json(200, {
    total_views: 0, avg_time: 0, avg_scroll: 0, top_pages: [], insights: [], period_days: 30, cold_start: true,
    delta: { views_delta: null, time_delta: null, scroll_delta: null },
  }));
  render(<BlogAnalyticsPanel accountId="co-a" />);
  expect(await screen.findByText(/Waiting for your first visitors/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
