import { assessVirality } from '../viralityAdvisorService';
import { buildCampaignSnapshotWithHash } from '../viralitySnapshotBuilder';
import { getPlatformStrategies } from '../externalApiService';
import { getProfile } from '../companyProfileService';
import { buildCompanyContext, buildForcedCompanyContext, formatForcedContextForPrompt } from '../companyContextService';
import { buildCompanyStrategyDNA } from '../companyStrategyDNAService';
import { createLightweightContext } from './lightweightContext';
import { resolveBaselineContext } from './baselineContext';
import { DEFAULT_PLATFORM_STRATEGIES } from './runWithContextGuards';

export async function resolveExecutionContext(args: {
  input: any;
  versionRow: any;
  buildMode: string;
  contextScope: any;
  isConversational: boolean;
  useFastPath: boolean;
  campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
  buildCompanyContextBlock: (profile: any, buildMode: string, contextScope: any) => string | null;
}) {
  const { input, versionRow, buildMode, contextScope, isConversational, useFastPath, campaignIntentSummary, buildCompanyContextBlock } = args;

  let companyContext: string | null = null;
  let forcedContextBlock: string | null = null;
  let strategyDNA: ReturnType<typeof buildCompanyStrategyDNA> | null = null;
  if (!useFastPath && versionRow?.company_id && (buildMode === 'full_context' || buildMode === 'focused_context')) {
    try {
      const profile = await getProfile(versionRow.company_id, { autoRefine: false, languageRefine: true });
      companyContext = buildCompanyContextBlock(profile, buildMode, contextScope);
      strategyDNA = buildCompanyStrategyDNA(profile);
      if (profile?.forced_context_fields && Object.keys(profile.forced_context_fields).length > 0) {
        const canonical = buildCompanyContext(profile);
        const { forced_context } = buildForcedCompanyContext(canonical, profile.forced_context_fields);
        if (Object.keys(forced_context).length > 0) {
          forcedContextBlock = formatForcedContextForPrompt(forced_context);
        }
      }
    } catch (e) {
      console.warn('Failed to load company profile for context injection:', e);
    }
  }

  const tryFullPipeline = async () => {
    const { snapshot, snapshot_hash } = await buildCampaignSnapshotWithHash(input.campaignId);
    const [viralityAssessment, platformStrategiesResult] = await Promise.all([
      assessVirality(input.campaignId, { snapshot, snapshot_hash }),
      getPlatformStrategies().catch((e) => {
        console.warn('getPlatformStrategies failed, using defaults:', e);
        return DEFAULT_PLATFORM_STRATEGIES;
      }),
    ]);
    const platformStrategies =
      Array.isArray(platformStrategiesResult) && platformStrategiesResult.length > 0
        ? platformStrategiesResult
        : DEFAULT_PLATFORM_STRATEGIES;
    const omnivyreDecision =
      viralityAssessment.omnivyre_decision ?? { status: 'ok', recommendation: 'proceed' as const };

    return {
      snapshot,
      snapshot_hash: viralityAssessment.snapshot_hash,
      diagnostics: viralityAssessment,
      omnivyreDecision,
      platformStrategies,
      companyContext,
      forcedContextBlock,
      strategyDNA,
      campaignIntentSummary,
    };
  };

  let ctx: any;
  let baselineContext: any = { unavailable: true };
  if (useFastPath) {
    ctx = createLightweightContext(
      input.campaignId,
      companyContext,
      campaignIntentSummary,
      DEFAULT_PLATFORM_STRATEGIES,
      forcedContextBlock,
      strategyDNA
    );
    ctx.baselineContext = { unavailable: true };
    ctx.fastPath = true;
  } else {
    try {
      ctx = await tryFullPipeline();
    } catch (err) {
      console.warn('Campaign AI full pipeline failed, using lightweight path:', err);
      if (isConversational || input.bolt_run_id) {
        ctx = createLightweightContext(
          input.campaignId,
          companyContext,
          campaignIntentSummary,
          DEFAULT_PLATFORM_STRATEGIES,
          forcedContextBlock,
          strategyDNA
        );
      } else {
        throw err;
      }
    }

    baselineContext = { unavailable: true };
    if (versionRow?.company_id) {
      try {
        baselineContext = await resolveBaselineContext({
          companyId: versionRow.company_id,
          companyStage: versionRow.company_stage ?? null,
          marketScope: versionRow.market_scope ?? null,
          baselineOverride: versionRow.baseline_override ?? null,
          primaryType: campaignIntentSummary.primary_type,
          platformStrategies: ctx.platformStrategies || [],
        });
      } catch (e) {
        console.warn('Baseline context resolution failed, using unavailable:', e);
      }
    }
    ctx.baselineContext = baselineContext;
  }

  return {
    ctx,
    baselineContext,
  };
}
