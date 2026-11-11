/**
 * @jest-environment jsdom
 *
 * MONEY (e9 2026-11-12): the billing page's "What activities cost" card shows
 * "Blog article" at 60 credits - its own credit_cost_config row - not the
 * website_audit fee (50) the registry fallback used to price it by.
 *
 * The card's fetch is answered by the REAL resolveActivityCreditRange over the
 * seeded catalog (fake I/O only), with the page's own action list and labels
 * read from pages/company/billing/index.tsx so a relabel or a dropped row is
 * caught too.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const ORG = '00000000-0000-4000-8000-0000000000b2';
let mockDb: ReturnType<typeof import('../support/fakeCreditCatalogDb').makeFakeCatalogDb>;
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: async (url: string) => {
    const u = new URL(url, 'http://local');
    const { resolveActivityCreditRange } = jest.requireActual('../../services/pricingService');
    const ranges = [];
    for (const a of String(u.searchParams.get('actions')).split(',')) {
      try { ranges.push(await resolveActivityCreditRange(a, u.searchParams.get('companyId'))); } catch { /* unknown */ }
    }
    return { ok: true, status: 200, json: async () => ({ ranges, unknown: [] }) };
  },
}));

import { makeFakeCatalogDb, SEEDED_CREDIT_COST_CONFIG } from '../support/fakeCreditCatalogDb';
import ActivityCostRange from '../../../components/billing/ActivityCostRange';

const page = fs.readFileSync(path.join(__dirname, '../../../pages/company/billing/index.tsx'), 'utf8');

beforeEach(() => {
  mockDb = makeFakeCatalogDb({
    credit_cost_config: SEEDED_CREDIT_COST_CONFIG,
    action_pricing_config: [],
    organization_credits: [{ organization_id: ORG, credit_rate_usd: 0.01 }],
  });
});

it('the billing page lists blog_generation under the label "Blog article"', () => {
  expect(page).toMatch(/COST_REFERENCE_ACTIONS = \[[^\]]*'blog_generation'/);
  expect(page).toMatch(/blog_generation: 'Blog article'/);
  expect(page).toMatch(/<ActivityCostRange[\s\S]*?actions=\{COST_REFERENCE_ACTIONS\}[\s\S]*?labels=\{COST_REFERENCE_LABELS\}[\s\S]*?variant="list"/);
});

it('"Blog article" renders 60 cr (its own row), never the website_audit 50', async () => {
  render(<ActivityCostRange companyId={ORG} actions={['blog_generation']} labels={{ blog_generation: 'Blog article' }} variant="list" />);
  const label = await screen.findByText('Blog article');
  const row = label.parentElement as HTMLElement;
  await waitFor(() => expect(row).toHaveTextContent('60 cr'));
  expect(row).not.toHaveTextContent('50 cr');
});
