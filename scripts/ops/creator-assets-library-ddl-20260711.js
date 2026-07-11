/**
 * OPS DDL — 2026-07-11, Strategic Mix P2 (owner-directed phase).
 *
 * Applies supabase/migrations/20260832_creator_assets_library.sql to the
 * production database via the pooler (migration ledger is desynced — NEVER
 * db:push; this script is the sanctioned application mechanism, the
 * migration file is the record).
 *
 * Adds the Asset Library columns to creator_assets (library envelope,
 * archive, soft delete, usage tracking) + the list index. Idempotent
 * (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
 *
 * Run: node scripts/ops/creator-assets-library-ddl-20260711.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

async function main() {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/20260832_creator_assets_library.sql'),
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
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='creator_assets'
        AND column_name IN ('library','archived_at','deleted_at','usage_count','last_used_at')
      ORDER BY column_name
    `);
    console.log('APPLIED. New columns present:', rows.map((r) => r.column_name).join(', '));
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
