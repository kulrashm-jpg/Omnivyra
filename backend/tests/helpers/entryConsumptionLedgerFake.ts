/**
 * Shared ledger fake for tests that run the REAL executeWithEntryConsumption engine (gate, stage keys, deferred
 * entry, settle plan, underfunded). Only the reservation primitives, the ledger lookups, the wallet and token pricing
 * are faked; one in-memory ledger backs them all. Use from jest.mock factories, e.g.
 *   jest.mock('../../repositories/creditExecutionRepository', () => require('../helpers/entryConsumptionLedgerFake').repositoryModule());
 */
export type Phase = 'hold' | 'confirm' | 'release';

export const state = {
  ledger: new Map<string, Phase>(),
  holdAmount: new Map<string, number>(),
  charged: [] as Array<{ key: string; credits: number }>,
  wallet: { balance: 0 },
  gateMode: 'enforce' as 'enforce' | 'off' | 'shadow',
};

export function reset(balance = 1000): void {
  state.ledger.clear();
  state.holdAmount.clear();
  state.charged.length = 0;
  state.wallet.balance = balance;
  state.gateMode = 'enforce';
}

export const totalCharged = (): number => state.charged.reduce((a, c) => a + c.credits, 0);
/** 1 credit per 100 tokens - tests compare only against this same function. */
export const creditsFor = (tokens: number): number => Math.ceil(tokens / 100);

export function repositoryModule() {
  return {
    findCreditTransaction: async (key: string) => (state.ledger.has(key) ? { id: key, execution_phase: state.ledger.get(key) } : null),
    callCreditPartialConfirm: async (cmd: any) => {
      const held = state.holdAmount.get(cmd.holdTxnId) ?? 0;
      const consumed = Math.min(held, Object.values(cmd.actualSplit as Record<string, number>).reduce((a, b) => a + b, 0));
      state.ledger.set(cmd.idempotencyKey, 'confirm');
      state.wallet.balance += held - consumed;
      state.charged.push({ key: cmd.idempotencyKey, credits: consumed });
      return { error: null, data: { id: cmd.idempotencyKey, total_consumed: consumed, total_released: held - consumed } };
    },
    callCreditReservation: async () => ({ error: null, transactionId: 'x' }),
    loadCreditHoldSplit: async () => ({ free: 0, incentive: 0, paid: 0 }),
  };
}

export function contractsModule() {
  const actual = jest.requireActual('../../services/creditExecutionServiceContracts');
  const handle = (x: any, holdKey: string) => ({
    orgId: x.orgId, userId: x.userId, action: x.action, referenceType: x.referenceType, referenceId: x.referenceId,
    idempotencyKey: x.idempotencyKey, holdTransactionId: holdKey, creditsReserved: x.amountOverride,
    split: { free: 0, incentive: 0, paid: x.amountOverride },
  });
  return {
    ...actual,
    fireAlerts: () => undefined,
    reserveCreditsForWork: async (o: any) => {
      const { confirmKey, releaseKey, holdKey } = actual.getReservationKeys(o.idempotencyKey);
      if (state.ledger.has(confirmKey)) return { status: 'already_confirmed' };
      if (state.ledger.has(releaseKey)) return { status: 'already_released' };
      if (state.ledger.has(holdKey)) return { status: 'already_reserved', ...handle(o, holdKey) };
      if (state.wallet.balance < o.amountOverride) return { status: 'insufficient_credits', available: state.wallet.balance, required: o.amountOverride };
      state.ledger.set(holdKey, 'hold');
      state.wallet.balance -= o.amountOverride;
      state.holdAmount.set(holdKey, o.amountOverride);
      return { status: 'reserved', ...handle(o, holdKey) };
    },
    confirmCreditReservation: async (h: any) => {
      const { confirmKey } = actual.getReservationKeys(h.idempotencyKey);
      state.ledger.set(confirmKey, 'confirm');
      state.charged.push({ key: confirmKey, credits: h.creditsReserved });
      return { status: 'confirmed' };
    },
    releaseCreditReservation: async (h: any) => {
      const { releaseKey } = actual.getReservationKeys(h.idempotencyKey);
      if (!state.ledger.has(releaseKey)) { state.ledger.set(releaseKey, 'release'); state.wallet.balance += h.creditsReserved; }
      return { status: 'released' };
    },
  };
}

/** The remaining engine dependencies (writers / unrelated readers), as no-ops. */
export const engineStubs = {
  priority: () => ({ getTotalAvailable: async () => state.wallet.balance, resolveDeduction: async () => ({ wallet: null, available: null, split: null }) }),
  pricing: (recordCostAnomaly: (...a: unknown[]) => void) => ({
    resolveLlmCost: async (i: any) => ({ credits: creditsFor(i.inputTokens + i.outputTokens), total_cost_usd: 0, final_price_usd: 0 }),
    estimateLlmHoldCredits: async () => ({ credits: 0 }),
    recordCostAnomaly,
  }),
  executionService: () => ({
    isEntryConsumptionEnabled: () => String(process.env.PHASE2_ENTRY_CONSUMPTION ?? '').toLowerCase() === 'true',
    makeIdempotencyKey: (...a: any[]) => jest.requireActual('../../services/creditExecutionServiceContracts').makeIdempotencyKey(...a),
  }),
  gate: () => ({ resolveEnforcementMode: async () => ({ mode: state.gateMode }) }),
};
