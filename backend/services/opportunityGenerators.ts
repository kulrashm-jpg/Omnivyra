import type { OpportunityInput } from './opportunityService';
import { buildUnifiedContext } from './contextResolver';
import type { FocusModule } from './contextResolver';
import { runDiagnosticPrompt } from './llm/openaiAdapter';

export type GeneratorOptions = { regions?: string[] | null };

export type ClusterInput = {
  problem_domain: string;
  signal_count: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  priority_score: number;
};

export type StrategicPayload = {
  context_mode: string;
  company_context: Record<string, unknown>;
  selected_offerings: string[];
  selected_aspect: string | null;
  strategic_text: string;
  strategic_intents?: string[];
  regions?: string[];
  cluster_inputs?: ClusterInput[];
  focused_modules?: FocusModule[];
  additional_direction?: string;
};

export type TrendGenerator = (
  companyId: string,
  strategicPayload?: StrategicPayload
) => Promise<OpportunityInput[]>;

/**
 * Returns a generator function for the given type.
 * For TREND, the returned function is called with (companyId, strategicPayload).
 * Other types are called with (companyId) only for now.
 */
export function getGenerator(
  type: string
): (companyId: string, strategicPayload?: StrategicPayload) => Promise<OpportunityInput[]> {
  return async (companyId: string, strategicPayload?: StrategicPayload) => {
    switch (type) {
      case 'TREND':
        return generateTrendOpportunities(companyId, strategicPayload);
      case 'LEAD':
        return generateLeadOpportunities(companyId);
      case 'PULSE':
        return generatePulseOpportunities(companyId);
      case 'SEASONAL':
        return generateSeasonalOpportunities(companyId);
      case 'INFLUENCER':
        return generateInfluencerOpportunities(companyId);
      case 'DAILY_FOCUS':
        return generateDailyFocusOpportunities(companyId);
      default:
        return [];
    }
  };
}

type TrendThemeItem = {
  title: string;
  summary: string;
  reach_estimate?: number | string;
  formats?: string[];
};

/**
 * Generate TREND opportunities using strategic payload and optional OpenAI.
 */
export async function generateTrendOpportunities(
  companyId: string,
  strategicPayload?: StrategicPayload
): Promise<OpportunityInput[]> {
  const offerings = strategicPayload?.selected_offerings ?? [];
  const aspect = strategicPayload?.selected_aspect ?? null;
  const direction = strategicPayload?.strategic_text ?? '';
  const contextMode = (strategicPayload?.context_mode ?? 'FULL') as 'FULL' | 'FOCUSED' | 'NONE';
  const regions = strategicPayload?.regions ?? [];
  const clusterInputs = strategicPayload?.cluster_inputs ?? [];

  const missionBlock = await buildUnifiedContext(companyId, {
    mode: contextMode,
    selectedModules: strategicPayload?.focused_modules,
    additionalDirection: strategicPayload?.additional_direction,
  });

  let geographyInstruction = '';
  let hasGeographyInContext = false;
  if (contextMode !== 'NONE') {
    const { buildCompanyMissionContext } = await import('./companyMissionContext');
    const mc = await buildCompanyMissionContext(companyId, 'FULL');
    hasGeographyInContext = !!(mc?.geography);
  }
  if (regions.length === 0) {
    if (hasGeographyInContext) {
      geographyInstruction = 'Use the company\'s default geography from context as the primary focus.';
    } else {
      geographyInstruction = 'Generate globally neutral themes (no specific region).';
    }
  } else if (regions.length === 1) {
    geographyInstruction = `Tailor campaign themes specifically for the following region: ${regions[0]}.
Consider cultural context, current market sentiment, and seasonal timing.`;
  } else {
    geographyInstruction = `Generate unified strategic themes suitable for multiple regions: ${regions.join(', ')}.
Highlight region-specific nuance where necessary.
Ensure themes are adaptable across cultures.`;
  }

  let clusterBlock = '';
  if (clusterInputs.length > 0) {
    const clusterLines = clusterInputs.map(
      (c) =>
        `- Problem Domain: ${c.problem_domain}, Signal Count: ${c.signal_count}, Avg Intent: ${c.avg_intent_score}, Avg Urgency: ${c.avg_urgency_score}, Priority: ${c.priority_score}`
    );
    clusterBlock = `

Cluster-Derived Market Signal:
${clusterLines.join('\n')}

These represent validated emerging demand patterns from real market conversations.
Build themes that directly capture this demand wave.
Prioritize speed-to-market and differentiation.`;
    if (regions.length > 0) {
      clusterBlock += `

Adapt themes for specified regions while preserving demand pattern.`;
    }
    clusterBlock += `

Focus on execution-ready pillars, not exploratory themes.`;
  }

  const noAlignmentInstruction = !missionBlock
    ? '\nDo not align to any company. Focus only on provided strategic inputs.'
    : '';

  const problemSignalInstruction = missionBlock
    ? '\nThemes must originate from real user problem signals, not abstract market topics.'
    : '';

  const promptInput = {
    problem_mission_context: missionBlock || null,
    offerings,
    strategic_aspect: aspect,
    direction_notes: direction,
    strategic_intents: strategicPayload?.strategic_intents ?? [],
    context_mode: contextMode,
    target_regions: regions,
    geography_instruction: geographyInstruction,
    cluster_derived_signal: clusterInputs.length > 0 ? clusterBlock : null,
    additional_direction: strategicPayload?.additional_direction || null,
  };

  const systemPrompt = `You are a strategic campaign planner. Generate 6 strategic campaign theme pillars based on the provided context.
${missionBlock ? `\n${missionBlock}\n` : ''}
If context_mode is NONE, ignore brand alignment and focus on the strategic aspect and direction notes.${noAlignmentInstruction}
Follow the geography_instruction for regional focus.
If cluster_derived_signal is provided, treat it as high-priority input: build themes that directly capture the stated demand patterns.${problemSignalInstruction}
Output valid JSON only, in this exact shape: { "themes": [ { "title": string, "summary": string, "reach_estimate": number or string, "formats": string[] } ] }.
Each theme should have a short title, a 1-2 sentence summary, an optional reach_estimate, and 1-3 suggested formats (e.g. "Blog", "Video", "Social").`;

  const userPrompt = JSON.stringify(promptInput, null, 2);

  try {
    const { data } = await runDiagnosticPrompt<{ themes: TrendThemeItem[] }>(
      systemPrompt,
      userPrompt
    );
    const themes = Array.isArray(data?.themes) ? data.themes : [];
    return themes.slice(0, 6).map((t) => ({
      title: (t.title ?? 'Strategic theme').trim() || 'Strategic theme',
      summary: (t.summary ?? '').trim() || null,
      payload: {
        reach_estimate: t.reach_estimate ?? null,
        formats: Array.isArray(t.formats) ? t.formats : [],
      },
    }));
  } catch (err) {
    return [];
  }
}

/** Per-region recommendation output for multi-region consolidation. */
export type TrendRegionRecommendation = {
  opportunities: { title: string; summary?: string; rationale?: string }[];
  risks: string[];
  competitive_pressure: string;
  cultural_considerations: string;
  priority_score: number;
};

export type PillarSummary = { id: string; title: string; summary: string | null };

/**
 * Generate a single-region trend recommendation from strategic payload and selected pillars.
 * Used by the multi-region job processor.
 */
export async function generateTrendRecommendationForRegion(
  companyId: string,
  strategicPayload: StrategicPayload | null,
  region: string,
  pillarSummaries: PillarSummary[]
): Promise<TrendRegionRecommendation> {
  const direction = strategicPayload?.strategic_text ?? '';
  const contextMode = (strategicPayload?.context_mode ?? 'FULL') as 'FULL' | 'FOCUSED' | 'NONE';

  const missionBlock = await buildUnifiedContext(companyId, {
    mode: contextMode,
    selectedModules: strategicPayload?.focused_modules,
    additionalDirection: strategicPayload?.additional_direction,
  });

  const systemPrompt = `You are a regional campaign strategist. For the given region (ISO code), selected strategic pillars, and company context, produce a structured recommendation.
${missionBlock ? `\n${missionBlock}\n` : ''}
Output valid JSON only in this exact shape:
{
  "opportunities": [ { "title": string, "summary": string (optional), "rationale": string (optional) } ],
  "risks": string[],
  "competitive_pressure": string,
  "cultural_considerations": string,
  "priority_score": number (0-1, higher = more urgent for this region)
}
Consider cultural context, market sentiment, and seasonal timing for the region.`;

  const userPrompt = JSON.stringify(
    {
      region,
      context_mode: contextMode,
      problem_mission_context: missionBlock || null,
      strategic_direction: direction,
      strategic_intents: strategicPayload?.strategic_intents ?? [],
      additional_direction: strategicPayload?.additional_direction || null,
      selected_pillars: pillarSummaries.map((p) => ({ title: p.title, summary: p.summary || '' })),
    },
    null,
    2
  );

  try {
    const { data } = await runDiagnosticPrompt<{
      opportunities: { title: string; summary?: string; rationale?: string }[];
      risks: string[];
      competitive_pressure: string;
      cultural_considerations: string;
      priority_score: number;
    }>(systemPrompt, userPrompt);

    return {
      opportunities: Array.isArray(data?.opportunities) ? data.opportunities : [],
      risks: Array.isArray(data?.risks) ? data.risks : [],
      competitive_pressure: typeof data?.competitive_pressure === 'string' ? data.competitive_pressure : '',
      cultural_considerations: typeof data?.cultural_considerations === 'string' ? data.cultural_considerations : '',
      priority_score: typeof data?.priority_score === 'number' ? Math.max(0, Math.min(1, data.priority_score)) : 0.5,
    };
  } catch {
    return {
      opportunities: [],
      risks: ['Region analysis failed'],
      competitive_pressure: '',
      cultural_considerations: '',
      priority_score: 0,
    };
  }
}

/**
 * Generate LEAD opportunities for a company.
 */
export async function generateLeadOpportunities(companyId: string): Promise<OpportunityInput[]> {
  return [];
}

/**
 * Generate PULSE (market pulse) opportunities for a company.
 */
export async function generatePulseOpportunities(companyId: string): Promise<OpportunityInput[]> {
  return [];
}

/** Narrative phase for predictive intelligence. */
export type NarrativePhase = 'EMERGING' | 'ACCELERATING' | 'PEAKING' | 'DECLINING' | 'STRUCTURAL';

/** Per-region market pulse topic for consolidation. */
export type MarketPulseTopic = {
  topic: string;
  spike_reason: string;
  shelf_life_days: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  priority_score: number;
  trend_velocity?: number;
  velocity_score?: number;
  momentum_score?: number;
  narrative_phase?: NarrativePhase;
};

/** Per-region market pulse output from generator. */
export type MarketPulseRegionResult = {
  topics: MarketPulseTopic[];
};

/**
 * Generate market pulse for a single region.
 * Used by market pulse job processor.
 */
function classifyNarrativePhase(
  trendVelocity: number,
  priorityScore: number,
  shelfLifeDays: number
): NarrativePhase {
  if (trendVelocity > 0.7 && priorityScore < 0.6) return 'EMERGING';
  if (trendVelocity > 0.6 && priorityScore >= 0.6) return 'ACCELERATING';
  if (trendVelocity >= 0.3 && trendVelocity <= 0.6 && priorityScore > 0.7) return 'PEAKING';
  if (trendVelocity < 0.3 && shelfLifeDays > 7) return 'DECLINING';
  return 'STRUCTURAL';
}

export type MarketPulseContextPayload = {
  context_mode?: string;
  focused_modules?: FocusModule[];
  additional_direction?: string;
};

export async function generateMarketPulseForRegion(
  companyId: string,
  region: string,
  contextPayload?: MarketPulseContextPayload | null
): Promise<MarketPulseRegionResult> {
  const mode = (contextPayload?.context_mode ?? 'FULL') as 'FULL' | 'FOCUSED' | 'NONE';
  const missionBlock = await buildUnifiedContext(companyId, {
    mode,
    selectedModules: contextPayload?.focused_modules,
    additionalDirection: contextPayload?.additional_direction,
  });

  const systemPrompt = `You are a market pulse analyst. Identify trending conversations and execution-ready signals for the given region.
${missionBlock ? `\n${missionBlock}\n` : ''}

Output valid JSON only in this exact shape:
{
  "topics": [
    {
      "topic": string,
      "spike_reason": string,
      "shelf_life_days": number (1-30),
      "risk_level": "LOW" | "MEDIUM" | "HIGH",
      "priority_score": number (0-1),
      "trend_velocity": number (0-1, rate of recent adoption/growth)
    }
  ]
}

Rules:
- Identify trending conversations and spike catalysts
- Estimate realistic shelf life (1-30 days)
- Flag reputational or regulatory risks
- trend_velocity: 0-1 scale of how fast the topic is growing (0.8+ = viral, 0.5 = steady, 0.2 = fading)
- No exploratory fluff — execution-ready signals only
- 4-8 topics per region

Only return trends that represent:
- Increasing user pain
- Escalating confusion
- Decision friction
- Emotional distress
- Behavioral shifts tied to a real problem

Exclude:
- Events
- Announcements
- Seminars
- Celebrity gossip
- Surface keyword trends

Examples: Australian Open → ignore. Mental health seminar → ignore. Rising anxiety among working professionals → accept.`;

  const userPrompt = JSON.stringify(
    { company_id: companyId, region },
    null,
    2
  );

  try {
    const { data } = await runDiagnosticPrompt<{ topics: (MarketPulseTopic & { trend_velocity?: number })[] }>(
      systemPrompt,
      userPrompt
    );
    const topics = Array.isArray(data?.topics) ? data.topics : [];
    const sanitized = topics.slice(0, 8).map((t) => {
      const priorityScore = Math.max(0, Math.min(1, Number(t.priority_score) ?? 0.5));
      const trendVelocity = Math.max(0, Math.min(1, Number(t.trend_velocity) ?? 0.5));
      const shelfLifeDays = Math.min(30, Math.max(1, Number(t.shelf_life_days) || 7));
      const velocityScore = trendVelocity * (priorityScore || 0.5);
      const momentumScore = priorityScore * velocityScore;
      const narrativePhase = classifyNarrativePhase(trendVelocity, priorityScore, shelfLifeDays);

      return {
        topic: String(t.topic ?? '').trim() || 'Unknown topic',
        spike_reason: String(t.spike_reason ?? '').trim() || 'Spike detected',
        shelf_life_days: shelfLifeDays,
        risk_level: ['LOW', 'MEDIUM', 'HIGH'].includes(t.risk_level) ? t.risk_level : 'LOW',
        priority_score: priorityScore,
        trend_velocity: trendVelocity,
        velocity_score: velocityScore,
        momentum_score: momentumScore,
        narrative_phase: narrativePhase,
      };
    });
    return { topics: sanitized };
  } catch {
    return { topics: [] };
  }
}

/**
 * Generate SEASONAL opportunities for a company.
 */
export async function generateSeasonalOpportunities(companyId: string): Promise<OpportunityInput[]> {
  return [];
}

/**
 * Generate INFLUENCER opportunities for a company.
 */
export async function generateInfluencerOpportunities(companyId: string): Promise<OpportunityInput[]> {
  return [];
}

/**
 * Generate DAILY_FOCUS opportunities for a company.
 */
export async function generateDailyFocusOpportunities(companyId: string): Promise<OpportunityInput[]> {
  return [];
}
