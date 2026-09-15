/**
 * K3 — the email_jobs queue drain frequency.
 *
 * /api/cron/email-jobs is the ONLY drain of email_jobs (Super Admin invites,
 * invitation resends, ...). It used to run once a day ("0 1 * * *"), so a
 * queued invite could wait up to ~24h (one real invite took 9.7h). It now
 * runs every 10 minutes.
 *
 * Running it that often is only safe because the route is bounded and
 * idempotent under repetition; the source-level assertions below pin those
 * properties so a future edit cannot quietly make the frequent schedule unsafe.
 */

import fs from 'fs';
import path from 'path';

type Cron = { path?: string; schedule?: string };

const repoFile = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const crons = (): Cron[] => {
  const cfg = JSON.parse(repoFile('vercel.json')) as { crons?: Cron[] };
  return cfg.crons ?? [];
};

describe('vercel.json — email_jobs drain schedule', () => {
  test('the email-jobs cron is declared exactly once', () => {
    expect(crons().filter((c) => c.path === '/api/cron/email-jobs')).toHaveLength(1);
  });

  test('the email-jobs cron runs every 10 minutes', () => {
    const cron = crons().find((c) => c.path === '/api/cron/email-jobs');
    expect(cron?.schedule).toBe('*/10 * * * *');
  });
});

describe('/api/cron/email-jobs — safe to run frequently', () => {
  const src = repoFile('pages/api/cron/email-jobs.ts');

  test('fails closed without CRON_SECRET and requires the bearer', () => {
    expect(src).toMatch(/const cronSecret = process\.env\.CRON_SECRET;/);
    expect(src).toMatch(/if \(!cronSecret\)[\s\S]{0,200}status\(401\)/);
    // SEC-C4 (3AH-91): the bearer is now compared in constant time — same
    // exact `Bearer <CRON_SECRET>` contract, no prefix-timing oracle.
    expect(src).toContain("!bearerTokenMatches(req.headers['authorization'], cronSecret)");
  });

  test('claims a bounded batch atomically via the claim_email_jobs RPC', () => {
    expect(src).toMatch(/const BATCH_SIZE = 20;/);
    expect(src).toMatch(/rpc\('claim_email_jobs',\s*\{\s*p_worker_id: id,\s*p_limit: BATCH_SIZE,/);
  });

  test('finalizes through finalize_email_job with backoff and dead-lettering', () => {
    expect(src).toContain("rpc('finalize_email_job'");
    expect(src).toContain('computeNextAttemptAt(job.retry_count)');
    expect(src).toMatch(/job\.retry_count \+ 1 < job\.max_retries/);
    expect(src).toContain("finalize(job.id, 'dead'");
  });
});
