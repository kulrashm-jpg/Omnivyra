/**
 * D2b: the queue-based engagement polling job gives each org job ONE refresh budget
 * (the same RefreshBudget as the ingest timer), passed to every ingestComments call of
 * that org; different orgs get different budgets.
 *
 * Inputs: posts p1, p2 of org A and p3 of org B.
 */
const calls: Array<{ postId: string; opts: any }> = [];
jest.mock('../../db/supabaseClient', () => {
  const rows = [
    { id: 'p1', social_accounts: { company_id: 'org-A' } },
    { id: 'p2', social_accounts: { company_id: 'org-A' } },
    { id: 'p3', social_accounts: { company_id: 'org-B' } },
  ];
  const q: any = {};
  for (const m of ['select', 'eq', 'not', 'gte', 'order']) q[m] = () => q;
  q.limit = async () => ({ data: rows, error: null });
  return { supabase: { from: () => q } };
});
jest.mock('../../services/engagementIngestionService', () => ({
  ingestComments: async (postId: string, opts: any) => { calls.push({ postId, opts }); return { success: true, ingested: 0 }; },
  createRefreshBudget: () => ({ remainingMs: 120_000, reserveMs: 15_000, deferred: 0, backedOff: 0 }),
}));
jest.mock('../../services/jobRunner', () => ({
  runJob: async (_meta: unknown, fn: () => Promise<unknown>) => ({ status: 'completed', result: await fn() }),
}));

import { processEngagementPollingJob } from '../../queue/jobProcessors/engagementPollingProcessor';

it('each org job gets one refresh budget shared by its posts; another org gets its own', async () => {
  await processEngagementPollingJob();
  const by = Object.fromEntries(calls.map((c) => [c.postId, c.opts?.refreshBudget]));
  expect(by.p1).toBeDefined();
  expect(by.p1).toBe(by.p2);          // same job, same budget
  expect(by.p3).toBeDefined();
  expect(by.p3).not.toBe(by.p1);      // another org, its own budget
});
