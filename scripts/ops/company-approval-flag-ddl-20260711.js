/**
 * OPS DDL — 2026-07-11, Strategic Mix R2-P1 (owner-directed phase).
 *
 * Applies supabase/migrations/20260833_company_assignment_approval.sql to
 * the production database via the pooler (migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism, the
 * migration file is the record).
 *
 * Adds companies.require_assignment_approval (boolean NOT NULL DEFAULT
 * false) — additive, idempotent, zero behavior change until a company
 * opts in.
 *
 * Run: node scripts/ops/company-approval-flag-ddl-20260711.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

async function main() {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/20260833_company_assignment_approval.sql'),
    'utf8',
  );
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='companies'
        AND column_name = 'require_assignment_approval'
    `);
    console.log('APPLIED:', JSON.stringify(rows));
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
