/**
 * resolveGenerationExecutionContext — THE authoritative generation input.
 * Phase-2 Step-8.
 *
 * Composes Step-6 unified context + Step-2 routing + Step-4/6 readiness +
 * Step-5 strategy into one object generators read. Read-only, never throws.
 * Legacy inline generator derivations are intentionally NOT removed
 * (compatibility-first, no-breaking-change rules) — this is the canonical
 * authoritative input + observability they should converge onto.
 */

import { resolveUnifiedCampaignContext, getUnifiedCampaignReadiness } from '../context';
import { resolveExecutionRouting } from '../routing';
import { getExecutionItems } from '../canonicalExecutionAdapter';
import { generationDiagnostics } from './generationExecutionContextDiagnostics';
import type {
  GenerationExecutionContext,
  GenerationMode,
  GenerationRouteEntry,
  OwnedContentDirective,
  OwnedContentDirectiveKind,
  ReadinessDirective,
} from './generationExecutionContextTypes';

function modeFromFlowShape(shape: string): GenerationMode {
  switch (shape) {
    case 'strategy-first': return 'STRATEGY_FIRST';
    case 'skeleton-first': return 'SKELETON_FIRST';
    case 'converged': return 'CONVERGED';
    default: return 'EMPTY';
  }
}

function directiveForSourceType(t: string): OwnedContentDirectiveKind {
  switch (t) {
    case 'BLOG_URL': return 'derive_posts_from_blog';
    case 'PDF':
    case 'DOCUMENT':
    case 'DRIVE_LINK': return 'derive_snippets_from_document';
    case 'VIDEO_URL': return 'video_placeholder_workflow';
    default: return 'distribution_from_asset'; // IMAGE / UPLOADED_ASSET / EMBEDDED_ASSET
  }
}

export async function resolveGenerationExecutionContext(
  campaignId: string,
  entrypoint: string,
): Promise<GenerationExecutionContext | null> {
  if (!campaignId) return null;
  const generated_at = new Date().toISOString();

  const unified = await resolveUnifiedCampaignContext(campaignId).catch(() => null);
  if (!unified) {
    generationDiagnostics.fallback({ campaign_id: campaignId, entrypoint, fallback_reason: 'unified_context_unavailable' });
    return null;
  }
  const readiness = await getUnifiedCampaignReadiness(campaignId).catch(() => null);

  // ── Routing decisions per execution slot (centralized, no inline branching)
  const items = await getExecutionItems(campaignId).catch(() => []);
  const routes: GenerationRouteEntry[] = items.map((it) => ({
    execution_id: it.execution_id ?? null,
    platform: it.platform,
    content_type: it.content_type,
    week_id: it.week_id,
    routing: resolveExecutionRouting({
      platform: it.platform,
      content_type: it.content_type,
      asset_type: String(it.metadata?.asset_type ?? '') || undefined,
      campaign_context: { campaign_id: campaignId, execution_id: it.execution_id },
    }),
  }));

  // ── Owned-content directives ──────────────────────────────────────────────
  const ocAll = [
    ...(unified.owned_content_context.reusable_assets ?? []),
    ...(unified.owned_content_context.external_sources ?? []),
    ...(unified.owned_content_context.upload_sources ?? []),
  ] as Array<Record<string, unknown>>;
  const seenOc = new Set<string>();
  const owned_content_directives: OwnedContentDirective[] = [];
  for (const s of ocAll) {
    const id = String(s.source_id ?? '');
    if (!id || seenOc.has(id)) continue;
    seenOc.add(id);
    const stype = String(s.source_type ?? '');
    owned_content_directives.push({
      source_id: id,
      source_type: stype,
      directive: s.reusable === true ? 'prioritize_reuse' : directiveForSourceType(stype),
      reusable: s.reusable === true,
    });
  }

  // ── Readiness directives (readiness-aware generation) ─────────────────────
  const readiness_directives: ReadinessDirective[] = [];
  const blockers = readiness?.blocking_reasons ?? [];
  const hasStrategyBlock = blockers.some((b) => b === 'NO_STRATEGY' || b.startsWith('MISSING_'));
  if (hasStrategyBlock || !unified.metadata.strategy_presence) readiness_directives.push('minimal_skeleton_safe');
  if (routes.some((r) => r.routing.asset_requirement === 'REQUIRED')) readiness_directives.push('pending_upload_workflow');
  if (blockers.some((b) => b.includes('APPROVAL'))) readiness_directives.push('approval_gated');
  if (blockers.includes('NO_ENABLED_PLATFORMS')) readiness_directives.push('restrict_scope');
  if (owned_content_directives.length > 0) readiness_directives.push('prioritize_reuse');
  if (readiness_directives.length === 0) readiness_directives.push('proceed');

  const fallbacks: string[] = [];
  if (!readiness) fallbacks.push('readiness_unavailable');
  if (items.length === 0) fallbacks.push('no_execution_items');
  if (unified.metadata.resolution_source.length === 0) fallbacks.push('no_resolution_sources');

  const generation_mode = modeFromFlowShape(unified.metadata.flow_shape);

  const ctx: GenerationExecutionContext = {
    campaign_id: campaignId,
    generation_mode,
    unified,
    readiness: readiness ?? {
      ready: false, readiness_score: 0,
      components: {
        strategy: { score: 0, blockers: [] }, execution: { score: 0, blockers: [] },
        scheduling: { score: 0, blockers: [] }, owned_content: { score: 100, blockers: [] },
        platform: { score: 0, blockers: [] },
      },
      blocking_reasons: ['READINESS_UNAVAILABLE'], generated_at,
    },
    routes,
    owned_content_directives,
    readiness_directives,
    fallbacks,
    metadata: {
      entrypoint,
      resolution_sources: unified.metadata.resolution_source,
      flow_shape: unified.metadata.flow_shape,
      route_count: routes.length,
      owned_content_count: owned_content_directives.length,
      generated_at,
    },
  };

  // ── Observability ─────────────────────────────────────────────────────────
  generationDiagnostics.authoritative({
    campaign_id: campaignId, entrypoint,
    resolution_sources: ctx.metadata.resolution_sources,
    route_count: ctx.metadata.route_count,
  });
  generationDiagnostics.mode({ campaign_id: campaignId, entrypoint, generation_mode, flow_shape: ctx.metadata.flow_shape });
  generationDiagnostics.route({
    campaign_id: campaignId, entrypoint,
    routing_decisions: routes.slice(0, 25).map((r) => ({
      execution_id: r.execution_id, platform: r.platform, content_type: r.content_type,
      execution_type: r.routing.execution_type, workflow_type: r.routing.workflow_type,
      asset_requirement: r.routing.asset_requirement,
    })),
    route_count: routes.length,
  });
  generationDiagnostics.readiness({
    campaign_id: campaignId, entrypoint,
    readiness_score: ctx.readiness.readiness_score,
    blocking_reasons: ctx.readiness.blocking_reasons,
    readiness_directives,
  });
  if (owned_content_directives.length > 0) {
    generationDiagnostics.ownedContent({
      campaign_id: campaignId, entrypoint,
      owned_content_usage: owned_content_directives.map((d) => ({ source_type: d.source_type, directive: d.directive })),
    });
  }
  if (fallbacks.length > 0) {
    generationDiagnostics.fallback({ campaign_id: campaignId, entrypoint, fallback_reason: fallbacks.join(',') });
  }
  return ctx;
}

export const generationExecutionContextResolver = {
  resolveGenerationExecutionContext,
};
