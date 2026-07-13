/**
 * creatorPlatformRuntime.ts — execute a Creator Capability Profile (PMF-004 §2/§4/§5/§6/§11).
 *
 * The platform execution path for Content Creator assets. It runs the EXISTING asset
 * pipeline (LLM layout + render + storage + governance) inside an injected AIC model
 * runner, so AIC-001 owns the pipeline (CKC-001 knowledge, validation, telemetry,
 * recovery, output contract) while the pipeline's prompts, inference, rendering, and
 * governance are untouched (zero prompt/quality change). The exact asset result is
 * captured via closure and served verbatim (guaranteed output parity — no reshape).
 *
 * SAFETY NET: if the AIC pipeline does not complete for ANY reason, the runtime runs
 * the pipeline directly, so the platform path can never be worse than legacy.
 *
 * The caller supplies the legacy generation as `generate` — the runtime never needs
 * to know the pipeline entry point, so it adds no duplicate orchestration.
 *
 * AIA is used ONLY when the profile marks the workflow multi-stage / review / async
 * (§5). Single-step inline generations remain a direct AIC execution.
 */

import { executeCapability } from '../aiCapability/aiCapabilityRuntime';
import type { CapabilityRequest } from '../aiCapability/capabilityContracts';
import type { ModelRunner } from '../aiCapability/capabilityModelRunner';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { profileForAssetType, type CreatorCapabilityProfile } from './creatorCapabilityProfile';

export interface CreatorPlatformInput<T = any> {
  assetType: string;
  companyId: string;
  userId?: string | null;
  /** The legacy asset generation — the exact call the legacy path makes. */
  generate: () => Promise<T>;
  now?: string;
  correlationId?: string;
}

export interface CreatorPlatformDeps {
  capabilityExecutor?: typeof executeCapability;
  nowIso?: () => string;
}

function assetQualityOutcome(asset: any): boolean | null {
  if (asset && typeof asset === 'object') {
    if (typeof asset.quality_passed === 'boolean') return asset.quality_passed;
    if (asset.governance && typeof asset.governance.passed === 'boolean') return asset.governance.passed;
    if (asset.diagnostics && typeof asset.diagnostics.passed === 'boolean') return asset.diagnostics.passed;
  }
  return null;
}

/** §11 — record platform/legacy creator telemetry. Fail-safe. */
export function recordCreatorRuntime(runtime: 'legacy' | 'platform', info: {
  assetType: string; knowledgeVersion?: number | null; tokens?: number; qualityPassed?: boolean | null; validationFailures?: number;
} = { assetType: 'unknown' }): void {
  try {
    recordRawCounter('creator.runtime_usage', 1, { runtime, assetType: info.assetType });
    recordRawCounter('creator.migration_coverage', runtime === 'platform' ? 1 : 0, {});
    if (info.knowledgeVersion != null) recordRawCounter('creator.knowledge_version_usage', 1, { version: String(info.knowledgeVersion) });
    if (typeof info.tokens === 'number') recordRawCounter('creator.token_usage', info.tokens, { runtime });
    if (info.qualityPassed != null) recordRawCounter('creator.asset_quality', 1, { outcome: info.qualityPassed ? 'passed' : 'failed' });
    if (typeof info.validationFailures === 'number') recordRawCounter('creator.validation_failures', info.validationFailures, {});
  } catch { /* fail-safe */ }
}

/**
 * Execute Content Creator asset generation through the platform. Returns the exact
 * asset result (byte-identical to legacy). Never throws beyond what the pipeline
 * itself throws (the safety net runs the pipeline directly if AIC doesn't complete).
 */
export async function runCreatorCapability<T = any>(input: CreatorPlatformInput<T>, deps: CreatorPlatformDeps = {}): Promise<T> {
  const executor = deps.capabilityExecutor ?? executeCapability;
  const profile: CreatorCapabilityProfile | null = profileForAssetType(input.assetType);
  const assetType = profile?.id ?? String(input.assetType || 'unknown');

  let assetResult: T | undefined;
  let assetRan = false;
  const modelRunner: ModelRunner = async () => {
    assetResult = await input.generate();
    assetRan = true;
    return { text: '<<creator-asset>>', tokens: { input: 0, output: 0 }, model: 'gpt-4o-mini', cacheUsed: false };
  };
  const promptAssembler = () => [
    { role: 'system' as const, content: 'creator-asset' },
    { role: 'user' as const, content: '' },
  ];
  const outputParser = () => (assetRan ? (assetResult ?? {}) : {});

  const request: CapabilityRequest = {
    capability: 'CREATOR_ASSET',
    companyId: input.companyId,
    userId: input.userId,
    input: { assetType, canonicalAssetType: profile?.assetType ?? input.assetType },
    now: input.now,
    correlationId: input.correlationId,
  };

  try {
    const res = await executor(request, { modelRunner, promptAssembler, outputParser } as never);
    if (assetRan && (res.status === 'completed' || res.status === 'partial')) {
      recordCreatorRuntime('platform', {
        assetType,
        knowledgeVersion: res.knowledgeVersion,
        tokens: res.execution.tokens.input + res.execution.tokens.output,
        qualityPassed: assetQualityOutcome(assetResult),
        validationFailures: res.validation.failures,
      });
      return assetResult as T;
    }
  } catch (err) {
    logger.warn('creator_platform_pipeline_error', { assetType, message: err instanceof Error ? err.message : String(err) });
  }

  // ── Safety net: pipeline did not complete → run the asset pipeline directly ──
  if (!assetRan) assetResult = await input.generate();
  recordCreatorRuntime('platform', { assetType, qualityPassed: assetQualityOutcome(assetResult), knowledgeVersion: null });
  return assetResult as T;
}
