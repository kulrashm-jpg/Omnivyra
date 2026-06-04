/**
 * Phase 8D — admission control tests (9 validation cases + semantics + metrics).
 *
 * getWalletSnapshot is mocked so we drive exact wallet states; economics come
 * from the REAL Phase 8A catalog. content_basic → SHORT_GENERATION (max 15).
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const priority = { getWalletSnapshot: jest.fn() };
jest.mock('../../services/creditPriorityService', () => priority);

// Phase 11D — the boundary fire-and-forgets a durable observation; stub it so the
// suite stays hermetic and we can assert the observation payload.
const obs = { recordAdmissionObservation: jest.fn(async () => {}) };
jest.mock('../../services/billing/creditEconomyObservability', () => obs);

import {
  canStartActivity,
  assertCanStartActivity,
  isAdmissionControlEnabled,
  resolveAdmissionMode,
  evaluateActivityAdmission,
  AdmissionBlockedError,
} from '../../services/billing/admissionControl';

/** Flush the fire-and-forget dynamic-import observation chain. */
const flush = () => new Promise<void>((r) => setImmediate(r));
import { resolveActivityEconomics } from '../../services/activityEconomyCatalog';
import { getCounter, _resetBillingMetricsForTests } from '../../services/billing/billingMetrics';

const ORG = 'org-1';
const ACTION = 'content_basic'; // SHORT_GENERATION → max 15
const MAX = resolveActivityEconomics(ACTION).maximumCredits; // 15

function wallet(free: number, paid = 0, incentive = 0, rFree = 0, rPaid = 0, rInc = 0) {
  return {
    free_balance: free, paid_balance: paid, incentive_balance: incentive,
    reserved_free: rFree, reserved_paid: rPaid, reserved_incentive: rInc,
  };
}

const FLAG = 'PHASE2_ADMISSION_CONTROL';
const ENGINE_FLAG = 'PHASE2_ENTRY_CONSUMPTION';

beforeEach(() => {
  jest.clearAllMocks();
  _resetBillingMetricsForTests();
  delete process.env[FLAG];
  delete process.env[ENGINE_FLAG];
});
afterAll(() => { delete process.env[FLAG]; delete process.env[ENGINE_FLAG]; });

describe('canStartActivity — 9 validation cases', () => {
  it('1. exact maximum available → allowed', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(MAX));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d).toMatchObject({ allowed: true, reason: 'ok', effectiveCredits: 15, requiredCredits: 15, shortfall: 0 });
  });

  it('2. above maximum → allowed', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d.allowed).toBe(true);
    expect(d.effectiveCredits).toBe(100);
  });

  it('3. below maximum → blocked with shortfall', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(10));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d).toMatchObject({ allowed: false, reason: 'insufficient_credits', effectiveCredits: 10, requiredCredits: 15, shortfall: 5 });
  });

  it('4. existing active reservations reduce effective → blocked', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(20, 0, 0, 10)); // 20 balance, 10 reserved
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d).toMatchObject({ availableCredits: 20, activeReservations: 10, effectiveCredits: 10, allowed: false, shortfall: 5 });
  });

  it('5. multiple concurrent activities (reservations consume capacity) → blocked', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(30, 0, 0, 30)); // fully reserved in-flight
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d).toMatchObject({ effectiveCredits: 0, allowed: false, shortfall: 15 });
  });

  it('6. entry-consumption engine → same verdict (engine-agnostic)', async () => {
    process.env[ENGINE_FLAG] = 'true';
    priority.getWalletSnapshot.mockResolvedValue(wallet(MAX));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d.allowed).toBe(true);
    expect(d.requiredCredits).toBe(MAX);
  });

  it('7. legacy HOLD(MAX) engine → identical verdict', async () => {
    delete process.env[ENGINE_FLAG];
    priority.getWalletSnapshot.mockResolvedValue(wallet(MAX));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d.allowed).toBe(true);
    expect(d.requiredCredits).toBe(MAX);
  });

  it('8. replay requests are identical and side-effect-free (read-only)', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(10));
    const a = await canStartActivity({ organizationId: ORG, activity: ACTION });
    const b = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(a).toEqual(b);
    // only the read was performed; no mutating wallet call exists on the mock
    expect(priority.getWalletSnapshot).toHaveBeenCalledTimes(2);
    expect(Object.keys(priority)).toEqual(['getWalletSnapshot']);
  });

  it('9a. zero-credit org → blocked insufficient_credits', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(0));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d).toMatchObject({ allowed: false, reason: 'insufficient_credits', effectiveCredits: 0, shortfall: 15 });
  });

  it('9b. no wallet row → no_credit_account', async () => {
    priority.getWalletSnapshot.mockResolvedValue(null);
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d).toMatchObject({ allowed: false, reason: 'no_credit_account', requiredCredits: 15, shortfall: 15 });
  });
});

describe('integration with resolveActivityEconomics (TASK 2)', () => {
  it('requiredCredits equals the catalog maximumCredits', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(1000));
    const d = await canStartActivity({ organizationId: ORG, activity: 'campaign_generation' }); // AUTOMATION max 120
    expect(d.requiredCredits).toBe(resolveActivityEconomics('campaign_generation').maximumCredits);
    expect(d.requiredCredits).toBe(120);
  });

  it('unknown activity → unknown_activity, blocked', async () => {
    const d = await canStartActivity({ organizationId: ORG, activity: 'not_real' });
    expect(d).toMatchObject({ allowed: false, reason: 'unknown_activity', requiredCredits: 0 });
  });
});

describe('failure semantics (TASK 4)', () => {
  it('blocked decision carries requiredCredits, effectiveCredits, shortfall', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(4));
    const d = await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d.reason).toBe('insufficient_credits');
    expect(d.requiredCredits).toBe(15);
    expect(d.effectiveCredits).toBe(4);
    expect(d.shortfall).toBe(11);
  });
});

describe('observability (TASK 5) — no mutation', () => {
  it('emits admission_allowed on allow', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(getCounter('admission_allowed')).toBe(1);
    expect(getCounter('admission_blocked')).toBe(0);
  });

  it('emits admission_blocked + admission_shortfall(byAmount) on block', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(5));
    await canStartActivity({ organizationId: ORG, activity: ACTION });
    expect(getCounter('admission_blocked')).toBe(1);
    expect(getCounter('admission_shortfall')).toBe(10); // shortfall = 15 - 5
  });
});

describe('dark rollout (TASK 6)', () => {
  it('flag default OFF', () => {
    expect(isAdmissionControlEnabled()).toBe(false);
  });

  it('OFF + blocked → assertCanStartActivity does NOT throw (behavior unchanged)', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(1));
    const d = await assertCanStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d.allowed).toBe(false); // honest verdict returned, not enforced
  });

  it('ON + blocked → assertCanStartActivity throws AdmissionBlockedError', async () => {
    process.env[FLAG] = 'true';
    priority.getWalletSnapshot.mockResolvedValue(wallet(1));
    await expect(assertCanStartActivity({ organizationId: ORG, activity: ACTION }))
      .rejects.toBeInstanceOf(AdmissionBlockedError);
  });

  it('ON + allowed → assertCanStartActivity returns decision', async () => {
    process.env[FLAG] = 'true';
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    const d = await assertCanStartActivity({ organizationId: ORG, activity: ACTION });
    expect(d.allowed).toBe(true);
  });
});

describe('evaluateActivityAdmission (Phase 11D — single boundary)', () => {
  it('resolveAdmissionMode: unset→off, true/enforce→enforce, shadow→shadow', () => {
    delete process.env[FLAG];        expect(resolveAdmissionMode()).toBe('off');
    process.env[FLAG] = 'true';      expect(resolveAdmissionMode()).toBe('enforce');
    process.env[FLAG] = 'enforce';   expect(resolveAdmissionMode()).toBe('enforce');
    process.env[FLAG] = 'shadow';    expect(resolveAdmissionMode()).toBe('shadow');
  });

  it('mode OFF (default) → passthrough: NO wallet read, NO observation, never blocks', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(0));
    const r = await evaluateActivityAdmission({ organizationId: ORG, activity: ACTION });
    await flush();
    expect(r).toMatchObject({ mode: 'off', evaluated: false, allowed: true });
    expect(priority.getWalletSnapshot).not.toHaveBeenCalled();
    expect(obs.recordAdmissionObservation).not.toHaveBeenCalled();
  });

  it('mode SHADOW + blocked → evaluates + durably observes, NEVER throws', async () => {
    process.env[FLAG] = 'shadow';
    priority.getWalletSnapshot.mockResolvedValue(wallet(5)); // required 15 → shortfall 10
    const r = await evaluateActivityAdmission({ organizationId: ORG, activity: ACTION, referenceId: 'ref1' });
    await flush();
    expect(r).toMatchObject({ mode: 'shadow', evaluated: true, allowed: false });
    expect(priority.getWalletSnapshot).toHaveBeenCalledTimes(1);
    expect(obs.recordAdmissionObservation).toHaveBeenCalledWith(
      expect.objectContaining({ activity: ACTION, allowed: false, requiredCredits: 15, effectiveCredits: 5, shortfall: 10 }),
    );
  });

  it('mode ENFORCE + blocked → throws AdmissionBlockedError (and still observes)', async () => {
    process.env[FLAG] = 'enforce';
    priority.getWalletSnapshot.mockResolvedValue(wallet(1));
    await expect(evaluateActivityAdmission({ organizationId: ORG, activity: ACTION }))
      .rejects.toBeInstanceOf(AdmissionBlockedError);
    await flush();
    expect(obs.recordAdmissionObservation).toHaveBeenCalled();
  });

  it('mode ENFORCE + allowed → returns decision, no throw', async () => {
    process.env[FLAG] = 'enforce';
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    const r = await evaluateActivityAdmission({ organizationId: ORG, activity: ACTION });
    expect(r).toMatchObject({ mode: 'enforce', evaluated: true, allowed: true });
  });

  it('uncatalogued activity → skipped (never a false block) even in enforce', async () => {
    process.env[FLAG] = 'enforce';
    const r = await evaluateActivityAdmission({ organizationId: ORG, activity: 'not_real' });
    await flush();
    expect(r).toMatchObject({ evaluated: false, allowed: true });
    expect(priority.getWalletSnapshot).not.toHaveBeenCalled();
    expect(obs.recordAdmissionObservation).not.toHaveBeenCalled();
  });

  it('evaluation failure (wallet read throws) → never blocks', async () => {
    process.env[FLAG] = 'enforce';
    priority.getWalletSnapshot.mockRejectedValue(new Error('db down'));
    const r = await evaluateActivityAdmission({ organizationId: ORG, activity: ACTION });
    expect(r).toMatchObject({ evaluated: false, allowed: true });
  });
});
