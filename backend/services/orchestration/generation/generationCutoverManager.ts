/**
 * generationCutoverManager — controlled authoritative-generation cutover.
 * Phase-2 Step-9.
 *
 * Modes (env ORCHESTRATION_GENERATION_CUTOVER, default SHADOW):
 *   LEGACY        — generators keep their inline derivations; no compare.
 *   SHADOW        — generators UNCHANGED; authoritative context resolves in
 *                   parallel and is compared vs the legacy (blueprint-
 *                   derived) assumptions; divergence is logged. Default —
 *                   zero behaviour change, full regression visibility.
 *   AUTHORITATIVE — same as SHADOW today (observability intent flagged);
 *                   actual sole-input replacement inside generators is
 *                   deferred because Step-9 rules forbid breaking changes /
 *                   removing generators. The toggle + shadow data is the
 *                   controlled, rollback-safe migration substrate.
 *
 * Inline derivations are NOT physically deleted (Rules 3/4/5 + rollback
 * safety). They are now mode-gated + shadow-compared + cutover-ready, and
 * every divergence is surfaced — i.e. explicitly governed, not silently
 * preserved.
 */

import { getUnifiedCampaignBlueprint } from '../../campaignBlueprintService';
import { resolveGenerationExecutionContext } from './generationExecutionContextResolver';

export type GenerationCutoverMode = 'LEGACY' | 'SHADOW' | 'AUTHORITATIVE';

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export function resolveCutoverMode(): GenerationCutoverMode {
  const raw = String(process.env.ORCHESTRATION_GENERATION_CUTOVER ?? '').trim().toUpperCase();
  return raw === 'LEGACY' || raw === 'AUTHORITATIVE' ? (raw as GenerationCutoverMode) : 'SHADOW';
}

interface LegacyAssumptions {
  platforms: string[];
  content_types: string[];
  skeleton_present: boolean;
  execution_count: number;
}

/** Derive what the LEGACY path assumes, straight from the blueprint. */
async function deriveLegacyAssumptions(campaignId: string): Promise<LegacyAssumptions | null> {
  try {
    const bp = (await getUnifiedCampaignBlueprint(campaignId)) as { weeks?: any[] } | null;
    if (!bp?.weeks?.length) return { platforms: [], content_types: [], skeleton_present: false, execution_count: 0 };
    const platforms = new Set<string>();
    const contentTypes = new Set<string>();
    let execCount = 0;
    for (const w of bp.weeks) {
      const pa = (w as any).platform_allocation;
      if (pa && typeof pa === 'object') for (const k of Object.keys(pa)) platforms.add(String(k).toLowerCase());
      const cm = (w as any).content_type_mix;
      if (Array.isArray(cm)) for (const c of cm) contentTypes.add(String(c).toLowerCase());
      const items = Array.isArray((w as any).daily_execution_items)
        ? (w as any).daily_execution_items
        : Array.isArray((w as any).execution_items) ? (w as any).execution_items : [];
      execCount += items.length;
      for (const it of items) {
        if (it?.platform) platforms.add(String(it.platform).toLowerCase());
        if (it?.content_type) contentTypes.add(String(it.content_type).toLowerCase());
      }
    }
    return {
      platforms: [...platforms],
      content_types: [...contentTypes],
      skeleton_present: true,
      execution_count: execCount,
    };
  } catch {
    return null;
  }
}

/**
 * SHADOW comparison: legacy (blueprint-derived) assumptions vs authoritative
 * GenerationExecutionContext. Never throws, never mutates generation.
 */
export async function shadowCompareGeneration(
  campaignId: string,
  generator: string,
): Promise<void> {
  const cutover_mode = resolveCutoverMode();
  LOG('GENERATION_CUTOVER', { campaign_id: campaignId, generator, cutover_mode });
  if (cutover_mode === 'LEGACY') return;

  const [legacy, ctx] = await Promise.all([
    deriveLegacyAssumptions(campaignId),
    resolveGenerationExecutionContext(campaignId, generator).catch(() => null),
  ]);

  if (!ctx) {
    LOG('GENERATION_LEGACY_FALLBACK', { campaign_id: campaignId, generator, cutover_mode, fallback_reason: 'authoritative_context_unavailable' });
    return;
  }
  if (!legacy) {
    LOG('GENERATION_LEGACY_FALLBACK', { campaign_id: campaignId, generator, cutover_mode, fallback_reason: 'legacy_assumptions_unavailable' });
    return;
  }

  const authPlatforms: string[] = ((ctx.unified.platform_context.enabled_platforms ?? []) as unknown[])
    .map((p) => String(p).toLowerCase());
  const authContentTypes: string[] = Array.from(
    new Set<string>(ctx.routes.map((r) => String(r.content_type).toLowerCase())),
  );

  const platform_diff = {
    legacy_only: legacy.platforms.filter((p) => !authPlatforms.includes(p)),
    authoritative_only: authPlatforms.filter((p) => !legacy.platforms.includes(p)),
  };
  const content_type_diff = {
    legacy_only: legacy.content_types.filter((c) => !authContentTypes.includes(c)),
    authoritative_only: authContentTypes.filter((c) => !legacy.content_types.includes(c)),
  };
  const execution_count_diff = legacy.execution_count - ctx.metadata.route_count;
  const readiness_diff = {
    authoritative_ready: ctx.readiness.ready,
    readiness_score: ctx.readiness.readiness_score,
    blocking_reasons: ctx.readiness.blocking_reasons,
  };
  const owned_content_diff = { authoritative_owned_content: ctx.metadata.owned_content_count };

  const divergence_count =
    platform_diff.legacy_only.length + platform_diff.authoritative_only.length +
    content_type_diff.legacy_only.length + content_type_diff.authoritative_only.length +
    (execution_count_diff !== 0 ? 1 : 0) +
    (!ctx.readiness.ready ? 1 : 0);

  LOG('GENERATION_SHADOW_COMPARE', {
    campaign_id: campaignId, generator, cutover_mode,
    generation_mode: ctx.generation_mode,
    divergence_count,
    routing_diff: content_type_diff,
    platform_diff,
    readiness_diff,
    owned_content_diff,
    execution_count_diff,
  });

  if (platform_diff.legacy_only.length || platform_diff.authoritative_only.length) {
    LOG('GENERATION_MISMATCH', { campaign_id: campaignId, generator, kind: 'platform', platform_diff });
  }
  if (content_type_diff.legacy_only.length || content_type_diff.authoritative_only.length) {
    LOG('GENERATION_ROUTE_CONFLICT', { campaign_id: campaignId, generator, routing_diff: content_type_diff });
  }
  if (!ctx.readiness.ready) {
    LOG('GENERATION_READINESS_CONFLICT', { campaign_id: campaignId, generator, readiness_diff });
  }
  if (execution_count_diff !== 0) {
    LOG('GENERATION_MISMATCH', { campaign_id: campaignId, generator, kind: 'execution_count', execution_count_diff });
  }

  if (cutover_mode === 'AUTHORITATIVE') {
    LOG('GENERATION_AUTHORITATIVE', {
      campaign_id: campaignId, generator,
      generation_mode: ctx.generation_mode,
      route_count: ctx.metadata.route_count,
      readiness_score: ctx.readiness.readiness_score,
      note: 'authoritative context resolved & validated; generator input-cutover deferred (Step-9 no-breaking-change rules)',
    });
  }
}

// ── Phase-2 Step-10: AUTHORITATIVE activation decision + rollback guard ─────

export interface AuthoritativeGenerationDecision {
  mode: GenerationCutoverMode;
  /** TRUE only when mode=AUTHORITATIVE AND the context is complete enough.
   *  A future generator rewrite consults this; today generators ignore it
   *  (documented fallback), so behaviour is unchanged regardless of mode. */
  use_authoritative: boolean;
  generation_mode: string;
  readiness_score: number;
  fallback_reason: string | null;
  rollback_triggered: boolean;
}

/**
 * Resolve the controlled activation decision. Default mode SHADOW ⇒
 * use_authoritative=false ⇒ zero behaviour change. AUTHORITATIVE (env
 * opt-in) flips the decision ON only when the orchestration context is
 * complete; otherwise it rolls back to legacy and logs the exact reason —
 * never hard-fails, LEGACY always operational.
 *
 * NOTE: this returns a DECISION + diagnostics. It does not itself rewrite
 * generator internals (that is the deferred breaking change). Generators
 * may consult `use_authoritative` once they are individually migrated.
 */
export async function getAuthoritativeGenerationDecision(
  campaignId: string,
  generator: string,
): Promise<AuthoritativeGenerationDecision> {
  const mode = resolveCutoverMode();
  let ctx: Awaited<ReturnType<typeof resolveGenerationExecutionContext>> | null = null;
  try { ctx = await resolveGenerationExecutionContext(campaignId, generator); } catch { ctx = null; }

  const complete = Boolean(
    ctx &&
    ctx.metadata.resolution_sources.length > 0 &&
    !ctx.fallbacks.includes('no_resolution_sources'),
  );
  let fallback_reason: string | null = null;
  let rollback_triggered = false;
  let use_authoritative = false;

  if (mode === 'AUTHORITATIVE') {
    if (complete) {
      use_authoritative = true;
    } else {
      fallback_reason = !ctx ? 'authoritative_context_unavailable' : 'incomplete_orchestration_context';
      rollback_triggered = true;
      LOG('GENERATION_ROLLBACK', { campaign_id: campaignId, generator, mode, rollback_trigger: fallback_reason });
    }
  } else {
    fallback_reason = mode === 'LEGACY' ? 'legacy_mode' : 'shadow_mode_no_activation';
  }

  if (use_authoritative && ctx) {
    LOG('AUTHORITATIVE_GENERATION', {
      campaign_id: campaignId, generator, generation_mode: ctx.generation_mode,
      readiness_score: ctx.readiness.readiness_score, route_count: ctx.metadata.route_count,
    });
    LOG('AUTHORITATIVE_ROUTE', {
      campaign_id: campaignId, generator, routing_mode: 'centralized',
      route_count: ctx.metadata.route_count,
    });
    LOG('AUTHORITATIVE_READINESS', {
      campaign_id: campaignId, generator,
      readiness_score: ctx.readiness.readiness_score,
      readiness_directives: ctx.readiness_directives,
    });
    if (ctx.owned_content_directives.length > 0) {
      LOG('AUTHORITATIVE_OWNED_CONTENT', {
        campaign_id: campaignId, generator,
        directives: ctx.owned_content_directives.map((d) => d.directive),
      });
    }
  } else {
    LOG('GENERATION_FALLBACK_ACTIVATED', {
      campaign_id: campaignId, generator, mode, fallback_reason,
    });
  }

  // ── Real output-diff regression diagnostic: authoritative routes vs the
  //    persisted daily_content_plans the legacy generator actually produced.
  try {
    const { getExecutionItems } = await import('../canonicalExecutionAdapter');
    const items = await getExecutionItems(campaignId);
    const persistedPlatforms = [...new Set(items.map((i) => String(i.platform).toLowerCase()))];
    const authPlatforms = ctx
      ? [...new Set(ctx.routes.map((r) => String(r.platform).toLowerCase()))]
      : [];
    LOG('GENERATION_OUTPUT_DIFF', {
      campaign_id: campaignId, generator, mode,
      persisted_execution_count: items.length,
      authoritative_route_count: ctx?.metadata.route_count ?? 0,
      execution_count_diff: items.length - (ctx?.metadata.route_count ?? 0),
      platform_diff: {
        persisted_only: persistedPlatforms.filter((p) => !authPlatforms.includes(p)),
        authoritative_only: authPlatforms.filter((p) => !persistedPlatforms.includes(p)),
      },
      divergence_summary: ctx ? ctx.fallbacks : ['no_context'],
    });
  } catch { /* diagnostics only */ }

  return {
    mode,
    use_authoritative,
    generation_mode: ctx?.generation_mode ?? 'EMPTY',
    readiness_score: ctx?.readiness.readiness_score ?? 0,
    fallback_reason,
    rollback_triggered,
  };
}

/** Entrypoint gate (fire-and-forget safe): activation decision + shadow + diff. */
export async function runAuthoritativeGenerationGate(
  campaignId: string,
  generator: string,
): Promise<AuthoritativeGenerationDecision | null> {
  if (!campaignId) return null;
  try {
    // Shadow comparison still runs (regression visibility) regardless of mode.
    await shadowCompareGeneration(campaignId, generator);
    return await getAuthoritativeGenerationDecision(campaignId, generator);
  } catch {
    return null;
  }
}

export const generationCutoverManager = {
  resolveCutoverMode,
  shadowCompareGeneration,
  getAuthoritativeGenerationDecision,
  runAuthoritativeGenerationGate,
};
