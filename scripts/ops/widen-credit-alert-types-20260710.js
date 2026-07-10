/**
 * OPS DDL — 2026-07-10, approved by Kuldeep in-session (low-credit warning
 * ladder change: warnings at <100 / <50 / <20 credits, none at 200).
 *
 * Applies supabase/migrations/20260830_credit_alert_type_widen.sql to the
 * production database via the pooler (the migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism, the
 * migration file is the record).
 *
 * Also fixes a latent defect: 'consumed_80/90/95' and
 * 'forecast_insufficient_85' inserts have been silently violating the old
 * 4-value CHECK since they shipped (live table was empty).
 *
 * Idempotent: DROP IF EXISTS + ADD. Run:
 *   node scripts/ops/widen-credit-alert-types-20260710.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

async function main() {
  // 20260831 supersedes 20260830 (adds 'velocity_200'); both are idempotent
  // DROP+ADD, so applying the latest yields the full current value set.
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/20260831_credit_alert_velocity_type.sql'),
    'utf8',
  );
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.credit_alert_log'::regclass AND contype = 'c'",
    );
    console.log('APPLIED. Live constraint now:');
    console.log(rows[0]?.def ?? '(none found!)');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
