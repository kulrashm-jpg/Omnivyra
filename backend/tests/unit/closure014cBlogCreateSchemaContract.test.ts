/**
 * Closure-014C (Finding F) — the columns POST /api/admin/blog writes vs. the
 * columns the schema sources define for public_blogs.
 *
 * Evidence (Closure-014B/C, local only): the create route inserts
 * `primary_keyword` and `secondary_keywords` on EVERY create (null when not
 * supplied), but neither column is defined by supabase/_schema/baseline.sql
 * (the schema-only production dump the migration chain starts from) nor by any
 * migration in supabase/migrations; the local certification database answers
 * 500 "Could not find the 'primary_keyword' column". No existing column is a
 * semantic equivalent, so the resolution is an OWNER decision (add the columns
 * by migration, or stop writing them) — not made here.
 *
 * This test pins that contract exactly: it fails if the route starts writing
 * ANY other undefined column, and it fails once a migration defines the two
 * columns (so the known gap cannot silently outlive its resolution).
 */
import fs from 'fs';
import path from 'path';

let mockInsert: Record<string, unknown> | null = null;
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: 'user-x' } })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mockInsert = row;
        return { select: () => ({ single: async () => ({ data: { id: 'b1', slug: 's', status: 'draft' }, error: null }) }) };
      },
    }),
  },
}));

import handler from '../../../pages/api/admin/blog/index';

const ROOT = path.resolve(__dirname, '../../..');
const KNOWN_GAP = ['primary_keyword', 'secondary_keywords'];

function schemaColumns(): Set<string> {
  const cols = new Set<string>();
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase/_schema/baseline.sql'), 'utf8');
  const m = /CREATE TABLE public\.public_blogs \(([\s\S]*?)\n\);/.exec(baseline);
  if (!m) throw new Error('public_blogs not found in baseline.sql');
  for (const line of m[1].split('\n')) {
    const c = /^\s+([a-z_][a-z0-9_]*)\s/.exec(line);
    if (c && c[1] !== 'constraint') cols.add(c[1]);
  }
  const dir = path.join(ROOT, 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?public_blogs\s+([\s\S]*?);/gi;
    for (let a = re.exec(sql); a; a = re.exec(sql)) {
      for (const add of a[1].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) cols.add(add[1].toLowerCase());
    }
  }
  return cols;
}

async function create(body: Record<string, unknown>) {
  mockInsert = null;
  const res: { statusCode: number; body: unknown; status: (n: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 0, body: null,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
  };
  await (handler as (req: unknown, r: unknown) => Promise<unknown>)({ method: 'POST', body, headers: {}, query: {} }, res);
  return res;
}

describe('POST /api/admin/blog — written columns vs. schema-defined columns', () => {
  it('every column the route writes is schema-defined EXCEPT exactly the known, owner-pending gap', async () => {
    const r = await create({ title: 'Contract probe' });
    expect(r.statusCode).toBe(201);
    const written = Object.keys(mockInsert ?? {});
    const cols = schemaColumns();
    expect(cols.size).toBeGreaterThan(10); // the parse found the table
    expect(written.filter((k) => !cols.has(k)).sort()).toEqual(KNOWN_GAP);
  });

  it('the gap columns are written even when the caller supplies no keywords (so EVERY create depends on them)', async () => {
    await create({ title: 'No keywords' });
    expect(mockInsert).toMatchObject({ primary_keyword: null, secondary_keywords: null });
  });

  it('when supplied, keywords are normalized (trimmed primary; at most 5 string secondaries)', async () => {
    await create({ title: 'With keywords', primary_keyword: '  seo  ', secondary_keywords: ['a', 2, 'b', 'c', 'd', 'e', 'f'] });
    expect(mockInsert).toMatchObject({ primary_keyword: 'seo', secondary_keywords: ['a', 'b', 'c', 'd', 'e'] });
  });
});
