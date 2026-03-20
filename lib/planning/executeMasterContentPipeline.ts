/**
 * Execution trigger: calls existing backend content API (generate_master then generate_variants).
 * No new AI logic; backend contentGenerationPipeline remains the only generation engine.
 * Optional memory profile: when provided (or fetched), bias instruction is appended to generate_master context.
 */

import type { MasterContentDocument } from './masterContentDocument';
import { deriveGenerationBias } from '../intelligence/generationBias';
import type { StrategicMemoryProfile } from '../intelligence/strategicMemory';
import { apiFetch } from '../apiFetch';

type ActivityLike = {
  id?: string;
  platform?: string;
  contentType?: string;
  topic?: string;
  title?: string;
  description?: string;
  [k: string]: unknown;
};

type ScheduleLike = { id?: string; platform: string; contentType?: string; [k: string]: unknown };

export type ExecuteMasterContentPipelineParams = {
  campaignId: string;
  executionId: string;
  masterDocument: MasterContentDocument | null;
  dailyExecutionItem: Record<string, unknown> | null;
  schedules: ScheduleLike[];
  activity?: ActivityLike | null;
  /** Optional: when set, used to derive bias instruction for generate_master. If unset and campaignId present, fetched from API. */
  memoryProfile?: StrategicMemoryProfile | null;
  companyId?: string | null;
};

export type ExecuteMasterContentPipelineResult = {
  master_content: Record<string, unknown> | null;
  platform_variants: Array<Record<string, unknown>>;
};

const CONTENT_API = '/api/activity-workspace/content';

function buildActivityFromItem(
  dailyExecutionItem: Record<string, unknown> | null,
  executionId: string
): ActivityLike {
  const item = dailyExecutionItem || {};
  return {
    id: String((item as any)?.execution_id || executionId).trim(),
    platform: String((item as any)?.platform || 'linkedin').trim().toLowerCase(),
    contentType: String((item as any)?.content_type || (item as any)?.contentType || 'post').trim().toLowerCase(),
    topic: String((item as any)?.topic || (item as any)?.title || '').trim(),
    title: String((item as any)?.title || (item as any)?.topic || '').trim(),
    description: String((item as any)?.content || (item as any)?.description || '').trim(),
  };
}

/**
 * Runs the real backend pipeline: generate_master then generate_variants.
 * Uses existing /api/activity-workspace/content; no new AI logic.
 */
async function getMemoryProfileIfNeeded(
  campaignId: string,
  existing: StrategicMemoryProfile | null | undefined
): Promise<StrategicMemoryProfile | null> {
  if (existing && typeof existing === 'object') return existing;
  if (!campaignId || typeof window === 'undefined') return null;
  try {
    const res = await fetch(
      `/api/intelligence/strategic-memory?campaignId=${encodeURIComponent(campaignId)}`,
      { credentials: 'include' }
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export async function executeMasterContentPipeline({
  campaignId,
  executionId,
  masterDocument,
  dailyExecutionItem,
  schedules,
  activity: activityOverride,
  memoryProfile: memoryProfileOverride,
  companyId,
}: ExecuteMasterContentPipelineParams): Promise<ExecuteMasterContentPipelineResult> {
  const activity = activityOverride ?? buildActivityFromItem(dailyExecutionItem, executionId);

  if (process.env.NODE_ENV === 'development') {
    console.log('[ExecutionPipelineIntegration]', {
      executionId,
      platforms: masterDocument?.platforms ?? [],
      campaignId,
    });
  }

  let biasInstruction: string | undefined;
  const profile = await getMemoryProfileIfNeeded(campaignId, memoryProfileOverride);
  if (profile) {
    const bias = deriveGenerationBias(profile);
    if (bias.extra_instruction) biasInstruction = bias.extra_instruction;
  }

  const masterPayload: Record<string, unknown> = {
    action: 'generate_master',
    activity,
    schedules,
    dailyExecutionItem: dailyExecutionItem || {},
    companyId: companyId ?? null,
  };
  if (biasInstruction) masterPayload.extra_instruction = biasInstruction;

  const resMaster = await apiFetch(CONTENT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(masterPayload),
  });

  if (!resMaster.ok) {
    const err = await resMaster.json().catch(() => ({}));
    throw new Error(String(err?.message || err?.error || 'Failed to execute content pipeline (generate_master)'));
  }

  const dataMaster = await resMaster.json().catch(() => ({}));
  const master_content =
    (dataMaster?.master_content && typeof dataMaster.master_content === 'object')
      ? dataMaster.master_content
      : (dataMaster?.masterContent && typeof dataMaster.masterContent === 'object')
        ? dataMaster.masterContent
        : null;

  const itemWithMaster = {
    ...(dailyExecutionItem || {}),
    master_content,
    platform_variants: (dailyExecutionItem as any)?.platform_variants,
  };

  const resVariants = await apiFetch(CONTENT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generate_variants',
      activity,
      schedules: schedules.length > 0 ? schedules : (masterDocument?.platforms ?? []).map((p) => ({ platform: p, contentType: 'post' })),
      dailyExecutionItem: itemWithMaster,
      companyId: companyId ?? null,
    }),
  });

  if (!resVariants.ok) {
    const err = await resVariants.json().catch(() => ({}));
    throw new Error(String(err?.message || err?.error || 'Failed to execute content pipeline (generate_variants)'));
  }

  const dataVariants = await resVariants.json().catch(() => ({}));
  const platform_variants = Array.isArray(dataVariants?.platform_variants) ? dataVariants.platform_variants : [];

  return { master_content, platform_variants };
}

export type ImprovementType = 'IMPROVE_CTA' | 'IMPROVE_HOOK' | 'ADD_DISCOVERABILITY';

export type ExecuteVariantImprovementParams = {
  campaignId?: string;
  executionId: string;
  platform: string;
  improvementType: ImprovementType;
  variant: Record<string, unknown>;
  dailyExecutionItem?: Record<string, unknown> | null;
  companyId?: string | null;
};

export type ExecuteVariantImprovementAllParams = {
  campaignId?: string;
  executionId: string;
  platform: string;
  improvementTypes: ImprovementType[];
  variant: Record<string, unknown>;
  dailyExecutionItem?: Record<string, unknown> | null;
  companyId?: string | null;
};

/**
 * Calls backend improve_variant action for targeted single-variant improvement.
 */
export async function executeVariantImprovement(
  payload: ExecuteVariantImprovementParams
): Promise<{ improved_variant: Record<string, unknown> }> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[VariantImprovement]', { platform: payload.platform, action: payload.improvementType });
  }
  const res = await apiFetch(CONTENT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'improve_variant',
      improvementType: payload.improvementType,
      platform: payload.platform,
      executionId: payload.executionId,
      execution_id: payload.executionId,
      variant: payload.variant,
      dailyExecutionItem: payload.dailyExecutionItem ?? {},
      companyId: payload.companyId ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String(err?.message || err?.error || 'Variant improvement failed'));
  }
  const data = await res.json().catch(() => ({}));
  const improved_variant = data?.improved_variant && typeof data.improved_variant === 'object'
    ? data.improved_variant
    : payload.variant;
  return { improved_variant };
}

/**
 * Applies ALL suggestions in a single combined AI call so improvements are integrated
 * holistically (not appended sequentially). ADD_DISCOVERABILITY is handled in the same
 * request but written only to discoverability_meta, not the content body.
 */
export async function executeVariantImprovementAll(
  payload: ExecuteVariantImprovementAllParams
): Promise<{ improved_variant: Record<string, unknown> }> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[VariantImprovementAll]', { platform: payload.platform, actions: payload.improvementTypes });
  }
  const res = await apiFetch(CONTENT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'improve_variant_all',
      improvementTypes: payload.improvementTypes,
      platform: payload.platform,
      executionId: payload.executionId,
      execution_id: payload.executionId,
      variant: payload.variant,
      dailyExecutionItem: payload.dailyExecutionItem ?? {},
      companyId: payload.companyId ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String(err?.message || err?.error || 'Variant improvement failed'));
  }
  const data = await res.json().catch(() => ({}));
  const improved_variant = data?.improved_variant && typeof data.improved_variant === 'object'
    ? data.improved_variant
    : payload.variant;
  return { improved_variant };
}
