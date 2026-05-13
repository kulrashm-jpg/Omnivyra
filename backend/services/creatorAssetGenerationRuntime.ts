import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { getExecutionEngine } from './executionEngines';
import { renderAsset } from './creatorAssetRenderer';
import { validateAssetReadiness } from './creatorAssetValidationService';
import { validateCreatorExecutionOutput } from './creatorExecutionContracts';
import type { CanonicalCreatorOutput } from './executionEngines/types';
import {
  getCreatorGovernance,
  normalizeCreatorFormat,
  supportsAutonomousExecution,
} from '../../lib/shared/creatorGovernanceRegistry';

type DailyPlanRow = {
  id: string;
  campaign_id: string;
  week_number?: number | null;
  day_of_week?: string | null;
  date?: string | null;
  platform?: string | null;
  content_type?: string | null;
  title?: string | null;
  topic?: string | null;
  content?: unknown;
  content_status?: string | null;
  intent_type?: string | null;
  asset_type?: string | null;
  template_id?: string | null;
  plan_version?: number | null;
  retry_count?: number | null;
  max_retries?: number | null;
  failure_reason?: string | null;
  failure_type?: string | null;
};

export type CreatorAssetGenerationMode = 'SCHEDULE_AND_RENDER' | 'RENDER_ONLY' | 'GUIDANCE_ONLY';

export type CreatorAssetGenerationResult = {
  mode: CreatorAssetGenerationMode;
  rendered_count: number;
  guidance_ready_count: number;
  skipped_count: number;
  failed_count: number;
  final_status: 'render_ready' | 'guidance_ready' | 'partially_rendered' | 'render_failed';
};

function safeObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hashAsset(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function mergeRenderedMedia(output: CanonicalCreatorOutput, rendered: Awaited<ReturnType<typeof renderAsset>>): CanonicalCreatorOutput {
  const payload = safeObject(output.asset_payload);
  const mediaBundle = safeObject(payload.media_bundle);
  return {
    ...output,
    asset_payload: {
      ...payload,
      media_bundle: {
        ...mediaBundle,
        ...(rendered.url ? { url: rendered.url } : {}),
        ...(Array.isArray(rendered.files) && rendered.files.length > 0 ? { files: rendered.files } : {}),
        metadata: {
          ...safeObject(mediaBundle.metadata),
          ...safeObject(rendered.metadata),
          render_only: true,
          export_ready: Boolean(rendered.url || (Array.isArray(rendered.files) && rendered.files.length > 0)),
        },
      },
    },
  };
}

function extractMediaUrls(output: CanonicalCreatorOutput): string[] {
  const payload = safeObject(output.asset_payload);
  const mediaBundle = safeObject(payload.media_bundle);
  return [
    typeof mediaBundle.url === 'string' ? mediaBundle.url : '',
    ...(Array.isArray(mediaBundle.files) ? mediaBundle.files.map(String) : []),
  ].map((value) => value.trim()).filter(Boolean);
}

async function persistCreatorAsset(input: {
  campaignId: string;
  companyId: string;
  userId: string;
  row: DailyPlanRow;
  output: CanonicalCreatorOutput;
}): Promise<string | null> {
  const mediaBundle = safeObject(safeObject(input.output.asset_payload).media_bundle);
  const urls = extractMediaUrls(input.output);
  const assetHash = hashAsset({
    row: input.row.id,
    asset_type: input.output.asset_type,
    payload: input.output.asset_payload,
    caption: input.output.packaging.caption,
  });
  const assetId = `bolt-render-${input.row.id}-${assetHash.slice(0, 16)}`;
  const title = String(input.row.topic || input.row.title || input.output.metadata.topic || 'Creator asset').trim();

  const { error } = await ownedDbTable('creator_assets')
    .upsert({
      id: assetId,
      tenant_id: input.companyId,
      company_id: input.companyId,
      user_id: input.userId,
      source_type: null,
      source_id: input.row.id,
      creator_type: String(input.row.content_type || input.output.metadata.content_type || input.output.asset_type),
      title,
      url: urls[0] ?? null,
      files: urls,
      preview_kind: String(safeObject(mediaBundle.metadata).preview_kind || input.output.asset_type),
      platform_context: String(input.row.platform || input.output.metadata.platform_variant || ''),
      metadata: {
        ...safeObject(mediaBundle.metadata),
        campaign_id: input.campaignId,
        daily_plan_id: input.row.id,
        content_type: input.row.content_type,
        asset_type: input.output.asset_type,
        render_only: true,
        export_ready: urls.length > 0,
      },
      source_content: input.output,
      render_identity_hash: assetHash,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) {
    console.warn('[creator-render-only][asset-persist-failed]', {
      daily_plan_id: input.row.id,
      message: error.message,
    });
    return null;
  }
  return assetId;
}

async function markGuidanceReady(row: DailyPlanRow): Promise<void> {
  const parsed = safeObject(row.content);
  await ownedDbTable('daily_content_plans')
    .update({
      content: JSON.stringify({
        ...parsed,
        render_policy: {
          mode: 'guidance_only',
          skipped_reason: 'skipped_due_to_guidance_only_policy',
        },
        content_status: 'guidance_ready',
      }),
      content_status: 'guidance_ready',
      failure_reason: null,
      failure_type: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
}

export async function runCreatorAssetGenerationRuntime(input: {
  campaignId: string;
  companyId: string | null;
  userId?: string | null;
  mode: CreatorAssetGenerationMode;
  onProgress?: (stage: string) => void;
}): Promise<CreatorAssetGenerationResult> {
  const { data: campaign, error: campaignError } = await ownedDbTable('campaigns')
    .select('id, user_id, company_id')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (campaignError || !campaign) {
    throw new Error(`Campaign not found for creator asset generation: ${input.campaignId}`);
  }

  const companyId = String(input.companyId || (campaign as any).company_id || '').trim();
  let userId = String(input.userId || (campaign as any).user_id || '').trim();
  if (!userId && companyId) {
    const { data: companyUser } = await ownedDbTable('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    userId = String((companyUser as any)?.user_id || '').trim();
  }
  if (!companyId || !userId) {
    throw new Error('Creator asset generation requires company_id and user_id');
  }

  const { data, error } = await ownedDbTable('daily_content_plans')
    .select('id, campaign_id, week_number, day_of_week, date, platform, content_type, title, topic, content, content_status, intent_type, asset_type, template_id, plan_version, retry_count, max_retries, failure_reason, failure_type')
    .eq('campaign_id', input.campaignId)
    .order('date', { ascending: true })
    .order('week_number', { ascending: true });
  if (error) throw new Error(`Failed to load creator daily plans: ${error.message}`);

  const rows = Array.isArray(data) ? data as DailyPlanRow[] : [];
  const engine = getExecutionEngine('creator');
  let renderedCount = 0;
  let guidanceReadyCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const contentType = normalizeCreatorFormat(row.content_type || '');
    const governance = getCreatorGovernance(contentType);
    if (!governance || governance.guidance_only || governance.daily_plan_only || !governance.ai_renderable) {
      if (governance?.guidance_only || governance?.daily_plan_only) {
        await markGuidanceReady(row);
        guidanceReadyCount++;
      } else {
        skippedCount++;
      }
      continue;
    }
    if (!supportsAutonomousExecution(contentType)) {
      skippedCount++;
      continue;
    }

    const parsed = safeObject(row.content);
    const creatorCard = safeObject(parsed.creator_card);
    const maxRetries = Math.max(1, Number(row.max_retries ?? 3) || 3);
    let lastError: Error | null = null;
    input.onProgress?.(`render-creator-${contentType}`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const generated = await (engine as any).generateFromIntent({
          campaignId: input.campaignId,
          companyId,
          userId,
          topic: String(row.topic || row.title || parsed.topic || 'Creator asset'),
          contentType,
          targetPlatforms: [String(row.platform || parsed.platform || 'linkedin').toLowerCase()],
          audience: String(parsed.whoAreWeWritingFor ?? parsed.target_audience ?? creatorCard.target_audience ?? ''),
          objective: String(parsed.dailyObjective ?? parsed.objective ?? creatorCard.objective ?? ''),
          summary: String(parsed.summary ?? parsed.whatProblemAreWeAddressing ?? creatorCard.summary ?? ''),
          creatorCard,
          enrichedIntent: parsed,
          templateId: typeof parsed.template_id === 'string' ? parsed.template_id : row.template_id ?? null,
          existingContent: parsed,
        }, { companyId }, {
          assetOverride: safeObject(parsed.asset_payload || parsed.creator_asset),
        }) as CanonicalCreatorOutput;

        const generatedValidation = validateCreatorExecutionOutput(generated);
        if (!generatedValidation.ok) {
          throw new Error(`Generated creator output failed validation: ${generatedValidation.issues.join('; ')}`);
        }
        const adapted = await (engine as any).adaptForPlatform(generated, String(row.platform || 'linkedin').toLowerCase()) as CanonicalCreatorOutput;
        const rendered = await renderAsset(safeObject(adapted.asset_payload), {
          campaignId: input.campaignId,
          userId,
          companyId,
        });
        const renderedOutput = mergeRenderedMedia(adapted, rendered);
        const readiness = await validateAssetReadiness({
          output: renderedOutput,
          platform: String(row.platform || 'linkedin').toLowerCase(),
        });
        const creatorAssetId = await persistCreatorAsset({
          campaignId: input.campaignId,
          companyId,
          userId,
          row,
          output: renderedOutput,
        });

        await ownedDbTable('daily_content_plans')
          .update({
            content: JSON.stringify({
              ...parsed,
              ...renderedOutput,
              render_policy: { mode: 'render_only' },
              creator_asset_id: creatorAssetId,
              rendered_asset: {
                creator_asset_id: creatorAssetId,
                urls: extractMediaUrls(renderedOutput),
                metadata: safeObject(safeObject(renderedOutput.asset_payload).media_bundle).metadata ?? {},
                readiness,
                rendered_at: new Date().toISOString(),
                export_ready: readiness.ready,
              },
              content_status: readiness.ready ? 'render_ready' : 'render_failed',
            }),
            intent_type: 'creator',
            asset_type: renderedOutput.asset_type,
            template_id: renderedOutput.asset_instruction.template_id ?? row.template_id ?? null,
            retry_count: attempt,
            max_retries: maxRetries,
            failure_reason: readiness.ready ? null : readiness.failure_reason,
            failure_type: readiness.ready ? null : 'permanent',
            content_status: readiness.ready ? 'render_ready' : 'render_failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        if (readiness.ready) renderedCount++;
        else failedCount++;
        lastError = null;
        break;
      } catch (error) {
        lastError = error as Error;
        if (attempt + 1 >= maxRetries) {
          await ownedDbTable('daily_content_plans')
            .update({
              retry_count: maxRetries,
              max_retries: maxRetries,
              failure_reason: lastError.message,
              failure_type: 'transient',
              content_status: 'render_failed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          failedCount++;
        }
      }
    }
    if (lastError) {
      console.warn('[creator-render-only][row-failed]', {
        daily_plan_id: row.id,
        content_type: contentType,
        message: lastError.message,
      });
    }
  }

  const finalStatus =
    renderedCount > 0 && guidanceReadyCount > 0 && failedCount === 0
      ? 'partially_rendered'
      : renderedCount > 0 && failedCount === 0
      ? 'render_ready'
      : renderedCount > 0 && failedCount > 0
        ? 'partially_rendered'
        : renderedCount === 0 && guidanceReadyCount > 0 && failedCount === 0
          ? 'guidance_ready'
          : 'render_failed';

  return {
    mode: input.mode,
    rendered_count: renderedCount,
    guidance_ready_count: guidanceReadyCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
    final_status: finalStatus,
  };
}
