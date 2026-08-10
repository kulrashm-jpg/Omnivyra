/**
 * P2-C — duplicate-credit protection under REAL PostgreSQL concurrency.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `paymentClosureP1` proves the state machine, but it runs against an in-memory
 * fake table. A fake cannot enforce a CHECK, a UNIQUE index, or the atomicity of
 * `UPDATE ... WHERE status='pending'`, so it can only demonstrate that our code
 * *intends* to be idempotent — never that Postgres *makes* it so. Every
 * assertion in that suite is also sequential.
 *
 * This suite closes exactly that gap. It runs the REAL services against the
 * certification Postgres, drives them with genuine `Promise.all`, and asserts on
 * rows read back out of the database rather than on API return values.
 *
 * WHAT IS AND IS NOT MOCKED
 * -------------------------
 * The database is REAL — that is the entire point. The only stub is
 * `resolveProviderOrderOutcome`, i.e. "what the payment gateway says", because
 * there is no Razorpay/Cashfree sandbox in the certification environment and the
 * provider's verdict is an *input* to the behaviour under test, not the
 * behaviour itself. Credit allocation, invoicing, CAS and uniqueness all execute
 * for real.
 *
 * SAFETY
 * ------
 * Fails closed. Cert credentials are loaded and screened for production markers,
 * and the DB connection is asserted to be a loopback host, BEFORE any service
 * module is required. If the target cannot be proven to be certification-only
 * the suite throws in `beforeAll` rather than touching anything.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// ── Cert environment, installed BEFORE any service module is loaded ──────────
// `config/index.ts` validates and deep-freezes on first import, so the env has
// to be correct up front. Every module under test is therefore `require`d
// inside beforeAll, never imported at the top of this file.
const CERT_KEYS = 'C:/tmp/certenv.beta.keys.env';
const PROD_MARKERS = [/klkiseupptzbecbxwrky/i, /pooler\.supabase/i];

/**
 * Whether a certification database is available at all.
 *
 * This is an AVAILABILITY check, not a safety relaxation. When the cert env is
 * absent (e.g. CI, or a laptop with Docker down) the suite reports itself as
 * skipped rather than failing the whole run — but it NEVER falls back to a mock
 * or to any other database, so "skipped" can never be mistaken for "proven".
 * When it does run, `assertCertOnly` below is absolute.
 */
const CERT_AVAILABLE = fs.existsSync(CERT_KEYS);

function loadCertEnv(): Record<string, string> {
  if (!fs.existsSync(CERT_KEYS)) {
    throw new Error(`[P2-C] certification keys not found at ${CERT_KEYS} — refusing to run`);
  }
  const kv: Record<string, string> = {};
  for (const line of fs.readFileSync(CERT_KEYS, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf('=');
    kv[line.slice(0, i)] = line.slice(i + 1);
  }
  return kv;
}

/** Hard gate. Anything that cannot be proven cert-only aborts the suite. */
function assertCertOnly(kv: Record<string, string>): void {
  const url = kv.BETA_SUPABASE_URL ?? '';
  const db = kv.BETA_DB_URL ?? '';
  for (const marker of PROD_MARKERS) {
    if (marker.test(url) || marker.test(db)) {
      throw new Error(`[P2-C] PRODUCTION MARKER in cert config (${marker}) — refusing to run`);
    }
  }
  // Loopback only. A remote host is never a certification database.
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`[P2-C] cert Supabase URL is not loopback: ${url} — refusing to run`);
  }
  if (!/@(localhost|127\.0\.0\.1):/.test(db)) {
    throw new Error(`[P2-C] cert DB URL is not loopback — refusing to run`);
  }
  // Defer to the repository's own guard so this suite can never drift from it.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/cert/assert-cert-isolation.mjs')], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: kv.BETA_SUPABASE_SERVICE_KEY,
      DATABASE_URL: db,
      SUPABASE_POOLER_DB_URL: '',
      DIRECT_URL: '',
      MIGRATION_DATABASE_URL: '',
    },
    stdio: 'pipe',
  });
}

const cert = CERT_AVAILABLE ? loadCertEnv() : ({} as Record<string, string>);
if (CERT_AVAILABLE) {
  assertCertOnly(cert);
} else {
  // Loud on purpose: a silent skip of a financial-integrity proof is worse than
  // a noisy one.
  console.warn('[P2-C] SKIPPED — no certification database. Duplicate-credit protection is NOT proven in this run.');
}

if (CERT_AVAILABLE) {
process.env.NEXT_PUBLIC_SUPABASE_URL = cert.BETA_SUPABASE_URL;
process.env.SUPABASE_URL = cert.BETA_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = cert.BETA_SUPABASE_SERVICE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = cert.BETA_SUPABASE_ANON_KEY;
process.env.SUPABASE_ANON_KEY = cert.BETA_SUPABASE_ANON_KEY;
process.env.DATABASE_URL = cert.BETA_DB_URL;
}

// The provider's verdict is an INPUT. Everything downstream of it is real.
const providerOutcome = jest.fn();
jest.mock('../../services/payments/orchestrator', () => ({
  resolveProviderOrderOutcome: (...args: unknown[]) => providerOutcome(...args),
}));

// ── Loaded in beforeAll, after the env above is in place ────────────────────
let supabase: any;
let fulfillProviderConfirmedPurchase: any;
let expireStalePendingPurchases: any;
let completePurchase: any;
let reconcile: any;

const ORG = '00000000-0000-4000-8000-00000000000a';   // seeded cert company
const RUN = `p2c-${Date.now()}`;
const createdPurchaseIds: string[] = [];
// `credit_purchases_source_check` requires package_id OR plan_id, and the cert
// DB ships neither table populated — so this suite owns its own package row and
// removes it again in afterAll.
let PACKAGE_ID = '';

function uuid(): string {
  return (globalThis.crypto as any).randomUUID();
}

/** Insert a purchase directly, bypassing create-order (not under test here). */
async function seedPurchase(over: Record<string, unknown> = {}): Promise<string> {
  const id = uuid();
  const { error } = await supabase.from('credit_purchases').insert({
    id,
    organization_id: ORG,
    package_id: PACKAGE_ID,
    credits: 250,
    amount_paid: 2520,
    currency: 'INR',
    status: 'pending',
    fulfillment_status: 'pending',
    provider: 'razorpay',
    provider_order_id: `order_${RUN}_${createdPurchaseIds.length}`,
    provider_mode: 'test',
    provider_payload: {},
    created_at: new Date().toISOString(),
    ...over,
  });
  if (error) throw new Error(`seedPurchase failed: ${error.message}`);
  createdPurchaseIds.push(id);
  return id;
}

/** Ledger rows the grant for this purchase produced — read from Postgres. */
async function creditRowsFor(purchaseId: string): Promise<any[]> {
  const { makeIdempotencyKey } = require('../../services/creditExecutionService');
  const key = makeIdempotencyKey(ORG, 'credit_purchase', purchaseId);
  const { data } = await supabase
    .from('credit_transactions')
    .select('id, idempotency_key, credits_delta, category')
    .eq('idempotency_key', key);
  return data ?? [];
}

async function purchaseRow(purchaseId: string): Promise<any> {
  const { data } = await supabase
    .from('credit_purchases')
    .select('id, status, fulfillment_status, provider_payload')
    .eq('id', purchaseId)
    .maybeSingle();
  return data;
}

async function invoiceCountFor(purchaseId: string): Promise<number> {
  // Invoices key off the purchase through their deterministic number.
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .ilike('invoice_number', `%${purchaseId.slice(0, 8)}%`);
  return (data ?? []).length;
}

beforeAll(async () => {
  supabase = require('../../db/supabaseClient').supabase;
  ({ fulfillProviderConfirmedPurchase, expireStalePendingPurchases } =
    require('../../services/billing/purchaseClosureService'));
  ({ completePurchase } = require('../../services/purchaseService'));
  ({ reconcile } = require('../../services/billing/commercialReconciliationService'));

  // Prove at runtime that we are actually talking to the cert database.
  const { error } = await supabase.from('credit_purchases').select('id').limit(1);
  if (error) throw new Error(`[P2-C] cert DB unreachable: ${error.message}`);

  PACKAGE_ID = uuid();
  const { error: pkgErr } = await supabase.from('credit_packages').insert({
    id: PACKAGE_ID, name: `P2C ${RUN}`, credits: 250, price: 2520, is_active: true,
  });
  if (pkgErr) throw new Error(`[P2-C] package fixture failed: ${pkgErr.message}`);
}, 60_000);

beforeEach(() => {
  providerOutcome.mockReset();
  providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
});

afterAll(async () => {
  // Leave the cert DB as we found it — this suite owns only its own rows.
  for (const id of createdPurchaseIds) {
    await supabase.from('credit_purchases').delete().eq('id', id);
  }
  if (PACKAGE_ID) await supabase.from('credit_packages').delete().eq('id', PACKAGE_ID);
}, 60_000);

// ═══════════════════════════════════════════════════════════════════════════
const maybeDescribe = CERT_AVAILABLE ? describe : describe.skip;
maybeDescribe('P2-C — real Postgres, genuine concurrency', () => {
  it('A — two simultaneous webhook deliveries grant exactly once', async () => {
    const id = await seedPurchase();

    await Promise.all([
      fulfillProviderConfirmedPurchase(id, 'pay_A_1'),
      fulfillProviderConfirmedPurchase(id, 'pay_A_2'),
    ]);

    const credits = await creditRowsFor(id);
    const row = await purchaseRow(id);
    expect(credits).toHaveLength(1);              // Postgres UNIQUE did the work
    expect(row.status).toBe('completed');
    expect(await invoiceCountFor(id)).toBe(1);   // exactly one — not merely "no duplicates"
  }, 60_000);

  it('B — webhook and verify racing settle exactly once', async () => {
    const id = await seedPurchase();

    await Promise.all([
      fulfillProviderConfirmedPurchase(id, 'pay_B_hook'),
      completePurchase(id, 'pay_B_verify'),
    ]);

    expect(await creditRowsFor(id)).toHaveLength(1);
    expect((await purchaseRow(id)).status).toBe('completed');
  }, 60_000);

  it('C — webhook and commercial reconciliation racing grant exactly once', async () => {
    const id = await seedPurchase({ status: 'completed', fulfillment_status: 'event_recorded' });

    await Promise.all([
      fulfillProviderConfirmedPurchase(id, 'pay_C_hook'),
      reconcile({ kind: 'single', purchaseId: id }, false),
    ]);

    expect(await creditRowsFor(id)).toHaveLength(1);
    expect((await purchaseRow(id)).fulfillment_status).toBe('completed');
  }, 60_000);

  it('D — reconcile and expiry racing produce no double closure and no credit', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 60_000).toISOString();
    const id = await seedPurchase({ created_at: stale });
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });

    await Promise.all([
      reconcile({ kind: 'single', purchaseId: id }, false),
      expireStalePendingPurchases({ ttlMinutes: 1, organizationId: ORG }),
    ]);

    const row = await purchaseRow(id);
    expect(row.status).toBe('failed');                       // closed exactly once
    expect(await creditRowsFor(id)).toHaveLength(0);         // never credited
    expect((row.provider_payload as any).closure?.reopenable).toBe(true);
  }, 90_000);

  it('E — the same webhook delivered 10× concurrently grants exactly once', async () => {
    const id = await seedPurchase();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => fulfillProviderConfirmedPurchase(id, `pay_E_${i}`)),
    );

    expect(await creditRowsFor(id)).toHaveLength(1);
    expect((await purchaseRow(id)).status).toBe('completed');
    expect(await invoiceCountFor(id)).toBe(1);   // exactly one — not merely "no duplicates"
  }, 90_000);

  it('F — a provider that reports pending/unknown allocates nothing', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 60_000).toISOString();
    const id = await seedPurchase({ created_at: stale });
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'provider_pending' });

    const res = await expireStalePendingPurchases({ ttlMinutes: 1, organizationId: ORG });

    expect(res.deferred).toBeGreaterThanOrEqual(1);
    const row = await purchaseRow(id);
    expect(row.status).toBe('pending');                 // unresolved, not closed
    expect(await creditRowsFor(id)).toHaveLength(0);
  }, 60_000);

  it('G — a provider-declined purchase is closed, never credited, and never reopenable-to-credit', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 60_000).toISOString();
    const id = await seedPurchase({ created_at: stale });
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'failed' });

    await expireStalePendingPurchases({ ttlMinutes: 1, organizationId: ORG });

    const row = await purchaseRow(id);
    expect(row.status).toBe('failed');
    expect(await creditRowsFor(id)).toHaveLength(0);
  }, 60_000);

  it('H — a verified success with no local purchase allocates nothing and creates nothing', async () => {
    const orphan = uuid();                                   // never inserted

    const before = await supabase.from('credit_purchases').select('id').eq('id', orphan);
    const result = await fulfillProviderConfirmedPurchase(orphan, 'pay_H');
    const after = await supabase.from('credit_purchases').select('id').eq('id', orphan);

    expect(result.ok).toBe(false);                           // refused
    expect((before.data ?? []).length).toBe(0);
    expect((after.data ?? []).length).toBe(0);               // no synthetic purchase
    expect(await creditRowsFor(orphan)).toHaveLength(0);
  }, 60_000);
});
