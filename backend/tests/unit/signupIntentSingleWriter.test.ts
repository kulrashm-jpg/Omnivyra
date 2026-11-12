/**
 * P1 invariant (05 review, 2026-11-13): every signup intent is MINTED through backend/services/signupIntentMint.ts,
 * the one builder that writes intent_data.verdict (typed to exactly the bootstrap gate's accepted set). While that
 * holds, no verdict-less intent can be minted after deploy, so SIGNUP_INTENT_VERDICT_CUTOFF erring late is safe.
 * Write-shape scan over production code: every `.from('signup_intents')` / `ownedDbTable('signup_intents')` call is
 * classified by its first chained verb. A writer the scanner cannot classify FAILS (never skipped).
 *   - insert / upsert          : only signupIntentMint.ts
 *   - update                    : signupIntentMint.ts, or verify-email.ts (status pending -> completed; must not
 *                                 write intent_data)
 *   - delete                    : nowhere
 *   - select                    : anywhere
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const MINT = 'backend/services/signupIntentMint.ts';

type Site = { file: string; line: number; verb: string; tail: string };

function scan(): Site[] {
  const out: Site[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'tests' || ent.name.startsWith('.')) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
        const s = fs.readFileSync(p, 'utf8');
        const re = /(?:\.from|ownedDbTable)\(\s*['"]signup_intents['"]\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s))) {
          const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 400);
          const v = /^\s*\.(select|insert|upsert|update|delete)\(/.exec(tail);
          out.push({
            file: path.relative(ROOT, p).split(path.sep).join('/'),
            line: s.slice(0, m.index).split('\n').length,
            verb: v ? v[1] : 'UNPARSEABLE',
            tail,
          });
        }
      }
    }
  };
  for (const base of ['pages', 'backend', 'lib']) walk(path.join(ROOT, base));
  return out;
}

const sites = scan();

it('positive control: the scan sees the mint module and its writes', () => {
  expect(sites.filter((s) => s.file === MINT && (s.verb === 'insert' || s.verb === 'update')).length).toBeGreaterThanOrEqual(2);
});

it('every signup_intents call has a classifiable verb (an unparseable writer FAILS)', () => {
  expect(sites.filter((s) => s.verb === 'UNPARSEABLE').map((s) => `${s.file}:${s.line}`)).toEqual([]);
});

it('signup intents are INSERTED / UPSERTED only by signupIntentMint.ts', () => {
  expect(sites.filter((s) => (s.verb === 'insert' || s.verb === 'upsert') && s.file !== MINT).map((s) => `${s.file}:${s.line}`)).toEqual([]);
});

it('outside the mint module, the only update is verify-email marking the intent completed - never intent_data', () => {
  const others = sites.filter((s) => s.verb === 'update' && s.file !== MINT);
  expect(others.map((s) => s.file)).toEqual(['pages/api/auth/verify-email.ts']);
  for (const s of others) {
    const payload = s.tail.slice(0, s.tail.indexOf(')'));
    expect(payload).not.toMatch(/intent_data/);
    expect(payload).toMatch(/status:\s*'completed'/);
  }
});

it('signup intents are never deleted', () => {
  expect(sites.filter((s) => s.verb === 'delete').map((s) => `${s.file}:${s.line}`)).toEqual([]);
});
