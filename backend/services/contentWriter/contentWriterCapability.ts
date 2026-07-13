/**
 * contentWriterCapability.ts — the migrated workspace Content Writer (PMF-001 §4/§7).
 *
 * All inference for the workspace Content Writer now executes through AIC-001's
 * executeCapability. Knowledge comes from CKC-001 (via the capability's knowledge
 * stage), the prompt is the EXACT legacy prompt (injected assembler over the shared
 * workspaceContentPrompt source), and the model call is byte-identical to legacy
 * (injected model runner: gpt-4o-mini, temp 0.72, operation 'generatePlatformVariants').
 * The output parser reproduces the legacy JSON parsing, so the raw variants map is
 * equivalent. Post-processing (processContent) stays in the route for both paths.
 */

import { executeCapability } from '../aiCapability/aiCapabilityRuntime';
import type { CapabilityRequest, CapabilityResult } from '../aiCapability/capabilityContracts';
import type { ModelRunner } from '../aiCapability/capabilityModelRunner';
import type { CapabilityDefinition } from '../aiCapability/capabilityRegistry';
import type { KnowledgeContext } from '../knowledgeConsumption/knowledgeContextContracts';
import { recordRawCounter } from '../../observability';
import { knowledgeToBrandContext } from './contentWriterKnowledge';
import { WORKSPACE_SYSTEM_PROMPT, buildWorkspaceUserPrompt, buildContextLines } from './workspaceContentPrompt';

export interface WorkspaceWriteInput {
  companyId: string;
  userId?: string | null;
  topic: string;
  platforms: string[];
  contentTypes?: Record<string, string>;
  theme?: string;
  objective?: string;
  week?: string | number;
  now?: string;
  correlationId?: string;
}

export interface WorkspaceWriteResult {
  /** Raw platform→content map (pre-processContent), equivalent to legacy. */
  variants: Record<string, string>;
  status: CapabilityResult['status'];
  knowledgeVersion: number | null;
  confidence: number;
}

/** Injected prompt assembler — the EXACT legacy workspace prompt, from CKC knowledge. */
function promptAssembler(_def: CapabilityDefinition, request: CapabilityRequest, knowledge: KnowledgeContext | null) {
  const input = (request.input ?? {}) as unknown as WorkspaceWriteInput;
  const brandContext = knowledgeToBrandContext(knowledge);
  const contextLines = buildContextLines({ theme: input.theme, objective: input.objective, week: input.week });
  const user = buildWorkspaceUserPrompt({
    brandContext, contextLines, platforms: input.platforms ?? [], topic: input.topic ?? '', contentTypes: input.contentTypes,
  });
  return [
    { role: 'system' as const, content: WORKSPACE_SYSTEM_PROMPT },
    { role: 'user' as const, content: user },
  ];
}

/** Injected model runner — byte-identical to the legacy runCompletionWithOperation call. */
const modelRunner: ModelRunner = async (input) => {
  const { runCompletionWithOperation } = await import('../aiGateway');
  const resp = await runCompletionWithOperation({
    companyId: input.companyId,
    model: 'gpt-4o-mini',
    temperature: 0.72,
    response_format: { type: 'json_object' },
    messages: input.messages,
    operation: 'generatePlatformVariants',
  });
  const usage = resp.metadata?.token_usage ?? {};
  return {
    text: typeof resp.output === 'string' ? resp.output : JSON.stringify(resp.output ?? {}),
    tokens: { input: Number(usage.prompt_tokens ?? 0), output: Number(usage.completion_tokens ?? 0) },
    model: resp.metadata?.model ?? 'gpt-4o-mini',
    cacheUsed: Number(usage.total_tokens ?? 0) === 0,
  };
};

/** Injected output parser — reproduces the legacy JSON parse (fence-strip + lowercase keys). */
function outputParser(_def: CapabilityDefinition, text: string): unknown {
  const raw = (text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(raw); // throw → AIC recovery (same terminal error as legacy)
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * Generate the raw platform variants through the canonical AIC runtime. Throws on a
 * non-usable outcome (mirrors the legacy JSON.parse failure surfacing an error).
 */
export async function generateWorkspaceVariants(inp: WorkspaceWriteInput): Promise<WorkspaceWriteResult> {
  const request: CapabilityRequest = {
    capability: 'CONTENT_WRITER_WORKSPACE',
    companyId: inp.companyId,
    userId: inp.userId,
    input: { topic: inp.topic, platforms: inp.platforms, contentTypes: inp.contentTypes, theme: inp.theme, objective: inp.objective, week: inp.week },
    now: inp.now,
    correlationId: inp.correlationId,
  };
  const res = await executeCapability<Record<string, string>>(request, { promptAssembler, modelRunner, outputParser });
  if (res.status !== 'completed' && res.status !== 'partial') {
    throw new Error(res.error || 'content_writer_capability_failed');
  }
  return { variants: res.result ?? {}, status: res.status, knowledgeVersion: res.knowledgeVersion, confidence: res.confidence };
}

/** §10 — migration coverage / runtime-usage telemetry. Fail-safe. */
export function recordContentWriterRuntime(runtime: 'legacy' | 'platform', labels: Record<string, string> = {}): void {
  try {
    recordRawCounter('contentwriter.runtime_usage', 1, { runtime, ...labels });
    recordRawCounter('contentwriter.migration_coverage', runtime === 'platform' ? 1 : 0, {});
  } catch { /* fail-safe */ }
}

/** §11 — dual-run parity comparison (shadow). Deterministic; fail-safe. */
export function compareVariantParity(legacy: Record<string, string>, platform: Record<string, string>): { platformKeys: number; legacyKeys: number; sameKeys: boolean } {
  const lk = Object.keys(legacy).sort();
  const pk = Object.keys(platform).sort();
  return { platformKeys: pk.length, legacyKeys: lk.length, sameKeys: JSON.stringify(lk) === JSON.stringify(pk) };
}
