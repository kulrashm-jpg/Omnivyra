import React from 'react';

type SignalsBlock = {
  diamond_type: string | null;
  strategy_mode: string | null;
  final_alignment_score: number | null;
  strategy_modifier: number | null;
};

type CoreBlock = {
  estimated_reach: string | null;
  formats: string[];
  regions: string[];
};

type StrategicContextBlock = {
  aspect: string | null;
  facets: string[];
  audience_personas: string[];
  messaging_hooks: string[];
};

type IntelligenceBlock = {
  problem_being_solved: string | null;
  gap_being_filled: string | null;
  why_now: string | null;
  authority_reason: string | null;
  expected_transformation: string | null;
  campaign_angle: string | null;
};

type SnapshotBlock = {
  brand_voice: string | null;
  brand_positioning: string | null;
  reader_emotion_target: string | null;
  narrative_flow_seed: string | null;
  recommended_cta_style: string | null;
  core_problem_statement: string | null;
  pain_symptoms: string[];
  desired_transformation: string | null;
  authority_domains: string[];
};

type ExecutionBlock = {
  execution_stage: string | null;
  stage_objective: string | null;
  psychological_goal: string | null;
  momentum_level: string | null;
};

type BlueprintBlock = {
  duration_weeks: number | null;
  progression_summary: string | null;
  primary_recommendations: string[];
  supporting_recommendations: string[];
};

export type BlueprintMetricsProps = {
  minimized: boolean;
  core: CoreBlock;
  strategicContext: StrategicContextBlock;
  intelligenceBlock: IntelligenceBlock;
  snapshotBlock: SnapshotBlock;
  executionBlock: ExecutionBlock;
  blueprint: BlueprintBlock;
  signals: SignalsBlock;
  displayDurationWeeks: number | null;
  badges: string[];
  hasStrategicContext: boolean;
  hasIntelligence: boolean;
  hasSnapshot: boolean;
  hasExecution: boolean;
};

export function BlueprintMetrics(props: BlueprintMetricsProps) {
  const {
    minimized, core, strategicContext, intelligenceBlock, snapshotBlock,
    executionBlock, blueprint, signals, displayDurationWeeks,
    badges, hasStrategicContext, hasIntelligence, hasSnapshot, hasExecution,
  } = props;

  return (
    <>
      {!minimized && (
        <div className="mt-2 text-sm text-gray-600 space-y-1">
          {core.estimated_reach != null && <div><span className="text-gray-500 font-medium">Estimated Reach:</span> {core.estimated_reach}</div>}
          {core.formats.length > 0 && <div><span className="text-gray-500 font-medium">Formats:</span> {core.formats.join(', ')}</div>}
          {core.regions.length > 0 && <div><span className="text-gray-500 font-medium">Regions:</span> {core.regions.join(', ')}</div>}
        </div>
      )}

      {!minimized && hasStrategicContext && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Context</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {strategicContext.aspect && <div><span className="text-gray-500 font-medium">Aspect:</span> {strategicContext.aspect}</div>}
            {strategicContext.facets.length > 0 && <div><span className="text-gray-500 font-medium">Facets:</span> {strategicContext.facets.join(', ')}</div>}
            {strategicContext.audience_personas.length > 0 && <div><span className="text-gray-500 font-medium">Audience Personas:</span> {strategicContext.audience_personas.join(', ')}</div>}
            {strategicContext.messaging_hooks.length > 0 && <div><span className="text-gray-500 font-medium">Messaging Hooks:</span> <span className="whitespace-pre-wrap break-words">{strategicContext.messaging_hooks.join(', ')}</span></div>}
          </div>
        </section>
      )}

      {!minimized && hasIntelligence && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Why The AI Likes This Direction</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {intelligenceBlock.problem_being_solved && <div><span className="text-gray-500 font-medium">Problem:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.problem_being_solved}</span></div>}
            {intelligenceBlock.gap_being_filled && <div><span className="text-gray-500 font-medium">Gap:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.gap_being_filled}</span></div>}
            {intelligenceBlock.why_now && <div><span className="text-gray-500 font-medium">Why Now:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.why_now}</span></div>}
            {intelligenceBlock.authority_reason && <div><span className="text-gray-500 font-medium">Authority Reason:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.authority_reason}</span></div>}
            {intelligenceBlock.expected_transformation && <div><span className="text-gray-500 font-medium">Expected Transformation:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.expected_transformation}</span></div>}
            {intelligenceBlock.campaign_angle && <div><span className="text-gray-500 font-medium">Campaign Angle:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.campaign_angle}</span></div>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {signals.diamond_type && <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-violet-100 text-violet-800">{signals.diamond_type}</span>}
            {signals.strategy_mode && <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-blue-100 text-blue-800">{signals.strategy_mode}</span>}
            {signals.final_alignment_score != null && <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-emerald-100 text-emerald-800">Final alignment {signals.final_alignment_score.toFixed(4)}</span>}
            {signals.strategy_modifier != null && <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-amber-100 text-amber-800">Modifier {signals.strategy_modifier.toFixed(4)}</span>}
          </div>
        </section>
      )}

      {!minimized && hasSnapshot && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Company Context Snapshot</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {snapshotBlock.brand_voice && <div><span className="text-gray-500 font-medium">Brand Voice:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_voice}</span></div>}
            {snapshotBlock.brand_positioning && <div><span className="text-gray-500 font-medium">Positioning:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_positioning}</span></div>}
            {snapshotBlock.reader_emotion_target && <div><span className="text-gray-500 font-medium">Reader Emotion Target:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.reader_emotion_target}</span></div>}
            {snapshotBlock.narrative_flow_seed && <div><span className="text-gray-500 font-medium">Narrative Flow Seed:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.narrative_flow_seed}</span></div>}
            {snapshotBlock.recommended_cta_style && <div><span className="text-gray-500 font-medium">Recommended CTA Style:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.recommended_cta_style}</span></div>}
            {snapshotBlock.core_problem_statement && <div><span className="text-gray-500 font-medium">Core Problem:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.core_problem_statement}</span></div>}
            {snapshotBlock.pain_symptoms.length > 0 && <div><span className="text-gray-500 font-medium">Pain Symptoms:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.pain_symptoms.join(', ')}</span></div>}
            {snapshotBlock.desired_transformation && <div><span className="text-gray-500 font-medium">Desired Transformation:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.desired_transformation}</span></div>}
            {snapshotBlock.authority_domains.length > 0 && <div><span className="text-gray-500 font-medium">Authority Domains:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.authority_domains.join(', ')}</span></div>}
          </div>
        </section>
      )}

      {!minimized && hasExecution && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">How You Would Use This Campaign</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {executionBlock.execution_stage && <div><span className="text-gray-500 font-medium">Stage:</span> {executionBlock.execution_stage}</div>}
            {executionBlock.stage_objective && <div><span className="text-gray-500 font-medium">Stage Objective:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.stage_objective}</span></div>}
            {executionBlock.psychological_goal && <div><span className="text-gray-500 font-medium">Psychological Goal:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.psychological_goal}</span></div>}
            {executionBlock.momentum_level && <div><span className="text-gray-500 font-medium">Momentum:</span> {executionBlock.momentum_level}</div>}
          </div>
        </section>
      )}

      {badges.length > 0 && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Badges</h4>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span key={badge} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                {badge}
              </span>
            ))}
          </div>
        </section>
      )}

      {!minimized && (displayDurationWeeks != null || blueprint.progression_summary || blueprint.primary_recommendations.length > 0 || blueprint.supporting_recommendations.length > 0) && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">What This Could Turn Into</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {displayDurationWeeks != null && <div><span className="text-gray-500 font-medium">Duration:</span> {displayDurationWeeks} weeks</div>}
            {blueprint.progression_summary && <div><span className="text-gray-500 font-medium">Progression:</span> <span className="whitespace-pre-wrap break-words">{blueprint.progression_summary}</span></div>}
            {blueprint.primary_recommendations.length > 0 && <div><span className="text-gray-500 font-medium">Primary:</span> {blueprint.primary_recommendations.join(', ')}</div>}
            {blueprint.supporting_recommendations.length > 0 && <div><span className="text-gray-500 font-medium">Supporting:</span> {blueprint.supporting_recommendations.join(', ')}</div>}
          </div>
        </section>
      )}
    </>
  );
}
