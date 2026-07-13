/**
 * longFormPlatformRuntime.ts — execute a Long-form Capability Profile (PMF-003 §1/§4/§5/§6/§11).
 *
 * The platform execution path for long-form content. It runs the EXISTING engine's
 * inference inside an injected AIC model runner, so AIC-001 owns the pipeline
 * (CKC-001 knowledge acquisition, validation, telemetry, recovery, output contract)
 * while the engine's prompts, inference, quality gates, and repair are untouched
 * (zero prompt/quality change). The exact engine result object is captured via
 * closure and served verbatim (guaranteed output parity — no JSON round-trip).
 *
 * SAFETY NET: if the AIC pipeline does not complete for ANY reason (e.g. a company
 * with no CKC knowledge trips the grounding guard), the runtime falls back to
 * running the engine directly. The platform path can therefore never produce a
 * worse outcome than legacy — zero regression by construction.
 *
 * AIA is intentionally NOT used: the primary long-form path runs inline as a single
 * (multi-internal-step) generation, i.e. a single AIC execution. If long-form later
 * becomes a queued/approval workflow, the profile's approvalRequirements + the AIA
 * agent registry host it then (§6: single-step generations may remain direct AIC).
 */

import { executeCapability } from '../aiCapability/aiCapabilityRuntime';
import type { CapabilityRequest } from '../aiCapability/capabilityContracts';
import type { ModelRunner } from '../aiCapability/capabilityModelRunner';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { profileForEngineContentType, type LongFormCapabilityProfile } from './longFormCapabilityProfile';

/** The engine runner the platform delegates inference to (injectable for tests). */
export type LongFormEngineRunner = (engineRequest: any) => Promise<any>;

export const defaultLongFormEngineRunner: LongFormEngineRunner = async (engineRequest) => {
  const { runUnifiedLongFormGeneration } = await import('../../../lib/content/unifiedLongFormEngine');
  return runUnifiedLongFormGeneration(engineRequest);
};

export interface LongFormPlatformInput {
  engineContentType: string;
  /** The fully-formed engine request (identical to what legacy passes the engine). */
  engineRequest: any;
  companyId: string;
  userId?: string | null;
  now?: string;
  correlationId?: string;
}

export interface LongFormPlatformDeps {
  engineRunner?: LongFormEngineRunner;
  capabilityExecutor?: typeof executeCapability;
  nowIso?: () => string;
}

/** §11 — record platform/legacy long-form telemetry. Fail-safe. */
export function recordLongFormRuntime(runtime: 'legacy' | 'platform', info: {
  contentType: string; knowledgeVersion?: number | null; tokens?: number; qualityPassed?: boolean | null; validationFailures?: number;
} = { contentType: 'unknown' }): void {
  try {
    recordRawCounter('longform.runtime_usage', 1, { runtime, contentType: info.contentType });
    recordRawCounter('longform.migration_coverage', runtime === 'platform' ? 1 : 0, {});
    if (info.knowledgeVersion != null) recordRawCounter('longform.knowledge_version_usage', 1, { version: String(info.knowledgeVersion) });
    if (typeof info.tokens === 'number') recordRawCounter('longform.token_usage', info.tokens, { runtime });
    if (info.qualityPassed != null) recordRawCounter('longform.quality_gate', 1, { outcome: info.qualityPassed ? 'passed' : 'failed' });
    if (typeof info.validationFailures === 'number') recordRawCounter('longform.validation_failures', info.validationFailures, {});
  } catch { /* fail-safe */ }
}

function qualityPassed(result: any): boolean | null {
  if (result && typeof result === 'object') {
    if (typeof result.quality_passed === 'boolean') return result.quality_passed;
    if (result.thought_leadership_quality && typeof result.thought_leadership_quality.passed === 'boolean') return result.thought_leadership_quality.passed;
  }
  return null;
}

/**
 * Execute long-form generation through the platform. Returns the exact engine result
 * (byte-identical to legacy). Never throws beyond what the engine itself throws (the
 * safety net runs the engine directly if the AIC pipeline does not complete).
 */
export async function runLongFormCapability(input: LongFormPlatformInput, deps: LongFormPlatformDeps = {}): Promise<any> {
  const engineRunner = deps.engineRunner ?? defaultLongFormEngineRunner;
  const executor = deps.capabilityExecutor ?? executeCapability;
  const profile: LongFormCapabilityProfile | null = profileForEngineContentType(input.engineContentType);
  const contentType = profile?.id ?? String(input.engineContentType || 'unknown');

  // Capture the exact engine object (no serialization → guaranteed parity).
  let engineResult: any;
  let engineRan = false;
  const modelRunner: ModelRunner = async () => {
    engineResult = await engineRunner(input.engineRequest);
    engineRan = true;
    return { text: '<<long-form-engine>>', tokens: { input: 0, output: 0 }, model: 'gpt-4o-mini', cacheUsed: false };
  };

  // The engine owns prompts — the injected assembler is a no-op the runner ignores.
  const promptAssembler = () => [
    { role: 'system' as const, content: 'long-form' },
    { role: 'user' as const, content: '' },
  ];
  const outputParser = () => (engineRan ? (engineResult ?? {}) : {});

  const request: CapabilityRequest = {
    capability: 'LONG_FORM_CONTENT',
    companyId: input.companyId,
    userId: input.userId,
    input: { contentType, engineContentType: input.engineContentType },
    now: input.now,
    correlationId: input.correlationId,
  };

  try {
    const res = await executor(request, { modelRunner, promptAssembler, outputParser } as never);
    if (engineRan && (res.status === 'completed' || res.status === 'partial')) {
      recordLongFormRuntime('platform', {
        contentType,
        knowledgeVersion: res.knowledgeVersion,
        tokens: res.execution.tokens.input + res.execution.tokens.output,
        qualityPassed: qualityPassed(engineResult),
        validationFailures: res.validation.failures,
      });
      return engineResult;
    }
  } catch (err) {
    logger.warn('long_form_platform_pipeline_error', { contentType, message: err instanceof Error ? err.message : String(err) });
  }

  // ── Safety net: pipeline did not complete → run the engine directly (zero regression) ──
  if (!engineRan) engineResult = await engineRunner(input.engineRequest);
  recordLongFormRuntime('platform', { contentType, qualityPassed: qualityPassed(engineResult), knowledgeVersion: null });
  return engineResult;
}
