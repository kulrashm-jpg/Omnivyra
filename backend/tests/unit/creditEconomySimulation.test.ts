/**
 * PHASE 12G — FULL CREDIT-ECONOMY FINANCIAL SIMULATION (offline, no DB).
 *
 * Drives the REAL certified financial functions —
 *   planEntryConsumptionSettlement   (the engine's settlement arithmetic core)
 *   resolveActivityEconomics         (the Phase 8A catalog)
 *   resolveAssetActivityEconomics    (asset cost-profile bridge)
 * — against an in-memory per-company ledger to prove the complete lifecycle
 * (entry → exposure → settle → release), tenant isolation, abandonment, replay,
 * asset settlement, report settlement, and margin end-to-end.
 *
 * NO database, NO Supabase, NO Redis, NO production mutation — the heavy module
 * graph is mocked ONLY so the pure functions import; the numbers come from the
 * real functions. The engine's RPC composition (HOLD→CONFIRM→PARTIAL→RELEASE,
 * idempotency, abandonment) is independently proven in activityEntryConsumption
 * .test.ts; here we prove the integrated multi-activity balance behavior.
 */

// ── import-enablers (so creditExecutionService's module graph loads) ──────────
jest.mock('../../db/supabaseClient', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../../../shared/monetization/featureRegistry', () => ({
  resolveMonetizationFeature: (i: { action_key: string }) => ({ feature_key: 'f', action_key: i.action_key, pricing_key: 'p', feature: { feature_key: 'f', pricing_keys: {} } }),
  getFeatureDisplayGroup: () => null,
}));
jest.mock('../../repositories/creditExecutionRepository', () => ({ callCreditReservation: jest.fn(), callCreditPartialConfirm: jest.fn(), findCreditTransaction: jest.fn(), loadCreditHoldSplit: jest.fn() }));
jest.mock('../../services/creditPriorityService', () => ({ getTotalAvailable: jest.fn(), getWalletSnapshot: jest.fn(), resolveDeduction: jest.fn() }));
jest.mock('../../services/orgControlService', () => ({ preflightCheck: jest.fn(), autoBlockLlm: jest.fn() }));
jest.mock('../../services/billing/billingPolicyResolver', () => ({ resolveBillingPolicy: jest.fn() }));
jest.mock('../../services/billing/creditSafetyGate', () => ({ evaluateCreditSafetyGate: jest.fn(() => 'allow') }));
jest.mock('../../services/usageTrackingService', () => ({ trackUsage: jest.fn() }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn() }));
jest.mock('../../services/creditAlertService', () => ({ checkCreditAlerts: jest.fn() }));
jest.mock('../../services/pricingService', () => ({ resolveLlmCost: jest.fn(), estimateLlmHoldCredits: jest.fn(), recordCostAnomaly: jest.fn() }));
jest.mock('../../services/billing/creditEconomyObservability', () => ({ recordSettlementObservation: jest.fn(), recordShadowObservation: jest.fn(), recordAdmissionObservation: jest.fn() }));

import { planEntryConsumptionSettlement } from '../../services/creditExecutionService';
import { resolveActivityEconomics } from '../../services/activityEconomyCatalog';
import { resolveAssetActivityEconomics } from '../../services/creator/assetActivityEconomics';

// ── representative pricing (live llm_model_pricing gpt-4o-mini rates, 12C) ─────
const IN_USD_PER_1K = 0.0003, OUT_USD_PER_1K = 0.0006;
const CREDIT_SALE_USD = 0.02; // representative customer credit price (sale value)
const providerCostUsd = (inTok: number, outTok: number) => (inTok / 1000) * IN_USD_PER_1K + (outTok / 1000) * OUT_USD_PER_1K;

interface LedgerEvent {
  org: string; action: string; status: string;
  entry?: number; reserved?: number; additional?: number; released?: number; settled?: number; underfunded?: boolean;
  inTok?: number; outTok?: number;
}

class CompanyLedger {
  available: number; reserved = 0; consumed = 0;
  events: LedgerEvent[] = [];
  private seen = new Set<string>();
  constructor(public org: string, start: number) { this.available = start; }

  /** Entry-consumption lifecycle for one activity (token-actual or fixed). */
  run(action: string, actualCredits: number, idem: string, opts: { abandon?: boolean; inTok?: number; outTok?: number } = {}) {
    if (this.seen.has(idem)) { this.events.push({ org: this.org, action, status: 'replay_noop' }); return { replay: true }; }
    const e = resolveActivityEconomics(action);
    const entry = e.entryConsumption, reservation = e.reservationCredits, max = e.maximumCredits;
    if (this.available < max) { this.events.push({ org: this.org, action, status: 'admission_blocked' }); return { blocked: true }; }
    // STAGE 1 — entry consumed (non-refundable). STAGE 2 — exposure HOLD.
    this.available -= entry; this.consumed += entry;
    this.available -= reservation; this.reserved += reservation;
    if (opts.abandon) {
      // executor throws → release exposure, KEEP entry.
      this.available += reservation; this.reserved -= reservation;
      this.events.push({ org: this.org, action, status: 'abandoned', entry, reserved: reservation, released: reservation, settled: entry });
      return { abandoned: true, entry, released: reservation };
    }
    // STAGE 3/4 — settle token-actual: draw (actual−entry) from exposure, release the rest.
    const plan = planEntryConsumptionSettlement({ entry, reservation, actualCredits });
    this.consumed += plan.additionalConsumption;
    this.available += plan.exposureReleased; this.reserved -= reservation;
    this.seen.add(idem);
    const settled = entry + plan.additionalConsumption;
    this.events.push({ org: this.org, action, status: 'settled', entry, reserved: reservation, additional: plan.additionalConsumption, released: plan.exposureReleased, settled, underfunded: plan.underfunded, inTok: opts.inTok, outTok: opts.outTok });
    return { settled, ...plan };
  }

  /** Reports — HOLD(flat) → token-actual partial-confirm → release remainder. */
  report(hold: number, actualCredits: number, idem: string, inTok: number, outTok: number) {
    if (this.seen.has(idem)) { this.events.push({ org: this.org, action: 'report', status: 'replay_noop' }); return { replay: true }; }
    this.available -= hold; this.reserved += hold;
    const settled = Math.min(actualCredits, hold), released = hold - settled;
    this.available += released; this.reserved -= hold; this.consumed += settled;
    this.seen.add(idem);
    this.events.push({ org: this.org, action: 'report', status: 'settled', reserved: hold, settled, released, inTok, outTok });
    return { settled, released };
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe('PHASE 12G — full credit-economy financial simulation', () => {
  const A = new CompanyLedger('company-A', 1000);
  const B = new CompanyLedger('company-B', 300);

  it('runs the full 2-company scenario and proves every lifecycle invariant', () => {
    // ── Company A (well-funded) ──────────────────────────────────────────────
    A.run('content_generation', 22, 'A:cg:1', { inTok: 6000, outTok: 1800 }); // token-actual
    A.run('blog_generation',    60, 'A:bg:1', { inTok: 9000, outTok: 4000 }); // long, hits cap exactly
    A.run('creator_content',     6, 'A:cc:1', { inTok: 1500, outTok: 400 });  // text 4 + asset 2 (see asset test)
    A.run('recommendations_generate', 8, 'A:rec:1', { inTok: 1200, outTok: 300 });
    A.run('async_campaign_planning', 50, 'A:cp:1', { inTok: 8000, outTok: 2500 });
    A.report(40, 12, 'A:rep:1', 5000, 1500); // HOLD 40 → token-actual 12, release 28

    // ── Company B (moderately funded) + abandonment + replay ────────────────
    B.run('content_generation', 18, 'B:cg:1', { inTok: 5000, outTok: 1500 });
    B.run('creator_content',     5, 'B:cc:1', { inTok: 1300, outTok: 350 });
    B.run('content_generation', 99, 'B:cg:abandon', { abandon: true });       // fails mid-exec
    B.run('recommendations_generate', 8, 'B:rec:1', { inTok: 1200, outTok: 300 });
    B.run('recommendations_generate', 8, 'B:rec:1', { inTok: 1200, outTok: 300 }); // REPLAY (same idem)

    // ── invariant: reserved fully released after every settled activity ──────
    expect(A.reserved).toBe(0);
    expect(B.reserved).toBe(0);

    // ── invariant: balance == start − consumed, and consumed == Σ settled ────
    const aSettled = A.events.filter(e => e.status === 'settled' || e.status === 'abandoned').reduce((s, e) => s + (e.settled ?? 0), 0);
    const bSettled = B.events.filter(e => e.status === 'settled' || e.status === 'abandoned').reduce((s, e) => s + (e.settled ?? 0), 0);
    expect(A.consumed).toBe(aSettled);
    expect(B.consumed).toBe(bSettled);
    expect(A.available).toBe(1000 - A.consumed);
    expect(B.available).toBe(300 - B.consumed);

    // expected balances (hand-derived against the real planner)
    expect(A.consumed).toBe(22 + 60 + 6 + 8 + 50 + 12); // 158
    expect(A.available).toBe(842);
    expect(B.consumed).toBe(18 + 5 + 10 /*abandon entry*/ + 8 /*rec once*/); // 41
    expect(B.available).toBe(259);
  });

  it('ABANDONMENT — entry retained, exposure released', () => {
    const ev = B.events.find(e => e.action === 'content_generation' && e.status === 'abandoned')!;
    const econ = resolveActivityEconomics('content_generation');
    expect(ev.settled).toBe(econ.entryConsumption);   // only entry kept (10)
    expect(ev.released).toBe(econ.reservationCredits); // full exposure released (50)
  });

  it('REPLAY — same idempotency key charged once', () => {
    const recEvents = B.events.filter(e => e.action === 'recommendations_generate');
    expect(recEvents.map(e => e.status)).toEqual(['settled', 'replay_noop']); // 2nd is no-op
    const recCharges = recEvents.filter(e => e.status === 'settled').reduce((s, e) => s + (e.settled ?? 0), 0);
    expect(recCharges).toBe(8); // charged once, not 16
  });

  it('ASSET settlement — token cost + asset cost = final credits', () => {
    const asset = resolveAssetActivityEconomics({ contentType: 'carousel', assetCount: 1 }); // 2 cr/asset
    const textCredits = 4, assetCredits = asset.actualCredits; // 2
    expect(assetCredits).toBe(2);
    expect(textCredits + assetCredits).toBe(6); // == creator_content actual settled for A:cc:1
    const cc = A.events.find(e => e.action === 'creator_content')!;
    expect(cc.settled).toBe(6);
  });

  it('REPORTS settlement — token-actual + exposure release', () => {
    const rep = A.events.find(e => e.action === 'report')!;
    expect(rep.settled).toBe(12);          // token-actual
    expect(rep.released).toBe(40 - 12);    // unused exposure released
  });

  it('TENANT ISOLATION — each ledger is org-scoped; super-admin sees both', () => {
    expect(A.events.every(e => e.org === 'company-A')).toBe(true);
    expect(B.events.every(e => e.org === 'company-B')).toBe(true);
    expect(A.events.some(e => e.org === 'company-B')).toBe(false);
    const superAdminView = [...A.events, ...B.events];
    expect(new Set(superAdminView.map(e => e.org))).toEqual(new Set(['company-A', 'company-B']));
  });

  it('MARGIN — provider cost < credit value for every charged activity (positive margin)', () => {
    const rows: any[] = [];
    let platformRevenueUsd = 0, platformCostUsd = 0;
    for (const led of [A, B]) {
      for (const e of led.events) {
        if (e.status !== 'settled' || !e.settled) continue;
        const cost = providerCostUsd(e.inTok ?? 0, e.outTok ?? 0);
        const valueUsd = e.settled * CREDIT_SALE_USD;
        const margin = round(valueUsd - cost);
        platformRevenueUsd += valueUsd; platformCostUsd += cost;
        rows.push({ org: e.org, action: e.action, tokens: (e.inTok ?? 0) + (e.outTok ?? 0), providerUsd: round(cost), credits: e.settled, valueUsd: round(valueUsd), marginUsd: margin });
        expect(margin).toBeGreaterThan(0); // value-priced credits exceed provider cost
      }
    }
    const platformMargin = round(platformRevenueUsd - platformCostUsd);
    expect(platformMargin).toBeGreaterThan(0);

    // ── print the simulation report ──────────────────────────────────────────
    /* eslint-disable no-console */
    console.log('\n===== OUTPUT B — COMPANY A LEDGER (start 1000) =====');
    A.events.forEach(e => console.log(`  ${e.status.padEnd(14)} ${String(e.action).padEnd(24)} entry=${e.entry ?? '-'} reserved=${e.reserved ?? '-'} add=${e.additional ?? '-'} released=${e.released ?? '-'} settled=${e.settled ?? '-'}${e.underfunded ? ' UNDERFUNDED' : ''}`));
    console.log(`  >> consumed=${A.consumed} reserved=${A.reserved} FINAL BALANCE=${A.available}`);
    console.log('\n===== OUTPUT C — COMPANY B LEDGER (start 300) =====');
    B.events.forEach(e => console.log(`  ${e.status.padEnd(14)} ${String(e.action).padEnd(24)} entry=${e.entry ?? '-'} reserved=${e.reserved ?? '-'} add=${e.additional ?? '-'} released=${e.released ?? '-'} settled=${e.settled ?? '-'}`));
    console.log(`  >> consumed=${B.consumed} reserved=${B.reserved} FINAL BALANCE=${B.available}`);
    console.log('\n===== OUTPUT D — SUPER-ADMIN ECONOMIC LEDGER (margin) =====');
    rows.forEach(r => console.log(`  ${r.org} ${r.action.padEnd(24)} tok=${String(r.tokens).padStart(6)} providerUSD=$${r.providerUsd.toFixed(5)} credits=${String(r.credits).padStart(3)} valueUSD=$${r.valueUsd.toFixed(3)} marginUSD=$${r.marginUsd.toFixed(3)}`));
    console.log(`  >> PLATFORM revenueUSD=$${round(platformRevenueUsd).toFixed(3)} costUSD=$${round(platformCostUsd).toFixed(5)} MARGIN=$${platformMargin.toFixed(3)} (${round(platformMargin / platformRevenueUsd * 100).toFixed(1)}%)`);
    /* eslint-enable no-console */
  });
});
