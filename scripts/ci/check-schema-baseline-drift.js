/**
 * W6 — is the committed CI baseline still an honest picture of production?
 *
 * The real-schema suite proves invariants hold *in the baseline*. That is only
 * worth something while the baseline still resembles production, so this script
 * closes the loop by diffing the two.
 *
 * IT IS NOT PART OF PR CI. It needs production credentials, and §8 of the W6
 * brief forbids CI from holding them. Run it locally, or from a scheduled job
 * with its own secret, whenever migrations land — then regenerate the baseline
 * if it reports drift.
 *
 * Production is READ ONLY here: pg_catalog queries, nothing else.
 *
 * Exit 0 = no drift. Exit 1 = drift, with the specific objects listed.
 *
 * Run: node scripts/ci/check-schema-baseline-drift.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const BASELINE = join(__dirname, '../../supabase/_schema/baseline.sql');

/**
 * Objects the baseline declares. Parsed from the dump text rather than by
 * restoring it, so this stays a cheap check that needs no container.
 */
function parseBaseline(sql) {
  const tables = new Set();
  const indexes = new Set();
  const constraints = new Set();

  for (const m of sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?public\.([A-Za-z0-9_]+)/gm)) tables.add(m[1]);
  for (const m of sql.matchAll(/^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?([A-Za-z0-9_]+)/gm)) indexes.add(m[1]);
  // pg_dump splits constraints across two forms: keys and foreign keys come
  // back as `ALTER TABLE ... ADD CONSTRAINT`, but CHECK constraints are emitted
  // inline inside CREATE TABLE. Missing the inline form reports every CHECK in
  // the database as drift.
  for (const m of sql.matchAll(/ADD CONSTRAINT ([A-Za-z0-9_]+)/g)) constraints.add(m[1]);
  for (const m of sql.matchAll(/^\s+CONSTRAINT ([A-Za-z0-9_]+) (?:CHECK|UNIQUE|PRIMARY KEY|FOREIGN KEY)/gm)) constraints.add(m[1]);

  return { tables, indexes, constraints };
}

async function liveObjects(client) {
  const tables = new Set((await client.query(
    `SELECT c.relname n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = 'public' AND c.relkind = 'r'`)).rows.map((r) => r.n));

  // Indexes that merely implement a PRIMARY KEY or UNIQUE constraint are not
  // emitted as CREATE INDEX by pg_dump — they arrive as ADD CONSTRAINT and are
  // counted there. Including them here would report every key in the database
  // as drift.
  const indexes = new Set((await client.query(
    `SELECT i.indexname n
       FROM pg_indexes i
       JOIN pg_class c ON c.relname = i.indexname
       JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = i.schemaname
      WHERE i.schemaname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
           WHERE con.conindid = c.oid
             -- Only PRIMARY KEY / UNIQUE constraints OWN their index. A FOREIGN
             -- KEY also records conindid — the index it points AT — and those
             -- indexes are real CREATE INDEX statements in the dump.
             AND con.contype IN ('p', 'u'))`)).rows.map((r) => r.n));

  const constraints = new Set((await client.query(
    `SELECT con.conname n FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = 'public' AND con.contype IN ('f','u','p','c')`)).rows.map((r) => r.n));

  return { tables, indexes, constraints };
}

const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

function report(label, baseline, live) {
  const missingFromBaseline = diff(live, baseline);   // production has it, baseline does not
  const missingFromLive = diff(baseline, live);       // baseline has it, production does not
  const drifted = missingFromBaseline.length + missingFromLive.length;

  console.log(`\n${label}: baseline ${baseline.size}, production ${live.size}`);
  if (!drifted) { console.log('  in sync'); return 0; }
  if (missingFromBaseline.length) {
    console.log(`  IN PRODUCTION, NOT IN BASELINE (${missingFromBaseline.length}):`);
    for (const x of missingFromBaseline.slice(0, 25)) console.log(`    + ${x}`);
    if (missingFromBaseline.length > 25) console.log(`    ... and ${missingFromBaseline.length - 25} more`);
  }
  if (missingFromLive.length) {
    console.log(`  IN BASELINE, NOT IN PRODUCTION (${missingFromLive.length}):`);
    for (const x of missingFromLive.slice(0, 25)) console.log(`    - ${x}`);
    if (missingFromLive.length > 25) console.log(`    ... and ${missingFromLive.length - 25} more`);
  }
  return drifted;
}

async function main() {
  const url = process.env.SUPABASE_POOLER_DB_URL;
  if (!url) { console.error('SUPABASE_POOLER_DB_URL is not set'); process.exit(1); }

  const baseline = parseBaseline(readFileSync(BASELINE, 'utf8'));
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const live = await liveObjects(client);
    let drifted = 0;
    drifted += report('Tables', baseline.tables, live.tables);
    drifted += report('Indexes', baseline.indexes, live.indexes);
    drifted += report('Constraints', baseline.constraints, live.constraints);

    console.log('');
    if (drifted) {
      console.log(`DRIFT: ${drifted} object(s) differ.`);
      console.log('Regenerate with: node scripts/ci/generate-schema-baseline.js');
      process.exitCode = 1;
    } else {
      console.log('NO DRIFT — the committed baseline matches production.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
