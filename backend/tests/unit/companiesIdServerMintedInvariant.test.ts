/**
 * INVARIANT (05 / e9, P1 2026-11-13): `companies.id` must stay SERVER-MINTED.
 *
 * P1 makes the company INSERT the once-only consume of a signup intent (companies.id = signup_intents.id). A route
 * that inserted a companies row with a CALLER-CHOSEN id would become a signup-pre-emption primitive: insert first,
 * and the victim's bootstrap hits 23505 without holding the company - refused permanently. This suite walks the
 * company-insert surface by WRITE SHAPE (every `.from('companies').insert|upsert(` in production code) and pins the
 * exact set of sites that set an explicit `id`, each with the reason its id is not caller-chosen. A new site that
 * sets an id fails here and must be reviewed.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

function scan(): Array<{ file: string; op: string; hasId: boolean }> {
  const out: Array<{ file: string; op: string; hasId: boolean }> = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'tests' || ent.name.startsWith('.')) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
        const s = fs.readFileSync(p, 'utf8');
        const re = /from\(\s*['"]companies['"]\s*\)\s*\.(insert|upsert)\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s))) {
          const payload = s.slice(m.index + m[0].length, m.index + m[0].length + 300);
          out.push({ file: path.relative(ROOT, p).split(path.sep).join('/'), op: m[1], hasId: /(^|[\s{,(])(id\s*:|record\))/.test(payload) });
        }
      }
    }
  };
  for (const base of ['pages', 'backend', 'lib']) walk(path.join(ROOT, base));
  return out;
}

/** Every site allowed to set an explicit companies.id, and WHY the id is not caller-chosen. */
const REVIEWED_ID_SITES: Record<string, string> = {
  'pages/api/onboarding/setup-company.ts': 'the injected insert receives createCompanyIdentity({ id: bootstrap.intent.intentId }) - a server-minted signup intent id (P1)',
  'backend/services/companyIdentityWriter.ts': 'the canonical writer inserts the record its caller built; its only id-setting caller is setup-company (intent id)',
  'pages/api/onboarding/complete.ts': 'id: bootstrap.intent.intentId - a server-minted signup intent id (P1)',
  'pages/api/external-apis/access.ts': 'KNOWN EXCEPTION, separately fixed (5fc820a17 makes it a plain insert): the id is the route companyId, reachable only by a caller already authorized on that company id (role check / platform admin); a role row for a non-existent company cannot be self-created',
};

it('every companies insert/upsert that sets an explicit id is a reviewed, server-minted site', () => {
  const sites = scan();
  expect(sites.length).toBeGreaterThan(0); // positive control: the scan sees the surface
  const withId = Array.from(new Set(sites.filter((s) => s.hasId).map((s) => s.file))).sort();
  expect(withId).toEqual(Object.keys(REVIEWED_ID_SITES).sort());
});

it('the P1 sites take their id from the bound signup intent', () => {
  const setup = fs.readFileSync(path.join(ROOT, 'pages/api/onboarding/setup-company.ts'), 'utf8');
  expect(setup).toMatch(/const companyId = bootstrap\.intent\.intentId;/);
  expect(setup).not.toMatch(/randomUUID\(\)/);
  const complete = fs.readFileSync(path.join(ROOT, 'pages/api/onboarding/complete.ts'), 'utf8');
  expect(complete).toMatch(/id:\s+bootstrap\.intent\.intentId/);
});
