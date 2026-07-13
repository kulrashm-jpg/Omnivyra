/**
 * capabilityTools.ts — canonical tool orchestration (AIC-001 §5).
 *
 * ONE orchestration layer for capability tools: parallel, sequential, conditional,
 * with fallback, retry, timeout, and idempotency. Tools themselves are the EXISTING
 * services (website snapshot, competitor lookup, …) wrapped as ToolSpecs — this
 * duplicates no service logic, only the way they are composed. Deterministic given
 * deterministic tool runners.
 */

import type { CapabilitySource, ToolCallSummary, ToolSummary } from './capabilityContracts';

export interface ToolContext {
  companyId: string;
  input: Record<string, unknown>;
  /** Results of already-run tools in this execution (idempotency memo). */
  memo: Record<string, ToolResult>;
  now: string;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  sources?: CapabilitySource[];
  error?: string | null;
}

export interface ToolSpec {
  id: string;
  run: (ctx: ToolContext) => Promise<ToolResult>;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Fallback tool spec run when this one fails after all attempts. */
  fallback?: ToolSpec;
  /** Only run when this predicate holds (conditional tools). */
  when?: (ctx: ToolContext) => boolean;
  /** Deterministic idempotency key; identical key → memoized result. */
  idempotencyKey?: (ctx: ToolContext) => string;
}

export type ToolRegistry = Record<string, ToolSpec>;

interface RanTool {
  summary: ToolCallSummary;
  result: ToolResult | null;
  sources: CapabilitySource[];
}

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 30_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('tool_timeout')), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run one tool with retry → fallback → timeout. Deterministic attempt count. Never throws. */
async function runOne(spec: ToolSpec, ctx: ToolContext, clockMs: () => number): Promise<RanTool> {
  // Idempotency: identical key already computed → memoized.
  const key = spec.idempotencyKey ? spec.idempotencyKey(ctx) : spec.id;
  const memoized = ctx.memo[key];
  if (memoized) {
    return { summary: { tool: spec.id, ok: memoized.ok, ms: 0, attempts: 0, fallbackUsed: false, error: memoized.error ?? null }, result: memoized, sources: memoized.sources ?? [] };
  }

  const start = clockMs();
  const maxAttempts = Math.max(1, spec.maxAttempts ?? DEFAULT_ATTEMPTS);
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempts = 0;
  let lastError: string | null = null;
  let result: ToolResult | null = null;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const r = await withTimeout(spec.run(ctx), timeoutMs);
      if (r.ok) { result = r; break; }
      lastError = r.error ?? 'tool_not_ok';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  let fallbackUsed = false;
  if (!result && spec.fallback) {
    fallbackUsed = true;
    const fb = await runOne(spec.fallback, ctx, clockMs);
    result = fb.result;
    if (result) lastError = null; else lastError = lastError ?? fb.summary.error ?? 'fallback_failed';
  }

  const ms = Math.max(0, clockMs() - start);
  const ok = !!result?.ok;
  const finalResult: ToolResult = result ?? { ok: false, output: null, error: lastError };
  ctx.memo[key] = finalResult;
  return {
    summary: { tool: spec.id, ok, ms, attempts, fallbackUsed, error: ok ? null : lastError },
    result: finalResult,
    sources: finalResult.sources ?? [],
  };
}

export interface ToolPlanItem {
  spec: ToolSpec;
  mode: 'parallel' | 'sequential';
}

export interface ToolOrchestrationResult {
  summary: ToolSummary;
  sources: CapabilitySource[];
  outputs: Record<string, unknown>;
}

/**
 * Orchestrate a capability's tools. Parallel items run concurrently; sequential
 * items run in order (and may read the memo of earlier tools). Conditional tools
 * (spec.when=false) are skipped. Deterministic given deterministic tools + clock.
 */
export async function orchestrateTools(
  items: ToolPlanItem[],
  ctx: ToolContext,
  clockMs: () => number = () => 0,
): Promise<ToolOrchestrationResult> {
  const eligible = items.filter((it) => !it.spec.when || it.spec.when(ctx));
  const parallel = eligible.filter((it) => it.mode === 'parallel');
  const sequential = eligible.filter((it) => it.mode === 'sequential');

  const ran: RanTool[] = [];
  // Parallel batch first (barrier), then sequential (order-preserving).
  const parResults = await Promise.all(parallel.map((it) => runOne(it.spec, ctx, clockMs)));
  ran.push(...parResults);
  for (const it of sequential) ran.push(await runOne(it.spec, ctx, clockMs));

  // Deterministic ordering of the summary: by tool id.
  ran.sort((a, b) => a.summary.tool.localeCompare(b.summary.tool));

  const calls = ran.map((r) => r.summary);
  const sources = ran.flatMap((r) => r.sources);
  const outputs: Record<string, unknown> = {};
  for (const r of ran) outputs[r.summary.tool] = r.result?.output ?? null;

  return {
    summary: {
      calls,
      totalMs: calls.reduce((s, c) => s + c.ms, 0),
      okCount: calls.filter((c) => c.ok).length,
      failedCount: calls.filter((c) => !c.ok).length,
    },
    sources,
    outputs,
  };
}

/** Build a tool plan from a capability's tool ids + a registry. Unknown ids are skipped. */
export function buildToolPlan(toolIds: string[], registry: ToolRegistry): ToolPlanItem[] {
  return toolIds
    .map((id) => registry[id])
    .filter((s): s is ToolSpec => !!s)
    .map((spec) => ({ spec, mode: 'parallel' as const }));
}

export const EMPTY_TOOL_SUMMARY: ToolSummary = { calls: [], totalMs: 0, okCount: 0, failedCount: 0 };
