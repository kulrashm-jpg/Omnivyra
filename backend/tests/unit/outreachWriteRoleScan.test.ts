/**
 * Structural pin for the outreach write-role sweep (e9 GO, 2026-11-13): 55's reusable scan over every outreach API
 * directory finds NO membership-only write route, apart from the three reviewed in
 * scripts/security/write-role-gate-allow/outreach.txt. Area role-gate helpers added via --role-gate were each READ:
 * enforceRole (EXECUTE_ACTIONS etc.), requireCapability (PROSPECT_INGEST: admin-only), getUserRole (the active-leads
 * inline MANAGE_LISTENING_CAPABILITIES admin gate), requireExtensionAuth (now re-checks EXECUTE_ACTIONS per request).
 */
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../../..');
const DIRS = ['lead-intelligence', 'engagement', 'leads', 'outreach', 'extension', 'active-leads', 'whatsapp', 'lead-ingestion', 'outreach-plans'];
const scan = (withAllow: boolean) => {
  const args = ['scripts/security/scan-write-role-gates.js', ...DIRS.flatMap((d) => ['--dir', `pages/api/${d}`]),
    '--object', '.', '--role-gate', 'enforceRole|requireCapability|getUserRole|requireExtensionAuth', '--json'];
  if (withAllow) args.push('--allow', 'scripts/security/write-role-gate-allow/outreach.txt', '--fail');
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: JSON.parse(r.stdout) as { counts: Record<string, number>; hits: string[]; allowedHits?: string[] } };
};

it('every outreach write route is role-gated, apart from the three reviewed ones', () => {
  const { status, out } = scan(true);
  expect(status).toBe(0);
  expect(out.hits).toEqual([]);
  expect(out.counts.scanned).toBeGreaterThanOrEqual(150); // non-vacuous: the nine directories were really scanned
});

it('CONTROL: without the allow-list exactly the three reviewed routes are reported (the scan can fail)', () => {
  const { out } = scan(false);
  expect([...out.hits].sort()).toEqual([
    'pages/api/active-leads/credit-estimate.ts', 'pages/api/active-leads/semantic-retrieval.ts', 'pages/api/engagement/sync.ts',
  ]);
});
