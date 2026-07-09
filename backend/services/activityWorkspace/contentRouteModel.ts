/** Part 1/2 of content.ts — verbatim split (barrel preserved; importers unchanged). */
import { NextApiRequest, NextApiResponse } from 'next';
import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  optimizeDiscoverabilityForPlatform,
  type MasterContentPayload,
} from '@/backend/services/contentGenerationPipeline';
import { runCompletionWithOperation } from '@/backend/services/aiGateway';
import { processContent } from '@/backend/services/unifiedContentProcessor';
import { supabase } from '@/backend/db/supabaseClient';
import { getCreditCost, type CreditAction } from '@/backend/services/creditDeductionService';
import { executeWithCredits, executeWithEntryConsumption, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { getCreditEconomyExecutionMode } from '@/backend/services/billing/creditEconomyActivation';
import { assertOrgMembership } from '@/backend/services/requestAccessService';
import { generateMasterContentStrict } from '@/backend/services/contentGeneration/blueprintGenerator';
import { getContentTypeCategory } from '@/backend/services/contentGeneration/contentTypeHelpers';
// Closure Pass — Phase 4. Activity workspace generation paths attach
// governance to the item before calling the pipeline.
import { enrichItemWithGovernance } from '@/backend/services/creator/governanceItemEnricher';
// Phase-2 Step-3: master/variant enrichment persistence routes through the
// ONE canonical write (reconciled, blank/stale-overwrite-safe, observable).
import { updateExecutionContentByActivity } from '@/backend/services/orchestration';
import { checkRateLimit } from '@/lib/auth/rateLimit';
import { resolveMonetizationFeature } from '@/shared/monetization/featureRegistry';

import { isFailedVariant } from './contentRouteHandler';

export type WorkspaceAction = 'generate_master' | 'generate_variants' | 'refine_variant' | 'improve_variant' | 'improve_variant_all';
export type ImprovementType = 'IMPROVE_CTA' | 'IMPROVE_HOOK' | 'ADD_DISCOVERABILITY';

export class MonetizedWorkflowError extends Error {
  statusCode: number;
  payload: Record<string, unknown>;

  constructor(statusCode: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Monetized workflow failed'));
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export async function runReservedFixedWorkflow<T>(input: {
  userId: string;
  companyId: string | null;
  action: CreditAction;
  referenceId: string;
  referenceType: string;
  note: string;
  multiplier?: number;
  executor: () => Promise<T>;
}): Promise<T> {
  if (!input.companyId) {
    throw new MonetizedWorkflowError(400, { error: 'Company context is required for billable content actions' });
  }

  // referenceId may be a semantic string (e.g. "workspace-linkedin") for
  // transient workspace flows; executeWithCredits canonicalizes it into a
  // UUID at the boundary and preserves the original in note + telemetry.
  // The semantic key is kept verbatim in idempotencyKey so dedup behavior is
  // unaffected by the UUID projection.
  const registryResolution = resolveMonetizationFeature({ action_key: input.action });
  if (!registryResolution) {
    throw new MonetizedWorkflowError(500, { error: `No monetization registry entry for ${input.action}` });
  }
  const baseCost = await getCreditCost(input.action);
  const amountOverride = Math.round(baseCost * (input.multiplier ?? 1));
  const result = await executeWithCredits<T>({
    userId: input.userId,
    orgId: input.companyId,
    action: input.action,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: makeIdempotencyKey(input.userId, input.action, input.referenceId, input.note),
    amountOverride,
    note: `${input.note} [feature=${registryResolution.feature_key}; pricing=${registryResolution.pricing_key}]`,
    executor: input.executor,
  });

  if (result.status === 'executed') return result.result;
  if (result.status === 'insufficient_credits') {
    throw new MonetizedWorkflowError(402, {
      error: 'Insufficient credits to generate content',
      required: result.required,
      balance: result.available,
    });
  }
  if (result.status === 'not_a_member') throw new MonetizedWorkflowError(403, { error: 'ORG_SCOPE_VIOLATION' });
  if (result.status === 'org_control_blocked') throw new MonetizedWorkflowError(403, { error: result.code, detail: result.reason });
  if (result.status === 'no_credit_account') throw new MonetizedWorkflowError(402, { error: 'No credit account for org' });
  throw new MonetizedWorkflowError(409, { error: `Credit reservation is already settled: ${result.status}` });
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function persistContentEnvelopeToDb(
  activityId: string,
  transform: (existing: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  if (!activityId || activityId.startsWith('workspace-')) return; // transient ID, nothing to persist
  // Canonical write: locates the row, applies the transform, reconciles
  // (enrichment-priority merge, blank/stale-overwrite guards, log-only
  // invariants), preserves legacy row shape, and emits write observability.
  await updateExecutionContentByActivity(activityId, transform, 'activity-workspace/content');
}

/** Merge master_content into daily_content_plans.content JSON blob for the given activity row. */
export async function persistMasterToDb(activityId: string, master: MasterContentPayload): Promise<void> {
  await persistContentEnvelopeToDb(activityId, (existing) => ({ ...existing, master_content: master }));
}

export async function persistVariantsToDb(
  activityId: string,
  variants: Array<Record<string, unknown>>,
  master: Record<string, unknown> | null | undefined
): Promise<void> {
  await persistContentEnvelopeToDb(activityId, (existing) => {
    const previous = Array.isArray(existing.platform_variants) ? (existing.platform_variants as Array<Record<string, unknown>>) : [];
    const merged = new Map<string, Record<string, unknown>>();

    for (const variant of previous) {
      const key = `${String((variant as any)?.platform || '').trim().toLowerCase()}::${String((variant as any)?.content_type || '').trim().toLowerCase()}`;
      if (key !== '::') merged.set(key, variant);
    }
    for (const variant of variants) {
      const key = `${String((variant as any)?.platform || '').trim().toLowerCase()}::${String((variant as any)?.content_type || '').trim().toLowerCase()}`;
      if (key !== '::') merged.set(key, variant);
    }

    const variantList = Array.from(merged.values());
    const primaryGenerated = variantList.find((variant) => {
      const content = String((variant as any)?.generated_content || '').trim();
      return content.length > 0 && !isFailedVariant(variant);
    });

    return {
      ...existing,
      ...(master ? { master_content: master } : {}),
      platform_variants: variantList,
      ...(primaryGenerated ? { generated_content: String((primaryGenerated as any).generated_content || '').trim() } : {}),
      content_status: variantList.length > 0 ? 'repurposed' : existing.content_status,
      repurposed_at: variantList.length > 0 ? new Date().toISOString() : existing.repurposed_at,
    };
  });
}

export const FAILED_VARIANT_PREFIXES = [
  '[PLATFORM ADAPTATION FAILED]',
  '[MASTER GENERATION FAILED',
];
// Note: [PLATFORM MEDIA BLUEPRINT] is NOT a failure — it is a valid creator-activity placeholder
// indicating the variant requires a media asset. It is returned as a successful variant so the
// client can show a "waiting for media" state rather than an error.

