/**
 * RF-3A — twin grounding execution (Run A legacy / Run B canonical).
 *
 * Reuses the REAL production grounding transforms (assimilateContext /
 * overlayCanonicalOntoProfile / toBriefGrounding), the Foundation F-12 cache
 * (cold/warm via request-memo), and Foundation F-03 request context — no
 * duplicate infrastructure. The AI step is behind a pluggable runner whose
 * DEFAULT is offline (no live provider call, no production execution).
 */
import { assimilateContext } from '../../services/context/contextAssimilationEngine';
import { overlayCanonicalOntoProfile } from '../../services/context/canonicalProfileOverlay';
import { toBriefGrounding } from '../../services/context/canonicalContextAdapters';
import { registerCacheNamespace } from '../../../lib/platform/cacheCore';
import { createCache } from '../../../lib/platform/cacheClient';
import type { CanonicalContext } from '../../services/context/canonicalContextTypes';
import { projectPrompt } from './workloads';
import type { AiRunResult, AiRunner, DatasetEntry, ExecutionParams, RunCapture, WorkloadDef } from './types';

// Reuse of the F-12 SDK (a dedicated EVAL namespace — not a duplicated cache).
const EVAL_NS = registerCacheNamespace({
  prefix: 'omnivyra:eval_canonical_ctx',
  description: 'RF-3A offline equivalence harness — canonical context (eval only)',
  version: 1,
  defaultTtlSeconds: 300,
  requireTenant: true,
});
const evalCtxCache = createCache(EVAL_NS);

// Overlay-relevant grounding keys (matches canonicalProfileOverlay's write set).
const OVERLAY_KEYS = [
  'products_services', 'products_services_list', 'unique_value', 'competitive_advantages',
  'ideal_customer_profile', 'target_audience', 'target_audience_list', 'pain_symptoms',
  'industry', 'brand_positioning', 'brand_voice', 'content_themes', 'content_themes_list',
  'growth_priorities',
];

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function estTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / Math.max(1, charsPerToken));
}

/** DEFAULT runner — OFFLINE. Estimates tokens from prompt size; NEVER calls a
 *  provider. Deterministic (no clock/RNG). Operators inject a live runner to add
 *  real AI-output evidence; the harness itself performs no production execution. */
export const offlineAiRunner: AiRunner = async (prompt, params): Promise<AiRunResult> => ({
  text: null,
  tokensIn: estTokens(prompt, params.charsPerToken),
  tokensOut: 0,
  latencyMs: 0,
  retries: 0,
  error: null,
});

function completeness(fields: string[], grounding: Record<string, unknown>): number {
  if (fields.length === 0) return 1;
  const present = fields.filter((f) => !isEmpty(grounding[f])).length;
  return present / fields.length;
}

function contextHasFacts(ctx: CanonicalContext): boolean {
  return !!(ctx.offerings || ctx.differentiators || ctx.icp || ctx.industry || ctx.brandPositioning || ctx.personas || ctx.painPoints);
}

/** Assemble canonical context through the F-12 cache; report cold/warm hits. */
async function assembleCached(entry: DatasetEntry): Promise<{ ctx: CanonicalContext; assemblyMs: number; coldHit: boolean; warmHit: boolean }> {
  let loaderCalls = 0;
  const load = async () =>
    assimilateContext(entry.id, {
      loadProfile: async () => entry.profile,
      loadRecentContent: async () => entry.recentContent,
      now: entry.now,
    });
  const t0 = Date.now();
  const ctx = (await evalCtxCache.getOrLoad<CanonicalContext>({
    tenantId: entry.id, parts: ['ctx'], load: async () => { loaderCalls++; return load(); },
  }))!;
  const assemblyMs = Date.now() - t0;
  const coldHit = loaderCalls === 0; // expected false on a cold key
  const before = loaderCalls;
  await evalCtxCache.getOrLoad<CanonicalContext>({
    tenantId: entry.id, parts: ['ctx'], load: async () => { loaderCalls++; return load(); },
  });
  const warmHit = loaderCalls === before; // expected true (request-memo / Redis)
  return { ctx, assemblyMs, coldHit, warmHit };
}

/** Run one arm end-to-end for a (workload, entry). No production side effects. */
export async function executeArm(
  workload: WorkloadDef,
  entry: DatasetEntry,
  arm: 'legacy' | 'canonical',
  aiRunner: AiRunner,
  params: ExecutionParams,
): Promise<RunCapture> {
  const gStart = Date.now();
  let grounding: Record<string, unknown> = { ...entry.profile };
  let assemblyLatencyMs = 0;
  let coldHit = false, warmHit = false, contextAvailable = false;
  let overwriteCount = 0, backfillCount = 0;
  let additiveBlock: string | undefined;

  if (arm === 'canonical') {
    const asm = await assembleCached(entry);
    assemblyLatencyMs = asm.assemblyMs;
    coldHit = asm.coldHit; warmHit = asm.warmHit;
    contextAvailable = contextHasFacts(asm.ctx);
    if (workload.additive) {
      // Additive consumer: profile unchanged; canonical adds a facts block.
      additiveBlock = toBriefGrounding(asm.ctx).text;
    } else {
      const overlaid = overlayCanonicalOntoProfile({ ...entry.profile }, asm.ctx);
      for (const k of OVERLAY_KEYS) {
        const before = entry.profile[k];
        const after = (overlaid as Record<string, unknown>)[k];
        if (isEmpty(before) && !isEmpty(after)) backfillCount++;
        else if (!isEmpty(before) && JSON.stringify(before) !== JSON.stringify(after)) overwriteCount++;
      }
      grounding = overlaid as Record<string, unknown>;
    }
  }

  const groundingLatencyMs = Date.now() - gStart;
  const fallbackUsed = arm === 'canonical' && backfillCount === 0 && overwriteCount === 0 && !additiveBlock;
  const prompt = projectPrompt(workload, grounding, additiveBlock);

  const eStart = Date.now();
  const ai = await aiRunner(prompt, params);
  const executionLatencyMs = Date.now() - eStart;

  const estCostUsd = ((ai.tokensIn + ai.tokensOut) / 1000) * params.costPer1kTokens;

  return {
    arm,
    grounding,
    prompt,
    promptChars: prompt.length,
    groundingLatencyMs,
    assemblyLatencyMs,
    executionLatencyMs,
    cacheColdHit: coldHit,
    cacheWarmHit: warmHit,
    fallbackUsed,
    contextAvailable: arm === 'legacy' ? true : contextAvailable,
    overwriteCount,
    backfillCount,
    contextCompleteness: completeness(workload.fields, grounding),
    tokensIn: ai.tokensIn,
    tokensOut: ai.tokensOut,
    estCostUsd,
    error: ai.error,
    retryCount: ai.retries,
  };
}
