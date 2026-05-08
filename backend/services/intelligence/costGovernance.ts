// Provider cost governance.
//
// Tracks per-provider token usage, request counts, cache-hit ratio, and
// estimated cost. Enforces per-scan budgets so a runaway report cannot blow
// through credits.
//
// Honest defaults: cost-per-request is a published list price for the public
// providers; when a provider's cost is unknown, we report `null` rather than
// guess — the Phase 5 "no fabrication" rule applies to billing too.

export type ProviderId = string;

export type ProviderUsageEvent = {
  provider_id: ProviderId;
  operation: string;
  request_count?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_hit?: boolean;
  cost_usd?: number | null; // null when the provider's pricing cannot be derived
  observed_at: string;
};

// ── Per-scan budget tracker ───────────────────────────────────────────────────

export type ScanBudget = {
  scan_id: string;
  max_requests: number;
  max_cost_usd: number;
};

type ScanLedgerEntry = {
  scan_id: string;
  budget: ScanBudget;
  events: ProviderUsageEvent[];
};

const ledger = new Map<string, ScanLedgerEntry>();

export function startScanBudget(budget: ScanBudget): void {
  ledger.set(budget.scan_id, { scan_id: budget.scan_id, budget, events: [] });
}

export function endScanBudget(scan_id: string): ScanLedgerSummary | null {
  const entry = ledger.get(scan_id);
  if (!entry) return null;
  ledger.delete(scan_id);
  return summarizeLedger(entry);
}

export function recordUsage(scan_id: string, event: ProviderUsageEvent): {
  recorded: boolean;
  reason?: string;
} {
  const entry = ledger.get(scan_id);
  if (!entry) {
    // Untracked scan — record nothing but don't error.
    return { recorded: false, reason: 'no_active_budget' };
  }
  entry.events.push(event);
  return { recorded: true };
}

/**
 * Returns true if calling the provider with the predicted cost would breach
 * the scan's budget. Callers must surface `unavailable` (reason='budget_exceeded:<scan_id>')
 * when this returns true.
 */
export function withinBudget(scan_id: string, predicted: { cost_usd?: number | null; requests?: number }): {
  ok: boolean;
  reason: string | null;
} {
  const entry = ledger.get(scan_id);
  if (!entry) return { ok: true, reason: null };
  const summary = summarizeLedger(entry);
  const newRequests = (summary.totals.requests ?? 0) + (predicted.requests ?? 1);
  if (newRequests > entry.budget.max_requests) {
    return { ok: false, reason: `budget_exceeded:requests:${entry.budget.max_requests}` };
  }
  const predictedCost = predicted.cost_usd ?? 0;
  const newCost = (summary.totals.cost_usd ?? 0) + predictedCost;
  if (newCost > entry.budget.max_cost_usd) {
    return { ok: false, reason: `budget_exceeded:cost:${entry.budget.max_cost_usd.toFixed(2)}usd` };
  }
  return { ok: true, reason: null };
}

// ── Public pricing table for the LLM providers we ship ────────────────────────
//
// Per-million-token list prices (USD). When a provider's pricing tier cannot
// be derived from the response, the per-call cost is `null` and the budget
// tracker only counts requests.

export const PROVIDER_PRICING: Record<string, { per_1m_input_usd: number; per_1m_output_usd: number }> = {
  // OpenAI (gpt-4o-mini default; configurable via env)
  chatgpt: { per_1m_input_usd: 0.15, per_1m_output_usd: 0.6 },
  // Anthropic Claude Haiku 4.5
  claude: { per_1m_input_usd: 0.8, per_1m_output_usd: 4.0 },
  // Google Gemini Flash
  gemini: { per_1m_input_usd: 0.075, per_1m_output_usd: 0.3 },
  // Perplexity Sonar
  perplexity: { per_1m_input_usd: 1.0, per_1m_output_usd: 1.0 },
  // Azure-hosted Copilot (varies by deployment; default to gpt-4o-mini parity)
  copilot: { per_1m_input_usd: 0.15, per_1m_output_usd: 0.6 },
};

export function estimateCost(params: {
  providerId: string;
  promptTokens: number;
  completionTokens: number;
}): number | null {
  const pricing = PROVIDER_PRICING[params.providerId];
  if (!pricing) return null;
  return (
    (params.promptTokens / 1_000_000) * pricing.per_1m_input_usd +
    (params.completionTokens / 1_000_000) * pricing.per_1m_output_usd
  );
}

// ── Ledger summary ────────────────────────────────────────────────────────────

export type ScanLedgerSummary = {
  scan_id: string;
  totals: {
    requests: number;
    cache_hits: number;
    cache_misses: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    cost_known_count: number;
    cost_unknown_count: number;
  };
  per_provider: Record<
    string,
    {
      requests: number;
      cache_hits: number;
      cache_misses: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost_usd: number;
      cost_known_count: number;
      cost_unknown_count: number;
      cache_hit_ratio: number;
    }
  >;
  budget: ScanBudget;
};

function summarizeLedger(entry: ScanLedgerEntry): ScanLedgerSummary {
  const totals: ScanLedgerSummary['totals'] = {
    requests: 0,
    cache_hits: 0,
    cache_misses: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0,
    cost_known_count: 0,
    cost_unknown_count: 0,
  };
  const perProvider: ScanLedgerSummary['per_provider'] = {};

  for (const ev of entry.events) {
    const requests = ev.request_count ?? 1;
    const prompt = ev.prompt_tokens ?? 0;
    const completion = ev.completion_tokens ?? 0;
    const cost = ev.cost_usd ?? null;

    totals.requests += requests;
    if (ev.cache_hit) totals.cache_hits += 1;
    else totals.cache_misses += 1;
    totals.prompt_tokens += prompt;
    totals.completion_tokens += completion;
    if (cost != null) {
      totals.cost_usd += cost;
      totals.cost_known_count += 1;
    } else {
      totals.cost_unknown_count += 1;
    }

    const slot =
      perProvider[ev.provider_id] ??
      (perProvider[ev.provider_id] = {
        requests: 0,
        cache_hits: 0,
        cache_misses: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        cost_known_count: 0,
        cost_unknown_count: 0,
        cache_hit_ratio: 0,
      });
    slot.requests += requests;
    if (ev.cache_hit) slot.cache_hits += 1;
    else slot.cache_misses += 1;
    slot.prompt_tokens += prompt;
    slot.completion_tokens += completion;
    if (cost != null) {
      slot.cost_usd += cost;
      slot.cost_known_count += 1;
    } else {
      slot.cost_unknown_count += 1;
    }
    const total = slot.cache_hits + slot.cache_misses;
    slot.cache_hit_ratio = total === 0 ? 0 : Number((slot.cache_hits / total).toFixed(3));
  }

  return { scan_id: entry.scan_id, totals, per_provider: perProvider, budget: entry.budget };
}

/** Test helper. */
export function _resetCostLedger(): void {
  ledger.clear();
}
