/**
 * Billing-policy governance layer — additive, default-preserving.
 * Tests ONLY: fallback-to-env, global override, org override, precedence,
 * replay determinism, resumed-HOLD non-re-resolution (structural), and
 * mid-execution stability. No wallet/HOLD/ledger involved.
 */

// Controlled supabase mock: the resolver awaits
// supabase.from(..).select(..).eq(..).eq(..).lte(..).order(..) → {data,error}.
let __rows: any[] | null = null;
let __error: any = null;
let __throw = false;

jest.mock('../../db/supabaseClient', () => {
  const builder: any = {};
  for (const m of ['select', 'eq', 'lte']) builder[m] = () => builder;
  builder.order = () => {
    if (__throw) return Promise.reject(new Error('relation "billing_policy_config" does not exist'));
    return Promise.resolve({ data: __rows, error: __error });
  };
  return { supabase: { from: () => builder } };
});

import { resolveBillingPolicy } from '../../services/billing/billingPolicyResolver';
import { evaluateCreditSafetyGate } from '../../services/billing/creditSafetyGate';

function resetMock() { __rows = null; __error = null; __throw = false; }

const ENV_KEYS = ['PHASE2_BILLING_KILL_SWITCH', 'PHASE2_SAFETY_GATE', 'PHASE2_SAFETY_FACTOR'];
function clearEnv() { for (const k of ENV_KEYS) delete (process.env as any)[k]; }

beforeEach(() => { resetMock(); clearEnv(); });
afterAll(() => { clearEnv(); });

describe('billing-policy resolver — fallback safety', () => {
  test('table absent / query throws → resolves to {} (env fallback, never throws)', async () => {
    __throw = true;
    await expect(resolveBillingPolicy('org-1')).resolves.toEqual({});
  });

  test('no rows → {} (default-preserving)', async () => {
    __rows = [];
    await expect(resolveBillingPolicy('org-1')).resolves.toEqual({});
  });

  test('global row resolves; org override beats global (precedence)', async () => {
    __rows = [
      { scope: 'global',       organization_id: null,  value: 'shadow' },
      { scope: 'organization', organization_id: 'org-1', value: 'enforce' },
    ];
    // safety_gate_mode key → org wins
    const orgScoped = await resolveBillingPolicy('org-1');
    expect(orgScoped.safety_gate_mode).toBe('enforce');
    // different org → falls back to global
    const otherOrg = await resolveBillingPolicy('org-2');
    expect(otherOrg.safety_gate_mode).toBe('shadow');
    // no org → global
    const noOrg = await resolveBillingPolicy();
    expect(noOrg.safety_gate_mode).toBe('shadow');
  });
});

describe('safety gate — default-preservation (policy undefined → env)', () => {
  test('no policy + no env → pass (byte-identical OFF default)', () => {
    expect(evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 0, projectedCredits: 100,
    })).toBe('pass');
  });

  test('no policy + env enforce + under threshold → block (env path intact)', () => {
    process.env.PHASE2_SAFETY_GATE = 'enforce';
    process.env.PHASE2_SAFETY_FACTOR = '0.8';
    expect(evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 10, projectedCredits: 100, // need 80
    })).toBe('block');
  });

  test('no policy + env enforce + at exact threshold → pass', () => {
    process.env.PHASE2_SAFETY_GATE = 'enforce';
    process.env.PHASE2_SAFETY_FACTOR = '0.8';
    expect(evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 80, projectedCredits: 100,
    })).toBe('pass');
  });
});

describe('safety gate — policy override beats env; precedence + determinism', () => {
  test('policy.safety_gate_mode overrides env off → enforce/block', () => {
    // env says OFF, policy says enforce → policy wins
    expect(evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 10, projectedCredits: 100,
      policy: { safety_gate_mode: 'enforce', safety_factor: 0.8 },
    })).toBe('block');
  });

  test('policy.kill_switch=true forces pass even under enforce policy', () => {
    expect(evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 0, projectedCredits: 100,
      policy: { kill_switch: true, safety_gate_mode: 'enforce', safety_factor: 1 },
    })).toBe('pass');
  });

  test('replay determinism: identical (inputs+policy) → identical decision, repeatable & pure', () => {
    const call = () => evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 50, projectedCredits: 100,
      policy: { safety_gate_mode: 'enforce', safety_factor: 0.8 },
    });
    const first = call();
    for (let i = 0; i < 25; i++) expect(call()).toBe(first); // deterministic, no I/O
    expect(first).toBe('block');
  });

  test('mid-execution stability: a later policy change does not affect a decision already computed with an earlier policy', () => {
    const early = evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 90, projectedCredits: 100,
      policy: { safety_gate_mode: 'enforce', safety_factor: 0.8 }, // need 80 → pass
    });
    // "policy changed" afterwards (stricter) — does NOT retro-affect the prior decision
    const later = evaluateCreditSafetyGate({
      orgId: 'o', action: 'a', availableTotal: 90, projectedCredits: 100,
      policy: { safety_gate_mode: 'enforce', safety_factor: 1 }, // need 100 → block
    });
    expect(early).toBe('pass');
    expect(later).toBe('block');
    // Each call is independent & frozen to the policy passed at the (fresh-HOLD)
    // boundary; resumed/replayed HOLDs never reach this call site (Task 5H).
  });
});
