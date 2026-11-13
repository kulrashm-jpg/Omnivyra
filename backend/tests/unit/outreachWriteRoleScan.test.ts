/**
 * Structural pin for the outreach write-role sweep (e9 GO, 2026-11-13): 55's reusable scan over every outreach API
 * directory finds NO membership-only write route, apart from the three reviewed in
 * scripts/security/write-role-gate-allow/outreach.txt. --role-gate lists only REFUSERS (05: a token there must be
 * able to refuse - throw, write the response, or return a sentinel the caller must honour), each READ: enforceRole
 * (EXECUTE_ACTIONS etc.), requireCapability (PROSPECT_INGEST: admin-only), requireExtensionAuth (re-checks
 * EXECUTE_ACTIONS per request). getUserRole is a READER (and returns {role:null,error:null} on a failed read), so the
 * active-leads inline admin gate is NOT a --role-gate token: those files are allow-listed as MLC-INLINE and each must
 * still contain the whole refusing pattern (asserted below) - removing the gate from one fails this suite.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../../..');
const DIRS = ['lead-intelligence', 'engagement', 'leads', 'outreach', 'extension', 'active-leads', 'whatsapp', 'lead-ingestion', 'outreach-plans'];
const scan = (withAllow: boolean) => {
  const args = ['scripts/security/scan-write-role-gates.js', ...DIRS.flatMap((d) => ['--dir', `pages/api/${d}`]),
    '--object', '.', '--role-gate', 'enforceRole|requireCapability|requireExtensionAuth', '--json'];
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

const ALLOW = fs.readFileSync(path.join(root, 'scripts/security/write-role-gate-allow/outreach.txt'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const pathOf = (l: string) => l.replace(/#.*$/, '').trim();
const MLC_INLINE = ALLOW.filter((l) => /# MLC-INLINE/.test(l)).map(pathOf);

it('CONTROL: without the allow-list exactly the allow-listed routes are reported (the scan can fail)', () => {
  const { out } = scan(false);
  expect([...out.hits].sort()).toEqual(ALLOW.map(pathOf).sort());
  expect(out.hits).toEqual(expect.arrayContaining([
    'pages/api/active-leads/credit-estimate.ts', 'pages/api/active-leads/semantic-retrieval.ts', 'pages/api/engagement/sync.ts',
  ]));
});

it('every MLC-INLINE allow-listed file still contains the whole refusing admin gate', () => {
  expect(MLC_INLINE.length).toBe(51);
  const GATE = /getUserRole\([^)]*\)[\s\S]{0,300}?status\(403\)[\s\S]{0,200}?hasCommunityAiCapability\(\s*role\s*,\s*'MANAGE_LISTENING_CAPABILITIES'\s*\)[\s\S]{0,120}?status\(403\)/;
  const missing = MLC_INLINE.filter((rel) => !GATE.test(fs.readFileSync(path.join(root, rel), 'utf8')));
  expect(missing).toEqual([]);
  // POSITIVE CONTROL: a file that reads the role but never refuses does not match
  expect(GATE.test('const { role } = await getUserRole(ctx.userId, companyId);\n  return res.status(200).json({ role });')).toBe(false);
});
