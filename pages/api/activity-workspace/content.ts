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
import { executeWithCredits, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { assertOrgMembership } from '@/backend/services/requestAccessService';
import { generateMasterContentStrict } from '@/backend/services/contentGeneration/blueprintGenerator';
import { getContentTypeCategory } from '@/backend/services/contentGeneration/contentTypeHelpers';
// Phase-2 Step-3: master/variant enrichment persistence routes through the
// ONE canonical write (reconciled, blank/stale-overwrite-safe, observable).
import { updateExecutionContentByActivity } from '@/backend/services/orchestration';
import { checkRateLimit } from '@/lib/auth/rateLimit';
import { resolveMonetizationFeature } from '@/shared/monetization/featureRegistry';

type WorkspaceAction = 'generate_master' | 'generate_variants' | 'refine_variant' | 'improve_variant' | 'improve_variant_all';
type ImprovementType = 'IMPROVE_CTA' | 'IMPROVE_HOOK' | 'ADD_DISCOVERABILITY';

class MonetizedWorkflowError extends Error {
  statusCode: number;
  payload: Record<string, unknown>;

  constructor(statusCode: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Monetized workflow failed'));
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

async function runReservedFixedWorkflow<T>(input: {
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

function asObject(value: unknown): Record<string, unknown> | null {
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
async function persistMasterToDb(activityId: string, master: MasterContentPayload): Promise<void> {
  await persistContentEnvelopeToDb(activityId, (existing) => ({ ...existing, master_content: master }));
}

async function persistVariantsToDb(
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

const FAILED_VARIANT_PREFIXES = [
  '[PLATFORM ADAPTATION FAILED]',
  '[MASTER GENERATION FAILED',
];
// Note: [PLATFORM MEDIA BLUEPRINT] is NOT a failure — it is a valid creator-activity placeholder
// indicating the variant requires a media asset. It is returned as a successful variant so the
// client can show a "waiting for media" state rather than an error.

function isFailedVariant(v: unknown): boolean {
  const content = String((v as any)?.generated_content ?? '').trim();
  return FAILED_VARIANT_PREFIXES.some((p) => content.startsWith(p));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check — must be an authenticated user
  const { getSupabaseUserFromRequest } = await import('@/backend/services/supabaseAuthService');
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const action = String((req.body as any)?.action || '').trim() as WorkspaceAction;
    const activity = asObject((req.body as any)?.activity) || {};
    const schedules = Array.isArray((req.body as any)?.schedules) ? (req.body as any).schedules : [];
    const dailyExecutionItemRaw = asObject((req.body as any)?.dailyExecutionItem) || {};
    const extra_instruction = typeof (req.body as any)?.extra_instruction === 'string' ? String((req.body as any).extra_instruction).trim() || undefined : undefined;
    // Prefer client-supplied companyId; fall back to DB lookup via activity id → campaign → company
    let companyId: string | null = String((req.body as any)?.companyId || '').trim() || null;
    if (!companyId) {
      const activityId = String((req.body as any)?.activity?.id || '').trim();
      const campaignId = String((req.body as any)?.campaignId || '').trim();
      try {
        if (activityId && !activityId.startsWith('workspace-')) {
          const { data: plan } = await supabase.from('daily_content_plans').select('campaign_id').eq('id', activityId).maybeSingle();
          const cid = plan?.campaign_id || campaignId;
          if (cid) {
            const { data: camp } = await supabase.from('campaigns').select('company_id').eq('id', cid).maybeSingle();
            companyId = camp?.company_id ?? null;
          }
        } else if (campaignId) {
          const { data: camp } = await supabase.from('campaigns').select('company_id').eq('id', campaignId).maybeSingle();
          companyId = camp?.company_id ?? null;
        }
      } catch { /* non-fatal */ }
    }

    if (!action || !['generate_master', 'generate_variants', 'refine_variant', 'improve_variant', 'improve_variant_all'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (action === 'improve_variant') {
      const improvementType = String((req.body as any)?.improvementType || '').trim() as ImprovementType;
      const variantRaw = asObject((req.body as any)?.variant);
      const platform = String((req.body as any)?.platform || (variantRaw as any)?.platform || '').trim().toLowerCase();
      const executionId = String((req.body as any)?.executionId || (req.body as any)?.execution_id || (dailyExecutionItemRaw as any)?.execution_id || '').trim();
      if (!variantRaw || !platform || !['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'].includes(improvementType)) {
        return res.status(400).json({ error: 'improve_variant requires improvementType, platform, and variant' });
      }
      const variant = { ...variantRaw } as any;
      const currentContent = String(variant?.generated_content || variant?.content || '').trim();
      if (!currentContent) {
        return res.status(400).json({ error: 'Variant has no content to improve' });
      }
      const contentType = String(variant?.content_type || 'post').trim().toLowerCase();
      const improvementTypes = [improvementType];
      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      const improved_variant = await runReservedFixedWorkflow({
        userId: user.id,
        companyId,
        action: 'content_rewrite',
        referenceType: 'activity_content_improvement',
        referenceId: `${activityDbId || platform}:all:${improvementTypes.join('+')}`,
        note: `Improve all: ${improvementTypes.join(', ')}`,
        executor: async () => {
          let discoverabilityMeta: Record<string, unknown> | undefined;
          if (improvementTypes.includes('ADD_DISCOVERABILITY')) {
            discoverabilityMeta = await optimizeDiscoverabilityForPlatform(currentContent, platform, contentType);
          }
          const contentImprovements = improvementTypes.filter((t) => t !== 'ADD_DISCOVERABILITY');
          let revisedContent = currentContent;
          if (contentImprovements.length > 0) {
            const aiResult = await runCompletionWithOperation({
              companyId,
              model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
              operation: 'regenerateContent',
              temperature: 0.2,
              messages: [
                {
                  role: 'system',
                  content: 'You are a social content editor. Apply all requested improvements in-place. Return plain text only.',
                },
                {
                  role: 'user',
                  content: JSON.stringify({
                    platform,
                    content_type: contentType,
                    improvements: contentImprovements,
                    current_content: currentContent,
                  }),
                },
              ],
            });
            let revised = String(aiResult?.output || '').trim();
            if (!revised) throw new Error('Improvement returned empty output');
            const refinedImprove = await processContent({
              content: revised,
              platform,
              card_type: 'platform_variant',
              enforce_char_limit: true,
            });
            revisedContent = refinedImprove.content || revised;
          }
          const nextVariant = {
            ...variant,
            generated_content: revisedContent,
            ...(discoverabilityMeta ? { discoverability_meta: discoverabilityMeta } : {}),
          };
          await persistVariantsToDb(activityDbId, [nextVariant], asObject((dailyExecutionItemRaw as any)?.master_content));
          return nextVariant;
        },
      });
      return res.status(200).json({ success: true, improved_variant });

      {
      if (improvementType === 'ADD_DISCOVERABILITY') {
        const discoverabilityMeta = await optimizeDiscoverabilityForPlatform(currentContent, platform, contentType);
        // Store hashtags in discoverability_meta only — do NOT append to generated_content.
        // The preview layer renders hashtags from discoverability_meta.hashtags separately.
      const improved_variant = {
        ...variant,
        discoverability_meta: discoverabilityMeta,
        generated_content: currentContent,
      };
      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      await persistVariantsToDb(activityDbId, [improved_variant], asObject((dailyExecutionItemRaw as any)?.master_content));
      return res.status(200).json({ success: true, improved_variant });
      }

      if (!['IMPROVE_CTA', 'IMPROVE_HOOK'].includes(improvementType)) {
        return res.status(400).json({ error: 'Unsupported improvement type' });
      }

      // Build a plain-text prompt — avoids JSON parsing confusion in the model
      const lines = currentContent.split('\n');
      const firstLine = lines[0] ?? '';
      const restLines = lines.slice(1).join('\n');
      const lastSentenceIdx = currentContent.search(/[.!?][^.!?]*$/);
      const beforeLastSentence = lastSentenceIdx > 0 ? currentContent.slice(0, lastSentenceIdx + 1).trimEnd() : '';
      const lastSentence = lastSentenceIdx > 0 ? currentContent.slice(lastSentenceIdx + 1).trim() : currentContent.trim();

      const systemPrompt =
        improvementType === 'IMPROVE_HOOK'
          ? [
              'You are a social content editor. Your ONLY job: rewrite the FIRST LINE of the content to be punchier and under 100 characters.',
              'STRICT RULES:',
              '1. Output the COMPLETE content — first line replaced, every other line UNCHANGED.',
              '2. Do NOT touch any line after the first.',
              '3. Do NOT add anything at the end.',
              '4. Return plain text only — no labels, no commentary.',
            ].join('\n')
          : [
              'You are a social content editor. Your ONLY job: rewrite the LAST SENTENCE (or last 1-2 sentences) of the content to be a stronger, more specific call-to-action.',
              'STRICT RULES:',
              '1. Output the COMPLETE content — everything before the last sentence UNCHANGED, last sentence replaced with a better CTA.',
              '2. Do NOT append a new line at the bottom — the new CTA replaces the existing ending in-place.',
              '3. Do NOT touch anything before the last sentence.',
              '4. Return plain text only — no labels, no commentary.',
            ].join('\n');

      const userPrompt =
        improvementType === 'IMPROVE_HOOK'
          ? [
              `Platform: ${platform} | Type: ${contentType}`,
              '',
              '## FIRST LINE (rewrite this):',
              firstLine,
              '',
              '## REST OF CONTENT (keep exactly as-is):',
              restLines,
              '',
              'Output the complete revised content now:',
            ].join('\n')
          : [
              `Platform: ${platform} | Type: ${contentType}`,
              '',
              '## CONTENT BEFORE LAST SENTENCE (keep exactly as-is):',
              beforeLastSentence || currentContent,
              '',
              '## LAST SENTENCE (replace with a stronger CTA):',
              lastSentence || '(no ending sentence found — add a CTA at the end)',
              '',
              'Output the complete revised content now:',
            ].join('\n');

      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      const improved_variant = await runReservedFixedWorkflow({
        userId: user.id,
        companyId,
        action: 'content_rewrite',
        referenceType: 'activity_content_improvement',
        referenceId: `${activityDbId || executionId || platform}:${improvementType}`,
        note: `Improve ${improvementType.toLowerCase()}`,
        executor: async () => {
          const aiResult = await runCompletionWithOperation({
            companyId,
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            operation: 'regenerateContent',
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
          });
          let revised = String(aiResult?.output || '').trim();
          if (!revised) {
            throw new Error('Improvement returned empty output');
          }
          const refinedImprove = await processContent({
            content: revised,
            platform,
            card_type: 'platform_variant',
            enforce_char_limit: true,
          });
          revised = refinedImprove.content || revised;
          const nextVariant = {
            ...variant,
            generated_content: revised,
          };
          await persistVariantsToDb(activityDbId, [nextVariant], asObject((dailyExecutionItemRaw as any)?.master_content));
          return nextVariant;
        },
      });
      return res.status(200).json({ success: true, improved_variant });
      }
    }

    if (action === 'improve_variant_all') {
      const rawTypes = Array.isArray((req.body as any)?.improvementTypes)
        ? (req.body as any).improvementTypes
        : [];
      const improvementTypes = rawTypes.filter((t: unknown) =>
        ['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'].includes(String(t))
      ) as ImprovementType[];
      const variantRaw = asObject((req.body as any)?.variant);
      const platform = String((req.body as any)?.platform || (variantRaw as any)?.platform || '').trim().toLowerCase();
      if (!variantRaw || !platform || improvementTypes.length === 0) {
        return res.status(400).json({ error: 'improve_variant_all requires improvementTypes, platform, and variant' });
      }
      const variant = { ...variantRaw } as any;
      const currentContent = String(variant?.generated_content || variant?.content || '').trim();
      if (!currentContent) {
        return res.status(400).json({ error: 'Variant has no content to improve' });
      }
      const contentType = String(variant?.content_type || 'post').trim().toLowerCase();
      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      const improved_variant = await runReservedFixedWorkflow({
        userId: user.id,
        companyId,
        action: 'content_rewrite',
        referenceType: 'activity_content_improvement',
        referenceId: `${activityDbId || platform}:all:${improvementTypes.join('+')}`,
        note: `Improve all: ${improvementTypes.join(', ')}`,
        executor: async () => {
          let discoverabilityMeta: Record<string, unknown> | undefined;
          if (improvementTypes.includes('ADD_DISCOVERABILITY')) {
            discoverabilityMeta = await optimizeDiscoverabilityForPlatform(currentContent, platform, contentType);
          }
          const contentImprovements = improvementTypes.filter((t) => t !== 'ADD_DISCOVERABILITY');
          let revisedContent = currentContent;
          if (contentImprovements.length > 0) {
            const aiResult = await runCompletionWithOperation({
              companyId,
              model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
              operation: 'regenerateContent',
              temperature: 0.2,
              messages: [
                { role: 'system', content: 'You are a social content editor. Apply all requested improvements in-place. Return plain text only.' },
                { role: 'user', content: JSON.stringify({ platform, content_type: contentType, improvements: contentImprovements, current_content: currentContent }) },
              ],
            });
            let revised = String(aiResult?.output || '').trim();
            if (!revised) throw new Error('Improvement returned empty output');
            const refinedImprove = await processContent({
              content: revised,
              platform,
              card_type: 'platform_variant',
              enforce_char_limit: true,
            });
            revisedContent = refinedImprove.content || revised;
          }
          const nextVariant = {
            ...variant,
            generated_content: revisedContent,
            ...(discoverabilityMeta ? { discoverability_meta: discoverabilityMeta } : {}),
          };
          await persistVariantsToDb(activityDbId, [nextVariant], asObject((dailyExecutionItemRaw as any)?.master_content));
          return nextVariant;
        },
      });
      return res.status(200).json({ success: true, improved_variant });

      // ADD_DISCOVERABILITY is independent — generate hashtags separately
      {
      let discoverabilityMeta: Record<string, unknown> | undefined;
      if (improvementTypes.includes('ADD_DISCOVERABILITY')) {
        discoverabilityMeta = await optimizeDiscoverabilityForPlatform(currentContent, platform, contentType);
      }

      // Content-modifying improvements applied together in one AI call
      const contentImprovements = improvementTypes.filter((t) => t !== 'ADD_DISCOVERABILITY');
      let revisedContent = currentContent;

      if (contentImprovements.length > 0) {
        const lines = currentContent.split('\n');
        const firstLine = lines[0] ?? '';
        const restLines = lines.slice(1).join('\n');
        const lastSentenceIdx = currentContent.search(/[.!?][^.!?]*$/);
        const beforeLastSentence = lastSentenceIdx > 0 ? currentContent.slice(0, lastSentenceIdx + 1).trimEnd() : '';
        const lastSentence = lastSentenceIdx > 0 ? currentContent.slice(lastSentenceIdx + 1).trim() : currentContent.trim();

        const improvementInstructions = contentImprovements.map((t) => {
          if (t === 'IMPROVE_HOOK') return '1. IMPROVE_HOOK: Rewrite the FIRST LINE to be punchier and under 100 characters — replace in place, do not append.';
          if (t === 'IMPROVE_CTA') return `${contentImprovements.length > 1 ? '2' : '1'}. IMPROVE_CTA: Rewrite the LAST SENTENCE (or last 1-2 sentences) with a stronger, more specific call-to-action — replace in place, do not append a new line.`;
          return '';
        }).filter(Boolean).join('\n');

        const systemPrompt = [
          'You are a social content editor. Apply ALL of the following improvements to the content simultaneously:',
          improvementInstructions,
          '',
          'STRICT RULES:',
          '1. Output the COMPLETE revised content with every improvement applied in the correct position.',
          '2. Do NOT append any new lines at the end — every change must replace the relevant part in-place.',
          '3. Do NOT touch any part of the content that is not being improved.',
          '4. Return plain text only — no labels, no commentary.',
        ].join('\n');

        const userPromptParts = [
          `Platform: ${platform} | Type: ${contentType}`,
          '',
        ];
        if (contentImprovements.includes('IMPROVE_HOOK')) {
          userPromptParts.push('## FIRST LINE (rewrite this — IMPROVE_HOOK):');
          userPromptParts.push(firstLine);
          userPromptParts.push('');
          userPromptParts.push('## REST OF CONTENT (keep exactly as-is, except last sentence if IMPROVE_CTA applies):');
          userPromptParts.push(restLines);
        } else {
          userPromptParts.push('## CONTENT BEFORE LAST SENTENCE (keep exactly as-is):');
          userPromptParts.push(beforeLastSentence || currentContent);
        }
        if (contentImprovements.includes('IMPROVE_CTA')) {
          userPromptParts.push('');
          userPromptParts.push('## LAST SENTENCE (replace with a stronger CTA — IMPROVE_CTA):');
          userPromptParts.push(lastSentence || '(no ending sentence found — add a CTA at the end)');
        }
        userPromptParts.push('', 'Output the complete revised content now:');

        const aiResult = await runCompletionWithOperation({
          companyId,
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          operation: 'regenerateContent',
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPromptParts.join('\n') },
          ],
        });
        let revised = String(aiResult?.output || '').trim();
        if (!revised) {
          return res.status(500).json({ error: 'Improvement returned empty output' });
        }
        const refinedImprove = await processContent({
          content: revised,
          platform,
          card_type: 'platform_variant',
          enforce_char_limit: true,
        });
        revisedContent = refinedImprove.content || revised;
      }

      const improved_variant = {
        ...variant,
        generated_content: revisedContent,
        ...(discoverabilityMeta ? { discoverability_meta: discoverabilityMeta } : {}),
      };
      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      await persistVariantsToDb(activityDbId, [improved_variant], asObject((dailyExecutionItemRaw as any)?.master_content));
      return res.status(200).json({ success: true, improved_variant });
      }
    }

    const activePlatformTargets = schedules
      .map((s: any) => {
        const platform = String(s?.platform || '').trim().toLowerCase();
        const contentType = String(s?.contentType || '').trim().toLowerCase();
        if (!platform) return null;
        return {
          platform,
          content_type: contentType || String(activity.contentType || '').trim().toLowerCase() || 'post',
        };
      })
      .filter(Boolean);

    const item: any = {
      execution_id: String((dailyExecutionItemRaw as any)?.execution_id || activity.id || '').trim() || `workspace-${Date.now()}`,
      platform: String((dailyExecutionItemRaw as any)?.platform || activity.platform || '').trim().toLowerCase() || 'linkedin',
      content_type: String((dailyExecutionItemRaw as any)?.content_type || activity.contentType || '').trim().toLowerCase() || 'post',
      topic: String((dailyExecutionItemRaw as any)?.topic || activity.topic || activity.title || '').trim(),
      title: String((dailyExecutionItemRaw as any)?.title || activity.title || '').trim(),
      content: String((dailyExecutionItemRaw as any)?.content || activity.description || '').trim(),
      intent: asObject((dailyExecutionItemRaw as any)?.intent) || undefined,
      writer_content_brief: asObject((dailyExecutionItemRaw as any)?.writer_content_brief) || undefined,
      narrative_role: String((dailyExecutionItemRaw as any)?.narrative_role || '').trim() || undefined,
      progression_step: Number.isFinite(Number((dailyExecutionItemRaw as any)?.progression_step))
        ? Number((dailyExecutionItemRaw as any).progression_step)
        : undefined,
      global_progression_index: Number.isFinite(Number((dailyExecutionItemRaw as any)?.global_progression_index))
        ? Number((dailyExecutionItemRaw as any).global_progression_index)
        : undefined,
      master_content: asObject((dailyExecutionItemRaw as any)?.master_content) || undefined,
      platform_variants: Array.isArray((dailyExecutionItemRaw as any)?.platform_variants)
        ? (dailyExecutionItemRaw as any).platform_variants
        : undefined,
      active_platform_targets: activePlatformTargets.length > 0 ? activePlatformTargets : undefined,
      media_assets: Array.isArray((dailyExecutionItemRaw as any)?.media_assets) ? (dailyExecutionItemRaw as any).media_assets : undefined,
      media_status:
        (dailyExecutionItemRaw as any)?.media_status === 'ready' || (dailyExecutionItemRaw as any)?.media_status === 'missing'
          ? (dailyExecutionItemRaw as any).media_status
          : undefined,
      company_id: companyId,
      ...(extra_instruction ? { extra_instruction } : {}),
    };

    if (action === 'generate_master') {
      // ── STRICT REQUIREMENTS ──────────────────────────────────────────────
      //   1. orgId is NEVER taken from request body — resolved server-side
      //      from activity → campaign → company.
      //   2. Tenant membership is verified BEFORE any credit work.
      //   3. Rate limits: per-user (30/min, 300/hour) + per-org (100/min,
      //      1000/hour), sliding-window (Redis zset).
      //   4. Provider + model pinned explicitly — no env fallback.
      //   5. Model hard limits (max_context_tokens, max_output_tokens) are
      //      validated inside estimateLlmHoldCredits BEFORE HOLD is placed.
      //   6. HOLD size = resolveLlmCost(maxTokens, applyCeiling=false) —
      //      no ceiling cap on the reservation; the settlement cap still
      //      applies when CONFIRM computes the actual charge.
      //   7. Tokens come ONLY from executor return; source flag distinguishes
      //      provider-metered from cache.
      //   8. aiGateway owns usage_events telemetry; executeWithCredits owns
      //      credit_transactions. No suppressUsageLog flag, no double-write.
      //   9. Response is minimal — no pricing / settlement / tokens leaked.
      // ─────────────────────────────────────────────────────────────────────

      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      if (!activityDbId || activityDbId.startsWith('workspace-')) {
        return res.status(400).json({ error: 'Persisted activity id required (workspace IDs are not billable)' });
      }

      // Server-side orgId resolution — body.companyId is IGNORED.
      const { data: plan } = await supabase
        .from('daily_content_plans')
        .select('campaign_id')
        .eq('id', activityDbId)
        .maybeSingle();
      const campaignIdResolved = (plan as { campaign_id?: string } | null)?.campaign_id;
      if (!campaignIdResolved) {
        return res.status(404).json({ error: 'Activity not found or has no campaign' });
      }
      const { data: camp } = await supabase
        .from('campaigns')
        .select('company_id')
        .eq('id', campaignIdResolved)
        .maybeSingle();
      const resolvedOrgId = (camp as { company_id?: string } | null)?.company_id ?? null;
      if (!resolvedOrgId) {
        return res.status(404).json({ error: 'Campaign has no company' });
      }

      const isMember = await assertOrgMembership(user.id, resolvedOrgId);
      if (!isMember) {
        return res.status(403).json({ error: 'ORG_SCOPE_VIOLATION' });
      }

      // ── Rate limits (sliding window, per-user + per-org, min + hour) ──
      const rlChecks = await Promise.all([
        checkRateLimit(user.id,        { keyPrefix: 'genmaster:user:min',  limit: 30,   windowSecs: 60   }),
        checkRateLimit(user.id,        { keyPrefix: 'genmaster:user:hour', limit: 300,  windowSecs: 3600 }),
        checkRateLimit(resolvedOrgId,  { keyPrefix: 'genmaster:org:min',   limit: 100,  windowSecs: 60   }),
        checkRateLimit(resolvedOrgId,  { keyPrefix: 'genmaster:org:hour',  limit: 1000, windowSecs: 3600 }),
      ]);
      const blocked = rlChecks.find((r) => !r.allowed);
      if (blocked) {
        res.setHeader('Retry-After', String(Math.max(1, blocked.resetAt - Math.floor(Date.now() / 1000))));
        return res.status(429).json({ error: 'Too many requests' });
      }

      const PROVIDER = 'openai';
      // Model tiering by content category: long-format (article / white_paper /
      // newsletter / short_story → category 'article') needs the stronger model
      // for 700+ word editorial quality; short-form (post/tweet/poll/thread)
      // stays on the cheaper mini. Plan-tier budget logic in the gateway
      // (resolveEffectiveModel / evaluateJobCost) may still downgrade this for
      // budget-constrained orgs — intended.
      const isLongFormCategory =
        getContentTypeCategory(String(item?.content_type || '').toLowerCase()) === 'article';
      const MODEL = isLongFormCategory ? 'gpt-4o' : 'gpt-4o-mini';
      // Conservative upper bounds used to size the HOLD. validateModelLimits
      // (called inside estimateLlmHoldCredits) rejects if these exceed the
      // model's configured max_context_tokens / max_output_tokens.
      const MAX_INPUT_TOKENS  = 4000;
      const MAX_OUTPUT_TOKENS = 1500;

      const result = await executeWithCredits<MasterContentPayload>({
        userId:         user.id,
        orgId:          resolvedOrgId,
        action:         'content_generation',
        referenceType:  'master_content',
        referenceId:    activityDbId,
        idempotencyKey: makeIdempotencyKey(user.id, 'content_generation', activityDbId),
        note:           'Master content generation',
        llmPricing: {
          provider:        PROVIDER,
          model:           MODEL,
          actionKey:       'content_generation',
          maxInputTokens:  MAX_INPUT_TOKENS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        executor: async () => {
          const strict = await generateMasterContentStrict(item, {
            provider: PROVIDER,
            model:    MODEL,
          });
          return {
            result:   strict.master,
            usage: {
              inputTokens:  strict.usage.inputTokens,
              outputTokens: strict.usage.outputTokens,
              source:       'provider' as const,
            },
            provider: strict.provider,
            model:    strict.model,
          };
        },
      });

      if (result.status === 'insufficient_credits') {
        return res.status(402).json({
          error:    'Insufficient credits to generate content',
          required: result.required,
          balance:  result.available,
        });
      }
      if (result.status === 'not_a_member') {
        return res.status(403).json({ error: 'ORG_SCOPE_VIOLATION' });
      }
      if (result.status === 'org_control_blocked') {
        return res.status(403).json({ error: result.code, detail: result.reason });
      }
      if (result.status === 'no_credit_account') {
        return res.status(402).json({ error: 'No credit account for org' });
      }
      if (result.status !== 'executed') {
        return res.status(500).json({ error: 'Failed to generate master content' });
      }

      const master = result.result;
      await persistMasterToDb(activityDbId, master);
      return res.status(200).json({ success: true, master_content: master });
    }

    if (action === 'refine_variant') {
      const schedule = asObject((req.body as any)?.schedule) || {};
      const platform = String(schedule?.platform || activity.platform || item.platform || '').trim().toLowerCase();
      const contentType = String(schedule?.contentType || activity.contentType || item.content_type || '').trim().toLowerCase() || 'post';
      const prompt = String((req.body as any)?.refinement_prompt || '').trim();
      const currentContent = String((req.body as any)?.current_content || '').trim();

      if (!platform) {
        return res.status(400).json({ error: 'Platform is required for refinement' });
      }
      if (!prompt) {
        return res.status(400).json({ error: 'Refinement prompt is required' });
      }
      if (!currentContent) {
        return res.status(400).json({ error: 'Current content is required for refinement' });
      }

      if (!companyId) {
        return res.status(400).json({ error: 'companyId required for credit reservation on refine_variant' });
      }
      const { isRefineVariantBillingEnabled, runBilledAiCompletion } = await import('@/backend/services/billing');
      const activityDbIdForBilling = String((req.body as any)?.activity?.id || `refine-${platform}-${Date.now()}`).trim();
      const refineBilling = await isRefineVariantBillingEnabled({ organizationId: companyId });

      if (!refineBilling.enabled) {
        const directResult = await runCompletionWithOperation({
          companyId,
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          operation: 'regenerateContent',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: 'You are a senior social content editor. Apply user refinement instructions while preserving factual meaning and platform fit. Preserve all paragraph line breaks and blank lines between paragraphs. Return only refined content - no labels, no commentary.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                platform,
                content_type: contentType,
                refinement_instruction: prompt,
                current_content: currentContent,
              }),
            },
          ],
        });
        let refined = String(directResult.output || '').trim();
        if (!refined) {
          return res.status(500).json({ error: 'AI refinement returned empty output' });
        }
        const refinedOutput = await processContent({
          content: refined,
          platform,
          card_type: 'repurpose_card',
          enforce_char_limit: true,
        });
        refined = refinedOutput.content || refined;

        const activityDbId = String((req.body as any)?.activity?.id || '').trim();
        await persistVariantsToDb(activityDbId, [{
          platform,
          content_type: contentType,
          generated_content: refined,
          generation_status: 'generated',
          refinement_status: 'in_progress',
          refinement_finalized: false,
        }], asObject((dailyExecutionItemRaw as any)?.master_content));
        return res.status(200).json({
          success: true,
          refined_content: refined,
          usage: directResult.metadata?.token_usage ?? null,
          billing: {
            charged: false,
            reason: refineBilling.reason,
          },
        });
      }

      const billed = await runBilledAiCompletion({
        module:        'http:activity_workspace_refine_variant',
        userId:        user.id,
        orgId:         companyId,
        action:        'content_rewrite',
        referenceType: 'variant_refine',
        referenceId:   activityDbIdForBilling,
        llmPricing: {
          provider:        'openai',
          model:           process.env.OPENAI_MODEL || 'gpt-4o-mini',
          maxInputTokens:  4000,
          maxOutputTokens: 1500,
          actionKey:       'content_rewrite',
        },
        idempotency: {
          kind:        'http',
          actorUserId: user.id,
          action:      'content_rewrite',
          referenceId: activityDbIdForBilling,
          requestBody: { platform, contentType, prompt, currentContent },
          requestHeaderIdempotency: typeof req.headers['idempotency-key'] === 'string'
            ? (req.headers['idempotency-key'] as string)
            : undefined,
        },
        completion: {
          companyId,
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          operation: 'regenerateContent',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: 'You are a senior social content editor. Apply user refinement instructions while preserving factual meaning and platform fit. Preserve all paragraph line breaks and blank lines between paragraphs. Return only refined content — no labels, no commentary.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                platform,
                content_type: contentType,
                refinement_instruction: prompt,
                current_content: currentContent,
                objective: item?.intent?.objective ?? null,
                audience: item?.intent?.target_audience ?? null,
                cta: item?.intent?.cta_type ?? null,
              }),
            },
          ],
        },
      });

      let refined = String(billed.text || '').trim();
      if (!refined) {
        return res.status(500).json({ error: 'AI refinement returned empty output' });
      }
      const refinedOutput = await processContent({
        content: refined,
        platform,
        card_type: 'repurpose_card',
        enforce_char_limit: true,
      });
      refined = refinedOutput.content || refined;

      const activityDbId = String((req.body as any)?.activity?.id || '').trim();
      await persistVariantsToDb(activityDbId, [{
        platform,
        content_type: contentType,
        generated_content: refined,
        generation_status: 'generated',
        refinement_status: 'in_progress',
        refinement_finalized: false,
      }], asObject((dailyExecutionItemRaw as any)?.master_content));
      return res.status(200).json({
        success: true,
        refined_content: refined,
      });
    }

    // ── generate_variants ─────────────────────────────────────────────────────
    const activityDbId = String((req.body as any)?.activity?.id || '').trim();

    const creatorAsset = asObject((dailyExecutionItemRaw as any)?.creator_asset);
    const hasCreatorAsset = creatorAsset && (
      String(creatorAsset.url ?? '').trim() || (Array.isArray(creatorAsset.files) && creatorAsset.files.length > 0)
    );
    const creatorMasterText = hasCreatorAsset
      ? (String(creatorAsset.description ?? '').trim() || String(creatorAsset.transcript ?? '').trim() || String(creatorAsset.theme ?? '').trim() || String(item.topic ?? item.title ?? '').trim())
      : '';

    const generatedVariantResult = await runReservedFixedWorkflow({
      userId: user.id,
      companyId,
      action: 'content_basic',
      referenceType: 'activity_platform_variants',
      referenceId: activityDbId || String(item.execution_id || Date.now()),
      note: 'Generated platform variants',
      multiplier: Math.max(1, activePlatformTargets.length || schedules.length || 1),
      executor: async () => {
        let reservedItemWithMaster = item;
        if (!item.master_content && !creatorMasterText) {
          const generatedMaster = await generateMasterContentFromIntent(item);
          await persistMasterToDb(activityDbId, generatedMaster);
          reservedItemWithMaster = { ...item, master_content: generatedMaster };
        } else if (creatorMasterText) {
          reservedItemWithMaster = {
            ...item,
            master_content: {
              id: `creator-${item.execution_id}`,
              generated_at: new Date().toISOString(),
              content: creatorMasterText,
              generation_status: 'generated' as const,
              generation_source: 'creator' as const,
              content_type_mode: 'text' as const,
            },
          };
        }

        const reservedVariants = await buildPlatformVariantsFromMaster(reservedItemWithMaster);
        const reservedSuccessfulVariants = reservedVariants.filter((v) => !isFailedVariant(v));
        if (reservedSuccessfulVariants.length === 0 && reservedVariants.length > 0) {
          const failure = new Error('Platform adaptation failed for all targets.');
          (failure as Error & { code?: string }).code = 'VARIANT_GENERATION_FAILED';
          throw failure;
        }

        await persistVariantsToDb(
          activityDbId,
          reservedSuccessfulVariants as Array<Record<string, unknown>>,
          ((reservedItemWithMaster as any).master_content ?? null) as Record<string, unknown> | null
        );

        return {
          platform_variants: reservedSuccessfulVariants,
          master_content: (reservedItemWithMaster as any).master_content ?? null,
        };
      },
    });

    return res.status(200).json({
      success: true,
      platform_variants: generatedVariantResult.platform_variants,
      master_content: generatedVariantResult.master_content,
    });

    // If no master yet: auto-generate it now (first repurpose button press on any platform).
    // Persist to DB immediately so every subsequent platform repurpose reuses the same master.
    let itemWithMaster = item;
    if (!item.master_content && !creatorMasterText) {
      const generatedMaster = await generateMasterContentFromIntent(item);
      await persistMasterToDb(activityDbId, generatedMaster);
      itemWithMaster = { ...item, master_content: generatedMaster };
    } else if (creatorMasterText) {
      itemWithMaster = {
        ...item,
        master_content: {
          id: `creator-${item.execution_id}`,
          generated_at: new Date().toISOString(),
          content: creatorMasterText,
          generation_status: 'generated' as const,
          generation_source: 'creator' as const,
          content_type_mode: 'text' as const,
        },
      };
    }

    const variants = await buildPlatformVariantsFromMaster(itemWithMaster);

    // Filter out failed/placeholder variants — never return error strings as content
    const successfulVariants = variants.filter((v) => !isFailedVariant(v));
    if (successfulVariants.length === 0 && variants.length > 0) {
      // All variants failed — surface the actual error instead of silently returning garbage
      return res.status(500).json({
        error: 'VARIANT_GENERATION_FAILED',
        message: 'Platform adaptation failed for all targets.',
        master_content: (itemWithMaster as any).master_content,
      });
    }

    await persistVariantsToDb(
      activityDbId,
      successfulVariants as Array<Record<string, unknown>>,
      ((itemWithMaster as any).master_content ?? null) as Record<string, unknown> | null
    );

    if (companyId && successfulVariants.length > 0) {
      // Legacy fallback retained unreachable during migration; reservation wrapper above owns accounting.
    }

    return res.status(200).json({
      success: true,
      platform_variants: successfulVariants,
      // Return master so the client can update its state even if it didn't have one before
      master_content: (itemWithMaster as any).master_content ?? null,
    });
  } catch (error) {
    if (error instanceof MonetizedWorkflowError) {
      return res.status(error.statusCode).json(error.payload);
    }
    if ((error as Error & { code?: string })?.code === 'VARIANT_GENERATION_FAILED') {
      return res.status(500).json({
        error: 'VARIANT_GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'Platform adaptation failed for all targets.',
      });
    }
    console.error('activity-workspace content API error:', error);
    return res.status(500).json({ error: 'Failed to process activity content request' });
  }
}
