/**
 * WS-1c-3b (PMO-ADR-09) — TASK-PROFILE EXECUTION PATH.
 *
 * The ADDITIVE non-master branch of the ONE runtime. Selected by
 * generationRuntime.generate() when `selectTaskProfile(req)` returns a registered
 * key. It composes the SAME building blocks the master path uses, in a fixed,
 * observable order, but around a profile-specific output shape:
 *
 *   1. Context  → resolveContentContext (THE ONE canonical context read — reused)
 *   2. Policy   → profile.policy(ctx)   (family-faithful model/temp/operation)
 *   3. Prompt   → profile.buildMessages(ctx) (from canonical context, no bespoke dup)
 *   4. Generate → runCompletionWithOperation (THE ONE gateway — reused)
 *   5. Parse    → profile.parse(raw, ctx) (family output shape + validator)
 *
 * PERSISTENCE-FREE by contract: profiles converge families that persist THROUGH
 * THEIR OWN legacy path (e.g. the generate-day API route persists the returned
 * object), so the profile path never writes to the canonical content store —
 * exactly the no-double-persist guarantee. `contentId`/`originality` are null;
 * `variants` is empty (the family owns any repurposing). The profile output is
 * placed on `GenerationOutput.master` verbatim.
 *
 * FAIL-FAST like the master path's stages 1–4: a context/prompt/gateway/parse
 * failure surfaces to the caller (the delegating family wraps the runtime call in
 * try/catch and falls through to its legacy body — same pattern as #7/BOLT).
 */

import type { GenerationOutput, GenerationRequest } from './contracts';
import { getTaskProfile } from './taskProfiles/registry';
import type { TaskProfileContext } from './taskProfiles/types';
import { resolveContentContext } from '../../context/canonicalContentContextResolver';
import { runCompletionWithOperation } from '../../aiGateway';
import { startTimer } from '../../../observability/metrics';

/**
 * Execute a task profile end-to-end. `key` MUST be a registered profile (the
 * runtime only calls this after selectTaskProfile returned a non-null key).
 */
export async function generateWithTaskProfile(
  key: string,
  req: GenerationRequest,
): Promise<GenerationOutput> {
  const totalTimer = startTimer();
  const profile = getTaskProfile(key);
  if (!profile) {
    // Defensive: should be unreachable (selectTaskProfile validated membership).
    throw new Error(`[taskProfileRuntime] unknown task profile: ${String(key)}`);
  }

  // ── Stage 1 — Context Resolution (THE ONE canonical read, same as master).
  const norm = await resolveContentContext(req.companyId, {
    objective: req.objective ?? null,
  });
  const input = (req.taskProfileInput ?? {}) as Record<string, unknown>;
  const ctx: TaskProfileContext = { companyId: req.companyId, norm, req, input };

  // ── Stage 2 — Policy (family-faithful).
  const policy = profile.policy(ctx);

  // ── Stage 3 — Prompt Assembly (from canonical context; no bespoke dup).
  const { system, user } = profile.buildMessages(ctx);

  // ── Stage 4 — Generation (THE ONE gateway).
  const modelTimer = startTimer();
  const result = await runCompletionWithOperation({
    companyId: req.companyId || null,
    campaignId: req.campaignId ?? null,
    model: policy.model,
    temperature: policy.temperature,
    ...(policy.responseFormat ? { response_format: policy.responseFormat } : {}),
    operation: policy.operation,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const modelLatencyMs = modelTimer();

  // ── Stage 5 — Parse (family output shape + validator).
  const master = profile.parse(result.output ?? '', ctx);

  const latencyMs = totalTimer();
  return {
    master,
    variants: [],
    contentId: null,
    originality: null,
    metrics: {
      latencyMs,
      modelLatencyMs,
      taskProfile: key,
      model: policy.model,
      operation: policy.operation,
      stages: ['context', 'policy', 'prompt_assembly', 'generation', 'parse'],
      failures: [],
    },
  };
}
