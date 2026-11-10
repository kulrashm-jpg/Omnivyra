/**
 * PI review of e728a96a5: the read service computes a canonical prospect's
 * dedupe key from the canonical_leads row AS STORED (it does not strip
 * unified_source), and that key equals the producer's ONLY because WS-1 - the
 * writer of PI prospects - never writes unified_source. piLdbKeyEquality's
 * control shows what breaks otherwise: the keys diverge silently and the
 * presence read answers about a different lead.
 *
 * This turns that assumption into a failing test the moment a WS-1 writer
 * starts writing the column.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
// WS-1: the prospect resolver and everything in its module directory.
const WS1_DIRS = ['services/prospectIdentity'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Comments removed: a mention in prose is not a write. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

it('no WS-1 file writes unified_source (the read-service key equality rests on it)', () => {
  const files = WS1_DIRS.flatMap((d) => walk(join(ROOT, d)));
  expect(files.some((f) => f.endsWith('prospectResolution.ts'))).toBe(true);   // the scan sees the writer
  const offenders = files.filter((f) => /unified_source/.test(code(readFileSync(f, 'utf8'))));
  expect(offenders).toEqual([]);
});

it('NEGATIVE CONTROL: the scan would catch a write (a legacy CRM writer does write it)', () => {
  const crm = code(readFileSync(join(ROOT, 'services/crmIngestionService.ts'), 'utf8'));
  expect(/unified_source/.test(crm)).toBe(true);
});
