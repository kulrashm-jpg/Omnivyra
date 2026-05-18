/**
 * strategyMapper — legacy planner inputs → canonical CampaignStrategy.
 * Phase-2 Step-5. Pure, no I/O.
 */

import type {
  CampaignStrategy,
  StrategyPlatformStrategy,
} from '../../types/strategy/CampaignStrategy';
import type { StrategyTheme } from '../../types/strategy/StrategyTheme';
import type { StrategyContentSource } from '../../types/strategy/StrategyContentSource';

export interface StrategyHydrationInputs {
  idea_spine?: Record<string, unknown> | null;
  strategy_context?: Record<string, unknown> | null;
  strategic_themes?: Array<Record<string, unknown>> | null;
  strategic_card?: Record<string, unknown> | null;
  owned_content_sources?: StrategyContentSource[] | null;
  created_by?: string | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export function mapToCampaignStrategy(
  campaignId: string,
  version: number,
  source: CampaignStrategy['orchestration_metadata']['source'],
  inputs: StrategyHydrationInputs,
): CampaignStrategy {
  const now = new Date().toISOString();
  const sc = (inputs.strategy_context ?? {}) as Record<string, unknown>;
  const spine = (inputs.idea_spine ?? {}) as Record<string, unknown>;
  const themesRaw = Array.isArray(inputs.strategic_themes) ? inputs.strategic_themes : [];

  const audiencePrimary =
    Array.isArray(sc.target_audience)
      ? (sc.target_audience as unknown[]).map(str).filter(Boolean).join(', ')
      : str(sc.target_audience);

  const objective =
    str(sc.campaign_goal) ||
    str(spine.refined_title) ||
    str(spine.title) ||
    'Campaign';

  const campaign_themes: StrategyTheme[] = themesRaw
    .map((t, i) => {
      const week = Number((t as any)?.week ?? i + 1) || i + 1;
      const title = str((t as any)?.title);
      if (!title) return null;
      return {
        id: `theme-${campaignId}-w${week}`,
        week,
        title,
        phase_label: str((t as any)?.phase_label) || undefined,
        objective: str((t as any)?.objective) || undefined,
        content_focus: str((t as any)?.content_focus) || undefined,
        cta_focus: str((t as any)?.cta_focus) || undefined,
        content_pillar_id: null,
        messaging_pillar_id: null,
      } as StrategyTheme;
    })
    .filter((x): x is StrategyTheme => x !== null);

  const platforms = list(sc.platforms);
  const freq = (sc.posting_frequency ?? {}) as Record<string, unknown>;
  const platform_strategy: StrategyPlatformStrategy[] = platforms.map((p) => ({
    platform: p,
    posting_frequency: Number(freq?.[p]) || undefined,
  }));

  const keyMsg = str(sc.key_message);

  return {
    campaign_id: campaignId,
    strategy_id: `strategy-${campaignId}`,
    version,
    objective,
    target_audience: { primary: audiencePrimary, segments: [] },
    audience_segments: [],
    key_messaging: keyMsg
      ? [{ id: `msg-${campaignId}-1`, message: keyMsg }]
      : [],
    content_pillars: [],
    campaign_themes,
    platform_strategy,
    posting_philosophy: str(sc.posting_philosophy) || 'consistent-cadence',
    content_mix: list(sc.content_formats).length ? list(sc.content_formats) : list(sc.content_mix),
    ai_generation_preferences:
      (inputs.strategic_card && typeof inputs.strategic_card === 'object'
        ? { strategic_card_present: true }
        : {}),
    owned_content_sources: Array.isArray(inputs.owned_content_sources)
      ? inputs.owned_content_sources
      : [],
    approval_state: 'draft',
    orchestration_metadata: {
      source,
      hydrated_from: 'planner_handoff',
      linkage_count: campaign_themes.length,
      owned_content_count: Array.isArray(inputs.owned_content_sources) ? inputs.owned_content_sources.length : 0,
      last_synced_at: now,
    },
    created_by: inputs.created_by ?? null,
    updated_by: inputs.created_by ?? null,
    created_at: now,
    updated_at: now,
  };
}
