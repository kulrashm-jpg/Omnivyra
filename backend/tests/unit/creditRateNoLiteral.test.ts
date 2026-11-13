/**
 * e1 2026-11-13 (owner pricing ruling): the wallet's credit_rate_usd comes ONLY from the column DEFAULT
 * (20270217000047 -> 0.007). No code path may write a rate literal when creating a wallet - that is how every onboarded
 * wallet ended up at 0.001 (C80).
 */
import * as fs from 'fs';
import * as path from 'path';

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'tests') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
}

it('no production file writes a credit_rate_usd literal', () => {
  const files: string[] = [];
  for (const d of ['backend', 'pages', 'lib']) walk(path.join(process.cwd(), d), files);
  expect(files.length).toBeGreaterThan(500); // positive control: the scan saw the tree
  const hits = files.flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/)
    .map((line, i) => ({ f: path.relative(process.cwd(), f), i: i + 1, line }))
    .filter(({ line }) => /credit_rate_usd\s*:\s*[0-9.]+/.test(line)));
  // Named exceptions (file + exact line), each NOT a wallet write:
  //   consumptionMetricsService.ts - the zero placeholder of an EMPTY consumption overview (no wallet row exists).
  const ALLOWED = new Set(['backend/services/creditAdvisor/consumptionMetricsService.ts|credit_rate_usd: 0,']);
  const unexpected = hits.filter(({ f, line }) => !ALLOWED.has(`${f.split(path.sep).join('/')}|${line.trim()}`));
  expect(unexpected).toEqual([]);
  // the allowlist stays live: the named exception still exists (else remove it)
  expect(hits.length - unexpected.length).toBe(ALLOWED.size);
});

it('the wallet upsert in initialFreeCreditService leaves the rate to the column default', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/initialFreeCreditService.ts'), 'utf8');
  const upsert = src.slice(src.indexOf("ownedDbTable('organization_credits').upsert("), src.indexOf("{ onConflict: 'organization_id'"));
  expect(upsert).toContain('lifetime_consumed');
  expect(upsert).not.toMatch(/credit_rate_usd\s*:/);
});
