import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { resolveCompanyGroundingGuard } from '../../../backend/services/context/canonicalContentContextResolver';
// P2 — canonical campaign grounding (pure resolver + prompt sections).
import { resolveGenerationContext, buildGroundedContextBlock } from '../../../lib/campaign/generationContext';
import { resolveCampaignCompanyId } from '../../../backend/services/campaignAccessService';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * POST /api/planner/generate-workspace-content
 * Generates platform-specific content variants for the Activity Workspace Drawer.
 * Each variant is structurally formatted for its platform (hook, body, CTA, hashtags).
 *
 * PMF-001 — the Content Writer inference is migrated onto the canonical platform.
 * Runtime is selected by the reversible CONTENT_WRITER_RUNTIME flag:
 *   legacy   → the original inference path (unchanged).
 *   platform → CKC-001 knowledge + AIC-001 executeCapability.
 *   dual     → serve legacy, shadow-run platform for parity validation.
 * The prompt is single-sourced in backend/services/contentWriter/workspaceContentPrompt
 * (no duplicate prompt assembly); post-processing (processContent) is shared by both.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { buildCompanyContext } from '../../../backend/services/companyContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import { processContent } from '../../../backend/services/unifiedContentProcessor';
import { getCreditCost } from '../../../backend/services/creditDeductionService';
// CAMPAIGN-IMPL-005 — canonical AI execution runtime (idempotency, resume,
// credit recovery, user-language errors) replaces inline billing wiring.
import { runAiExecution } from '../../../backend/services/ai/aiExecutionRuntime';
// PMF-001 — single prompt source + migrated runtime + reversible flag.
import {
  WORKSPACE_SYSTEM_PROMPT, buildWorkspaceUserPrompt, buildContextLines,
} from '../../../backend/services/contentWriter/workspaceContentPrompt';
import {
  getContentWriterRuntimeMode, servedRuntime,
} from '../../../backend/services/contentWriter/contentWriterMigrationFlag';
import {
  generateWorkspaceVariants, recordContentWriterRuntime, compareVariantParity,
} from '../../../backend/services/contentWriter/contentWriterCapability';

/**
 * P2 — load the campaign's own planner_state (the canonical server-side
 * strategy/skeleton snapshot the release seam also reads). Read-only; a
 * missing or unreadable snapshot yields null, which the resolver turns into a
 * structured MISSING_SKELETON_CONTEXT rather than ungrounded generation.
 */
async function loadPlannerState(campaignId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await supabase
      .from('campaign_versions')
      .select('campaign_snapshot')
      .eq('campaign_id', campaignId)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const snapshot = (data as { campaign_snapshot?: Record<string, unknown> } | null)?.campaign_snapshot;
    const plannerState = snapshot?.planner_state;
    return plannerState && typeof plannerState === 'object'
      ? (plannerState as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId, topic, platforms, contentTypes, theme, objective, week, activity_key, attempt,
      // P2 — canonical grounding identifiers. The client names WHICH slot; the
      // server resolves WHAT that slot means. No strategy is accepted from the
      // browser (see resolveCampaignGrounding below).
      campaignId: bodyCampaignId, slot_id: bodySlotId,
    } = req.body || {};

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'topic is required' });
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms array is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    // Credit check — 1 content_basic per platform requested
    const platformCount = (platforms as string[]).length;
    const contentBasicCost = await getCreditCost('content_basic');
    const contentTypeMap = contentTypes as Record<string, string> | undefined;

    // Load company profile for brand context (legacy knowledge path).
    const profile = await getProfile(companyId.trim(), { autoRefine: false, languageRefine: false });
    let brandContext = '';
    if (profile) {
      const ctx = buildCompanyContext(profile);
      const parts: string[] = [];
      if (ctx.identity.name) parts.push(`Company: ${ctx.identity.name}`);
      if (ctx.identity.industry) parts.push(`Industry: ${ctx.identity.industry}`);
      if (ctx.brand.unique_value) parts.push(`Value proposition: ${ctx.brand.unique_value}`);
      if (ctx.brand.brand_voice) parts.push(`Tone of voice: ${ctx.brand.brand_voice}`);
      if (ctx.customer.target_audience) parts.push(`Target audience: ${ctx.customer.target_audience}`);
      if (ctx.brand.key_messages) parts.push(`Key messages: ${ctx.brand.key_messages}`);
      brandContext = parts.join('\n');
    }

    // ── P2 — server-side canonical grounding ─────────────────────────────
    // When the caller names a campaign slot, the campaign's OWN planner_state
    // is the sole source of strategy/structure/slot context. Three guards, in
    // order, make cross-campaign grounding impossible:
    //   1. the campaign must belong to the authorized company (tenancy)
    //   2. the slot must exist in THAT campaign's plan (resolver)
    //   3. any client-asserted platform must match the slot's own platform
    // A named-but-unresolvable slot is a STRUCTURED FAILURE, never a silent
    // fallback to generic generation.
    let groundedContext: string | null = null;
    const campaignIdIn = typeof bodyCampaignId === 'string' ? bodyCampaignId.trim() : '';
    const slotIdIn = typeof bodySlotId === 'string' ? bodySlotId.trim() : '';
    if (campaignIdIn && slotIdIn) {
      const owningCompanyId = await resolveCampaignCompanyId(campaignIdIn);
      if (!owningCompanyId || owningCompanyId !== companyId.trim()) {
        return res.status(403).json({
          code: 'CAMPAIGN_NOT_IN_COMPANY',
          error: 'That campaign does not belong to this company.',
        });
      }
      const plannerState = await loadPlannerState(campaignIdIn);
      const resolved = resolveGenerationContext({
        campaignId: campaignIdIn,
        plannerState,
        slotId: slotIdIn,
        platform: (platforms as string[]).length === 1 ? (platforms as string[])[0] : null,
      });
      if (!resolved.ok || !resolved.context) {
        return res.status(409).json({
          code: resolved.code ?? 'GENERATION_CONTEXT_UNRESOLVED',
          error: resolved.message ?? 'Could not resolve campaign context for this slot.',
        });
      }
      groundedContext = buildGroundedContextBlock(resolved.context);
      // Diagnosable without logging content (existing console/telemetry only).
      console.info('[generate-workspace-content][grounded]', {
        campaign_id: campaignIdIn,
        slot_id: slotIdIn,
        week: resolved.context.slot.week,
        platform: resolved.context.slot.platform,
        content_type: resolved.context.slot.content_type,
        assets: resolved.context.assets.length,
      });
    }

    // Prompt (single-sourced; identical strings to the pre-migration inline build).
    const contextLines = buildContextLines({ theme, objective, week });
    const grounding = await resolveCompanyGroundingGuard(companyId);
    const systemPrompt = WORKSPACE_SYSTEM_PROMPT + '\n\n' + grounding.directive;
    const userPrompt = buildWorkspaceUserPrompt({
      brandContext, contextLines, platforms: platforms as string[], topic, contentTypes: contentTypeMap,
      groundedContext,
    });

    // Phase 8G-A — credit-economy shadow (dark, fire-and-forget; never blocks/mutates).
    void import('../../../backend/services/billing/creditEconomyShadow')
      .then((m) => m.emitCreditEconomyShadowEvaluation({ organizationId: companyId.trim(), activity: 'content_basic', surface: 'route.generate-workspace-content', dedupeKey: `${companyId.trim()}:${topic.trim()}:${(platforms as string[]).join(',')}` }))
      .catch(() => {});

    // CAMPAIGN-IMPL-005 — logical operation identity. When the caller names
    // its target (activity_key = planner slot id) the key is SLOT-scoped, so
    // two slots sharing a topic never collide; `attempt` distinguishes an
    // EXPLICIT regenerate from an accidental duplicate (double-click /
    // refresh / retry → same attempt → resume). Callers without activity_key
    // (legacy drawer) keep the pre-IMPL-005 composition byte-identically.
    const activityKey = typeof activity_key === 'string' && activity_key.trim() ? activity_key.trim().slice(0, 120) : null;
    const attemptToken = typeof attempt === 'string' && attempt.trim() ? attempt.trim().slice(0, 60) : null;
    const referenceId = activityKey
      ? `${companyId.trim()}:${activityKey}${attemptToken ? `:${attemptToken}` : ''}`
      : `${companyId.trim()}:${topic.trim()}:${(platforms as string[]).join(',')}`;

    // Shared post-processing (identical for legacy + platform runtimes).
    const applyProcessing = async (rawVariants: Record<string, string>): Promise<Record<string, string>> => {
      const variants: Record<string, string> = {};
      await Promise.all(
        Object.entries(rawVariants).map(async ([platform, content]) => {
          const ct = (contentTypeMap?.[platform] ?? 'post').toLowerCase();
          const processed = await processContent({ content, platform, content_type: ct, card_type: 'platform_variant' });
          variants[platform] = processed.content;
        })
      );
      return variants;
    };

    // Legacy raw generation — the original inference path (unchanged behavior).
    const legacyGenerateRaw = async (): Promise<Record<string, string>> => {
      const result = await runCompletionWithOperation({
        companyId,
        model: 'gpt-4o-mini',
        temperature: 0.72,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        operation: 'generatePlatformVariants',
      });
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
      const rawVariants: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') rawVariants[k.toLowerCase()] = v;
      }
      return rawVariants;
    };

    const workspaceExecutor = async () => {
      const mode = getContentWriterRuntimeMode();
      const served = servedRuntime(mode);
      recordContentWriterRuntime(served, { platforms: String(platformCount) });

      let rawVariants: Record<string, string>;
      if (served === 'platform') {
        // AIC-001 — the canonical runtime, CKC-001 knowledge, exact legacy prompt/model.
        const r = await generateWorkspaceVariants({
          companyId: companyId.trim(), userId: access.userId, topic,
          platforms: platforms as string[], contentTypes: contentTypeMap,
          theme, objective, week, groundedContext, correlationId: referenceId,
        });
        rawVariants = r.variants;
      } else {
        rawVariants = await legacyGenerateRaw();
      }

      // Dual-run validation — shadow the platform path and log parity (served = legacy).
      if (mode === 'dual') {
        void generateWorkspaceVariants({
          companyId: companyId.trim(), userId: access.userId, topic,
          platforms: platforms as string[], contentTypes: contentTypeMap,
          theme, objective, week, groundedContext, correlationId: referenceId,
        })
          .then((p) => { try { console.info('[content-writer:dual-parity]', compareVariantParity(rawVariants, p.variants)); } catch { /* noop */ } })
          .catch(() => {});
      }

      return applyProcessing(rawVariants);
    };

    // Phase 11D — admission boundary before billing. Dark by default
    // (passthrough; no wallet read). On a future enforce-block, surface 402.
    try {
      await (await import('../../../backend/services/billing/admissionControl')).evaluateActivityAdmission({
        organizationId: companyId.trim(),
        activity:       'content_basic',
        surface:        'route.generate-workspace-content',
        referenceId:    `${companyId.trim()}:${topic.trim()}`,
      });
    } catch (admErr: any) {
      if (admErr?.name === 'AdmissionBlockedError') {
        return res.status(402).json({ error: 'Insufficient credits to generate content', required: admErr.decision?.requiredCredits, balance: admErr.decision?.effectiveCredits, code: 'ADMISSION_BLOCKED' });
      }
      throw admErr;
    }
    // CAMPAIGN-IMPL-005 — the canonical AI execution runtime owns the
    // lifecycle: reservation, execution, result persistence, RESUME on
    // settled keys, deterministic retry on released keys, and user-language
    // blocking. Internal ledger vocabulary can no longer reach this response.
    const outcome = await runAiExecution<Record<string, string>>({
      userId: access.userId,
      companyId: companyId.trim(),
      action: 'content_basic',
      module: 'http:generate_workspace_content',
      referenceType: 'workspace_content_variants',
      referenceId,
      salt: 'workspace-content',
      amountOverride: Math.round(contentBasicCost * platformCount),
      note: `Generated ${platformCount} platform variant${platformCount > 1 ? 's' : ''} (workspace)`,
      billing: 'entry-auto',
      executor: workspaceExecutor,
    });

    if (outcome.status === 'blocked') {
      return res.status(outcome.httpStatus).json({
        error: outcome.userMessage,
        code: outcome.code,
        ...(outcome.required != null ? { required: outcome.required, balance: outcome.available } : {}),
      });
    }

    return res.status(200).json({ variants: outcome.result, ...(outcome.resumed ? { resumed: true } : {}) });
  } catch (err: unknown) {
    console.error('[planner/generate-workspace-content]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate content' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/planner/generate-workspace-content' });
