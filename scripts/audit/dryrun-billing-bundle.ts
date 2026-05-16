/**
 * Transactional dry-run of the billing activation bundle.
 *
 * Wraps the entire bundle (+ an optional schema-alignment prelude) in a
 * single transaction and ROLLS BACK. Nothing is ever committed. It either
 * proves the bundle applies cleanly end-to-end, or stops at the exact
 * statement/column that fails — so we can fix every pre-existing-table
 * mismatch BEFORE the operator applies anything for real.
 *
 * Read-only in effect (BEGIN … always ROLLBACK).
 *
 *   npx tsx scripts/audit/dryrun-billing-bundle.ts
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { buildBillingSchemaReport } from '../../backend/services/billing/bootstrap/billingSchemaSpec';

const ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE = path.join(ROOT, 'docs', 'audit', 'billing-activation-bundle.sql');
const PRELUDE = path.join(ROOT, 'docs', 'audit', 'billing-schema-alignment-prelude.sql');

async function main(): Promise<number> {
  await buildBillingSchemaReport().catch(() => {});
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) { console.error('NO SUPABASE_DB_URL'); return 2; }

  let sql = fs.readFileSync(BUNDLE, 'utf8');
  // Drop the NOTIFY (cache reload is a post-commit op, not part of the dry-run).
  sql = sql.replace(/^NOTIFY\s+pgrst.*$/im, '-- (NOTIFY stripped for dry-run)');

  let prelude = '';
  if (fs.existsSync(PRELUDE)) {
    prelude = fs.readFileSync(PRELUDE, 'utf8');
    console.log(`Prelude: ${PRELUDE} (${prelude.length} bytes)`);
  } else {
    console.log('Prelude: none');
  }

  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    try {
      if (prelude.trim()) await c.query(prelude);
      (globalThis as { __sql?: string }).__sql = sql;
      await c.query(sql);
      await c.query('ROLLBACK');
      console.log('\n✅ DRY-RUN CLEAN — the bundle (with prelude) applies end-to-end with NO errors.');
      console.log('   (transaction rolled back; nothing was committed)');
      return 0;
    } catch (err: unknown) {
      await c.query('ROLLBACK').catch(() => {});
      const e = err as { message?: string; position?: string; where?: string; code?: string; hint?: string };
      console.log('\n❌ DRY-RUN FAILED — fix this, add to the prelude, re-run:');
      console.log(`   code:    ${e.code ?? '?'}`);
      console.log(`   message: ${e.message ?? err}`);
      if (e.hint)  console.log(`   hint:    ${e.hint}`);
      if (e.where) console.log(`   where:   ${e.where}`);
      const pos = e.position ? parseInt(e.position, 10) : NaN;
      const full = (globalThis as { __sql?: string }).__sql ?? '';
      if (!Number.isNaN(pos) && full) {
        const start = Math.max(0, pos - 320);
        const snippet = full.slice(start, pos + 200);
        const line = full.slice(0, pos).split('\n').length;
        console.log(`   position: ${pos}  (≈ bundle line ${line})`);
        console.log('   --- SQL context (caret = failure point) ---');
        console.log(full.slice(start, pos) + ' «HERE» ' + full.slice(pos, pos + 200));
        void snippet;
      }
      return 1;
    }
  } finally {
    await c.end().catch(() => {});
  }
}
main().then(c => process.exit(c)).catch(e => { console.error('FATAL', e?.message || e); process.exit(1); });
