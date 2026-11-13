/**
 * Real-schema cover for 20270217000050_companies_domain_unique_partial (e1, 2026-11-13).
 * After the replay: both partial unique indexes exist, are valid and ready; a duplicate non-deleted domain (any case /
 * surrounding space) is refused by the canonical CHECK (23514); a duplicate canonical domain gets 23505 NAMING the index - which
 * the app classifies as a domain conflict; a DELETED company and
 * an empty string are excluded, an INACTIVE company is included (as decided); the migration re-runs as a no-op.
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback } from './setup';
import { classifyCompanyDomainConflict } from '../../services/companyDomainUniqueness';

const MIG = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20270217000050_companies_domain_unique_partial.sql'), 'utf8');
const A = '00000000-0000-4000-8000-0000000050a1';
const B = '00000000-0000-4000-8000-0000000050b2';
const ins = (id: string, cols: Record<string, unknown>) => {
  const keys = ['id', 'name', ...Object.keys(cols)];
  const vals = [id, `C050 ${id.slice(-2)}`, ...Object.values(cols)];
  return db.query(`INSERT INTO public.companies (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
};
const errOf = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return e as { code?: string; message?: string; detail?: string }; }
};

describe('20270217000050 companies_domain_unique_partial', () => {
  it('both indexes exist and are unique, valid and ready', async () => {
    const { rows } = await db.query(
      `SELECT c.relname, i.indisunique, i.indisvalid, i.indisready FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname IN ('idx_companies_website_domain_unique', 'idx_companies_admin_email_domain_unique') ORDER BY 1`);
    expect(rows).toEqual([
      { relname: 'idx_companies_admin_email_domain_unique', indisunique: true, indisvalid: true, indisready: true },
      { relname: 'idx_companies_website_domain_unique', indisunique: true, indisvalid: true, indisready: true },
    ]);
  });

  it.each([['website_domain', 'website_domain'], ['admin_email_domain', 'admin_email_domain']])(
    'a duplicate %s -> 23505 naming the index, classified by the app', async (col, expected) => {
      await inRollback(async () => {
        await ins(A, { [col]: 'acme-050.example' });
        const e = await errOf(ins(B, { [col]: 'acme-050.example' }));
        expect(e?.code).toBe('23505');
        expect(classifyCompanyDomainConflict({ code: e?.code, message: e?.message, details: e?.detail })).toBe(expected);
      });
    });

  it.each([['website_domain'], ['admin_email_domain']])(
    'a NON-CANONICAL %s (case / spaces) is refused by the CHECK (23514) - the index and exact .eq lookups agree', async (col) => {
      await inRollback(async () => {
        expect((await errOf(ins(A, { [col]: '  ACME-050.example ' })))?.code).toBe('23514');
        expect((await errOf(ins(B, { [col]: 'Acme-050.example' })))?.code).toBe('23514');
      });
    });

  it('a DELETED holder and empty strings do not conflict; an INACTIVE holder still does', async () => {
    await inRollback(async () => {
      await ins(A, { website_domain: 'gone-050.example', deleted_at: new Date().toISOString() });
      expect(await errOf(ins(B, { website_domain: 'gone-050.example' }))).toBeNull();
    });
    await inRollback(async () => {
      await ins(A, { website_domain: '' });
      expect(await errOf(ins(B, { website_domain: '' }))).toBeNull();
    });
    await inRollback(async () => {
      await ins(A, { website_domain: 'paused-050.example', status: 'inactive' });
      expect((await errOf(ins(B, { website_domain: 'paused-050.example' })))?.code).toBe('23505');
    });
  });

  it('re-running 050 is a no-op', async () => {
    await inRollback(async () => { await db.query(MIG); });
  });
});
