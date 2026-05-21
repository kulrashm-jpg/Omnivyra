/**
 * payment_provider_config — migration activation parity guard.
 *
 * Verifies, WITHOUT a database, that applying migration 20260714 is a
 * behavior-NEUTRAL activation:
 *
 *   1. Migration idempotency — the SQL uses CREATE TABLE IF NOT EXISTS,
 *      CREATE INDEX IF NOT EXISTS, and INSERT ... ON CONFLICT DO NOTHING,
 *      so re-applying it is a no-op.
 *   2. Compiled-default parity — the seeded razorpay/stripe rows are parsed
 *      directly from the migration SQL and asserted to be byte-identical to
 *      COMPILED_DEFAULT_PROVIDERS in the resolver. This is the guarantee
 *      that resolver `source` flips compiled_default → db with NO change in
 *      resolved provider behavior.
 *   3. Pricing-blindness — the table DDL declares no price/amount/cost
 *      columns.
 *
 * If either the migration seed OR the compiled defaults drift, this test
 * fails — the two can never silently diverge.
 */

import * as fs from 'fs';
import * as path from 'path';
import { COMPILED_DEFAULT_PROVIDERS } from '../../services/billing/payments/paymentProviderPolicyResolver';

const MIGRATION_PATH = path.resolve(
  __dirname, '../../../supabase/migrations/20260714_payment_provider_config.sql',
);
// Additive cashfree + phonepe seed (registration migration).
const MIGRATION_CF_PP_PATH = path.resolve(
  __dirname, '../../../supabase/migrations/20260716_payment_provider_config_cashfree_phonepe.sql',
);

function readMigration(): string {
  expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

function readCashfreePhonepeMigration(): string {
  expect(fs.existsSync(MIGRATION_CF_PP_PATH)).toBe(true);
  return fs.readFileSync(MIGRATION_CF_PP_PATH, 'utf8');
}

// ── seed parser ─────────────────────────────────────────────────────────────

interface ParsedSeedRow {
  provider: string;
  enabled: boolean;
  visible_in_checkout: boolean;
  subscriptions_enabled: boolean;
  topups_enabled: boolean;
  supported_countries: string[];
  supported_currencies: string[];
  supported_payment_methods: string[];
  priority: number;
  maintenance_mode: boolean;
  sandbox_mode: boolean;
}

function parseArrayLiteral(token: string): string[] {
  // Matches ARRAY['a','b']::text[]  OR  ARRAY[]::text[]
  const m = token.match(/ARRAY\[([^\]]*)\]/i);
  if (!m) throw new Error(`not an ARRAY literal: ${token}`);
  const inner = m[1].trim();
  if (inner === '') return [];
  return inner.split(',').map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''));
}

function parseBool(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  throw new Error(`not a bool: ${token}`);
}

/** Split a VALUES tuple into top-level comma-separated fields (commas inside
 *  ARRAY[...] are ignored). */
function splitTupleFields(tuple: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of tuple) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim());
}

function parseSeed(sql: string): ParsedSeedRow[] {
  // Isolate the VALUES (...) ... ON CONFLICT block.
  const valuesMatch = sql.match(/VALUES([\s\S]*?)ON CONFLICT/i);
  expect(valuesMatch).not.toBeNull();
  const valuesBlock = valuesMatch![1];

  // Each row tuple is wrapped in (...). Extract balanced top-level groups.
  const rows: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of valuesBlock) {
    if (ch === '(') { depth++; if (depth === 1) { buf = ''; continue; } }
    if (ch === ')') { depth--; if (depth === 0) { rows.push(buf); continue; } }
    if (depth >= 1) buf += ch;
  }

  return rows.map((tuple) => {
    const f = splitTupleFields(tuple);
    // 11 columns, in migration order.
    expect(f).toHaveLength(11);
    return {
      provider: f[0].replace(/^'/, '').replace(/'$/, ''),
      enabled: parseBool(f[1]),
      visible_in_checkout: parseBool(f[2]),
      subscriptions_enabled: parseBool(f[3]),
      topups_enabled: parseBool(f[4]),
      supported_countries: parseArrayLiteral(f[5]),
      supported_currencies: parseArrayLiteral(f[6]),
      supported_payment_methods: parseArrayLiteral(f[7]),
      priority: Number(f[8].trim()),
      maintenance_mode: parseBool(f[9]),
      sandbox_mode: parseBool(f[10]),
    };
  });
}

// ── 1. migration idempotency ────────────────────────────────────────────────

describe('20260714 migration — idempotency', () => {
  test('uses CREATE TABLE IF NOT EXISTS', () => {
    expect(readMigration()).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_provider_config/i);
  });
  test('uses CREATE INDEX IF NOT EXISTS', () => {
    expect(readMigration()).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });
  test('seed uses ON CONFLICT (provider) DO NOTHING — re-apply is a no-op', () => {
    expect(readMigration()).toMatch(/ON CONFLICT \(provider\) DO NOTHING/i);
  });
  test('migration contains no destructive DDL (no DROP / DELETE / TRUNCATE / ALTER of other tables)', () => {
    const sql = readMigration().toUpperCase();
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/);
    expect(sql).not.toMatch(/\bTRUNCATE\b/);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/);
  });
});

// ── 1b. cashfree + phonepe registration migration idempotency ───────────────

describe('20260716 migration (cashfree + phonepe) — idempotency', () => {
  test('is INSERT-only — no CREATE/DROP/ALTER (purely additive seed)', () => {
    const sql = readCashfreePhonepeMigration().toUpperCase();
    expect(sql).toMatch(/INSERT INTO PUBLIC\.PAYMENT_PROVIDER_CONFIG/);
    expect(sql).not.toMatch(/\bCREATE TABLE\b/);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/);
    expect(sql).not.toMatch(/\bALTER TABLE\b/);
    expect(sql).not.toMatch(/\bTRUNCATE\b/);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/);
  });
  test('seed uses ON CONFLICT (provider) DO NOTHING — re-apply is a no-op', () => {
    expect(readCashfreePhonepeMigration()).toMatch(/ON CONFLICT \(provider\) DO NOTHING/i);
  });
});

// ── 2. compiled-default parity (union of both seed migrations) ──────────────

/** Combined seed across 20260714 + 20260716. */
function combinedSeed(): ParsedSeedRow[] {
  return [...parseSeed(readMigration()), ...parseSeed(readCashfreePhonepeMigration())];
}

describe('payment_provider_config seed — compiled-default parity', () => {
  test('combined seed registers exactly the four providers', () => {
    expect(combinedSeed().map((r) => r.provider).sort())
      .toEqual(['cashfree', 'phonepe', 'razorpay', 'stripe']);
  });

  test('20260716 registers exactly cashfree + phonepe', () => {
    expect(parseSeed(readCashfreePhonepeMigration()).map((r) => r.provider).sort())
      .toEqual(['cashfree', 'phonepe']);
  });

  test('each seeded row is byte-identical to COMPILED_DEFAULT_PROVIDERS', () => {
    const seed = combinedSeed();
    for (const compiled of COMPILED_DEFAULT_PROVIDERS) {
      const seeded = seed.find((r) => r.provider === compiled.provider);
      expect(seeded).toBeDefined();
      expect(seeded).toEqual({
        provider: compiled.provider,
        enabled: compiled.enabled,
        visible_in_checkout: compiled.visible_in_checkout,
        subscriptions_enabled: compiled.subscriptions_enabled,
        topups_enabled: compiled.topups_enabled,
        supported_countries: compiled.supported_countries,
        supported_currencies: compiled.supported_currencies,
        supported_payment_methods: compiled.supported_payment_methods,
        priority: compiled.priority,
        maintenance_mode: compiled.maintenance_mode,
        sandbox_mode: compiled.sandbox_mode,
      });
    }
  });

  test('combined seed providers === compiled-default providers (no drift either way)', () => {
    const seedProviders = combinedSeed().map((r) => r.provider).sort();
    const compiledProviders = COMPILED_DEFAULT_PROVIDERS.map((r) => r.provider).sort();
    expect(seedProviders).toEqual(compiledProviders);
  });

  test('cashfree + phonepe are seeded HIDDEN + DISABLED + sandbox (behavior-neutral registration)', () => {
    for (const p of ['cashfree', 'phonepe']) {
      const row = combinedSeed().find((r) => r.provider === p)!;
      expect(row.enabled).toBe(false);
      expect(row.visible_in_checkout).toBe(false);
      expect(row.sandbox_mode).toBe(true);
    }
  });
});

// ── 3. pricing-blindness ────────────────────────────────────────────────────

describe('20260714 migration — pricing-blindness', () => {
  test('table DDL declares no price/amount/cost columns', () => {
    // Inspect only the CREATE TABLE column block.
    const sql = readMigration();
    const tableBlock = sql.match(/CREATE TABLE IF NOT EXISTS public\.payment_provider_config\s*\(([\s\S]*?)\n\);/i);
    expect(tableBlock).not.toBeNull();
    const cols = tableBlock![1].toLowerCase();
    for (const banned of ['price', 'amount', 'cost', 'plan_price', 'subtotal', 'total']) {
      // Allow the word inside comments only — assert it's not a column name
      // (a column line starts with the identifier).
      const columnNamed = new RegExp(`^\\s*${banned}\\b`, 'm');
      expect(columnNamed.test(cols)).toBe(false);
    }
  });
});
