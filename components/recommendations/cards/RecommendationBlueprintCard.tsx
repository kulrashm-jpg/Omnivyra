import React, { useMemo, useState } from 'react';

type RecommendationBlueprintCardProps = {
  recommendation: Record<string, unknown>;
  onBuildCampaignBlueprint?: () => Promise<void> | void;
  onMarkLongTerm?: () => Promise<void> | void;
  onArchive?: () => Promise<void> | void;
};

const readText = (obj: Record<string, unknown> | null | undefined, key: string): string | null => {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const readNumber = (obj: Record<string, unknown> | null | undefined, key: string): number | null => {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const readList = (obj: Record<string, unknown> | null | undefined, key: string): string[] => {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v).trim()))
    .filter(Boolean);
};

const readTopicList = (obj: Record<string, unknown> | null | undefined, key: string): string[] => {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === 'object' && typeof (item as { topic?: unknown }).topic === 'string') {
        return (item as { topic: string }).topic.trim();
      }
      return null;
    })
    .filter((v): v is string => !!v);
};

export default function RecommendationBlueprintCard(props: RecommendationBlueprintCardProps) {
  const { recommendation, onBuildCampaignBlueprint, onMarkLongTerm, onArchive } = props;
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [busy, setBusy] = useState(false);

  const rec = recommendation ?? {};
  const intelligence = (rec.intelligence as Record<string, unknown> | undefined) ?? null;
  const execution = (rec.execution as Record<string, unknown> | undefined) ?? null;
  const snapshot = (rec.company_context_snapshot as Record<string, unknown> | undefined) ?? null;
  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? null;

  const core = {
    topic: readText(rec, 'topic'),
    polished_title: readText(rec, 'polished_title'),
    summary: readText(rec, 'summary') ?? readText(rec, 'narrative_direction'),
    estimated_reach: readNumber(rec, 'estimated_reach') ?? readNumber(rec, 'volume'),
    formats: readList(rec, 'formats'),
    regions: readList(rec, 'regions'),
  };

  const strategicContext = {
    aspect: readText(rec, 'aspect') ?? readText(rec, 'selected_aspect'),
    facets: readList(rec, 'facets'),
    audience_personas: readList(rec, 'audience_personas'),
    messaging_hooks: readList(rec, 'messaging_hooks'),
  };

  const intelligenceBlock = {
    problem_being_solved: readText(intelligence, 'problem_being_solved'),
    gap_being_filled: readText(intelligence, 'gap_being_filled'),
    why_now: readText(intelligence, 'why_now'),
    authority_reason: readText(intelligence, 'authority_reason'),
    expected_transformation: readText(intelligence, 'expected_transformation'),
    campaign_angle: readText(intelligence, 'campaign_angle'),
  };

  const signals = {
    diamond_type: readText(rec, 'diamond_type'),
    strategy_mode: readText(rec, 'strategy_mode'),
    final_alignment_score:
      readNumber(rec, 'final_alignment_score') ?? readNumber(rec, 'finalAlignmentScore'),
    strategy_modifier: readNumber(rec, 'strategy_modifier'),
  };

  const executionBlock = {
    execution_stage:
      readText(execution, 'execution_stage') ?? readText(rec, 'execution_stage'),
    stage_objective:
      readText(execution, 'stage_objective') ?? readText(rec, 'stage_objective'),
    psychological_goal:
      readText(execution, 'psychological_goal') ?? readText(rec, 'psychological_goal'),
    momentum_level:
      readText(execution, 'momentum_level') ?? readText(rec, 'momentum_level'),
  };

  const snapshotBlock = {
    core_problem_statement: readText(snapshot, 'core_problem_statement'),
    pain_symptoms: readList(snapshot, 'pain_symptoms'),
    desired_transformation: readText(snapshot, 'desired_transformation'),
    authority_domains: readList(snapshot, 'authority_domains'),
    brand_voice: readText(snapshot, 'brand_voice'),
    brand_positioning: readText(snapshot, 'brand_positioning'),
    reader_emotion_target: readText(snapshot, 'reader_emotion_target'),
    narrative_flow_seed: readText(snapshot, 'narrative_flow_seed'),
    recommended_cta_style: readText(snapshot, 'recommended_cta_style'),
  };

  const blueprint = {
    duration_weeks: readNumber(rec, 'duration_weeks'),
    progression_summary: readText(rec, 'progression_summary'),
    primary_recommendations: readTopicList(rec, 'primary_recommendations'),
    supporting_recommendations: readTopicList(rec, 'supporting_recommendations'),
  };

  const badges = useMemo(() => {
    const values: string[] = [];
    if (signals.diamond_type === 'authority_elevated' || polishFlags?.authority_elevated === true) {
      values.push('Authority Opportunity');
    }
    if (signals.diamond_type === 'diamond_candidate' || polishFlags?.diamond_candidate === true) {
      values.push('Diamond Candidate');
    }
    const angle = (intelligenceBlock.campaign_angle || '').toLowerCase();
    if (angle.includes('convert') || angle.includes('conversion')) {
      values.push('Conversion Driver');
    }
    return values;
  }, [signals.diamond_type, polishFlags, intelligenceBlock.campaign_angle]);

  const hasStrategicContext =
    !!strategicContext.aspect ||
    strategicContext.facets.length > 0 ||
    strategicContext.audience_personas.length > 0 ||
    strategicContext.messaging_hooks.length > 0;
  const hasIntelligence =
    !!intelligenceBlock.problem_being_solved ||
    !!intelligenceBlock.gap_being_filled ||
    !!intelligenceBlock.why_now ||
    !!intelligenceBlock.authority_reason ||
    !!intelligenceBlock.expected_transformation ||
    !!intelligenceBlock.campaign_angle;
  const hasSnapshot =
    !!snapshotBlock.core_problem_statement ||
    snapshotBlock.pain_symptoms.length > 0 ||
    !!snapshotBlock.desired_transformation ||
    snapshotBlock.authority_domains.length > 0 ||
    !!snapshotBlock.brand_voice ||
    !!snapshotBlock.brand_positioning ||
    !!snapshotBlock.reader_emotion_target ||
    !!snapshotBlock.narrative_flow_seed ||
    !!snapshotBlock.recommended_cta_style;
  const hasExecution =
    !!executionBlock.execution_stage ||
    !!executionBlock.stage_objective ||
    !!executionBlock.psychological_goal ||
    !!executionBlock.momentum_level;

  const run = async (fn?: () => Promise<void> | void) => {
    if (!fn || busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl p-6 shadow-sm border border-gray-200 bg-white hover:shadow-md">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-1">Core Theme</h4>
            <h3 className="text-lg font-semibold text-gray-900">
              {core.polished_title || core.topic || 'Strategic recommendation'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {minimized ? 'Maximize' : 'Minimize'}
          </button>
        </div>
        {core.summary ? <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{core.summary}</p> : null}
        {!minimized ? (
          <div className="mt-2 text-sm text-gray-600 space-y-1">
            {core.estimated_reach != null ? <div><span className="text-gray-500 font-medium">Estimated Reach:</span> {core.estimated_reach}</div> : null}
            {core.formats.length > 0 ? <div><span className="text-gray-500 font-medium">Formats:</span> {core.formats.join(', ')}</div> : null}
            {core.regions.length > 0 ? <div><span className="text-gray-500 font-medium">Regions:</span> {core.regions.join(', ')}</div> : null}
          </div>
        ) : null}
      </section>

      {!minimized && hasStrategicContext && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Context</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {strategicContext.aspect ? <div><span className="text-gray-500 font-medium">Aspect:</span> {strategicContext.aspect}</div> : null}
            {strategicContext.facets.length > 0 ? <div><span className="text-gray-500 font-medium">Facets:</span> {strategicContext.facets.join(', ')}</div> : null}
            {strategicContext.audience_personas.length > 0 ? <div><span className="text-gray-500 font-medium">Audience Personas:</span> {strategicContext.audience_personas.join(', ')}</div> : null}
            {strategicContext.messaging_hooks.length > 0 ? <div><span className="text-gray-500 font-medium">Messaging Hooks:</span> <span className="whitespace-pre-wrap break-words">{strategicContext.messaging_hooks.join(', ')}</span></div> : null}
          </div>
        </section>
      )}

      {!minimized && hasIntelligence && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Diamond Intelligence</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {intelligenceBlock.problem_being_solved ? <div><span className="text-gray-500 font-medium">Problem:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.problem_being_solved}</span></div> : null}
            {intelligenceBlock.gap_being_filled ? <div><span className="text-gray-500 font-medium">Gap:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.gap_being_filled}</span></div> : null}
            {intelligenceBlock.why_now ? <div><span className="text-gray-500 font-medium">Why Now:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.why_now}</span></div> : null}
            {intelligenceBlock.authority_reason ? <div><span className="text-gray-500 font-medium">Authority Reason:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.authority_reason}</span></div> : null}
            {intelligenceBlock.expected_transformation ? <div><span className="text-gray-500 font-medium">Expected Transformation:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.expected_transformation}</span></div> : null}
            {intelligenceBlock.campaign_angle ? <div><span className="text-gray-500 font-medium">Campaign Angle:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.campaign_angle}</span></div> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {signals.diamond_type ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-violet-100 text-violet-800">{signals.diamond_type}</span> : null}
            {signals.strategy_mode ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-blue-100 text-blue-800">{signals.strategy_mode}</span> : null}
            {signals.final_alignment_score != null ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-emerald-100 text-emerald-800">Final alignment {signals.final_alignment_score.toFixed(4)}</span> : null}
            {signals.strategy_modifier != null ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-amber-100 text-amber-800">Modifier {signals.strategy_modifier.toFixed(4)}</span> : null}
          </div>
        </section>
      )}

      {!minimized && hasSnapshot && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Company Context Snapshot</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {snapshotBlock.brand_voice ? <div><span className="text-gray-500 font-medium">Brand Voice:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_voice}</span></div> : null}
            {snapshotBlock.brand_positioning ? <div><span className="text-gray-500 font-medium">Positioning:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_positioning}</span></div> : null}
            {snapshotBlock.reader_emotion_target ? <div><span className="text-gray-500 font-medium">Reader Emotion Target:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.reader_emotion_target}</span></div> : null}
            {snapshotBlock.narrative_flow_seed ? <div><span className="text-gray-500 font-medium">Narrative Flow Seed:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.narrative_flow_seed}</span></div> : null}
            {snapshotBlock.recommended_cta_style ? <div><span className="text-gray-500 font-medium">Recommended CTA Style:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.recommended_cta_style}</span></div> : null}
            {snapshotBlock.core_problem_statement ? <div><span className="text-gray-500 font-medium">Core Problem:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.core_problem_statement}</span></div> : null}
            {snapshotBlock.pain_symptoms.length > 0 ? <div><span className="text-gray-500 font-medium">Pain Symptoms:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.pain_symptoms.join(', ')}</span></div> : null}
            {snapshotBlock.desired_transformation ? <div><span className="text-gray-500 font-medium">Desired Transformation:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.desired_transformation}</span></div> : null}
            {snapshotBlock.authority_domains.length > 0 ? <div><span className="text-gray-500 font-medium">Authority Domains:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.authority_domains.join(', ')}</span></div> : null}
          </div>
        </section>
      )}

      {!minimized && hasExecution && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution Stage</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {executionBlock.execution_stage ? <div><span className="text-gray-500 font-medium">Stage:</span> {executionBlock.execution_stage}</div> : null}
            {executionBlock.stage_objective ? <div><span className="text-gray-500 font-medium">Stage Objective:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.stage_objective}</span></div> : null}
            {executionBlock.psychological_goal ? <div><span className="text-gray-500 font-medium">Psychological Goal:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.psychological_goal}</span></div> : null}
            {executionBlock.momentum_level ? <div><span className="text-gray-500 font-medium">Momentum:</span> {executionBlock.momentum_level}</div> : null}
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

      {!minimized && (blueprint.duration_weeks != null || blueprint.progression_summary || blueprint.primary_recommendations.length > 0 || blueprint.supporting_recommendations.length > 0) && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign Blueprint Preview</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {blueprint.duration_weeks != null ? <div><span className="text-gray-500 font-medium">Duration:</span> {blueprint.duration_weeks} weeks</div> : null}
            {blueprint.progression_summary ? <div><span className="text-gray-500 font-medium">Progression:</span> <span className="whitespace-pre-wrap break-words">{blueprint.progression_summary}</span></div> : null}
            {blueprint.primary_recommendations.length > 0 ? <div><span className="text-gray-500 font-medium">Primary:</span> {blueprint.primary_recommendations.join(', ')}</div> : null}
            {blueprint.supporting_recommendations.length > 0 ? <div><span className="text-gray-500 font-medium">Supporting:</span> {blueprint.supporting_recommendations.join(', ')}</div> : null}
          </div>
        </section>
      )}

      <section className="mt-4 pt-4 border-t border-gray-200">
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Actions</h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(onBuildCampaignBlueprint)}
            disabled={busy || !onBuildCampaignBlueprint}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
          >
            Build Campaign Blueprint
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            disabled={minimized}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
          >
            Expand Theme Strategy
          </button>
          <button
            type="button"
            onClick={() => run(onMarkLongTerm)}
            disabled={busy || !onMarkLongTerm}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
          >
            Mark Long-Term
          </button>
          <button
            type="button"
            onClick={() => run(onArchive)}
            disabled={busy || !onArchive}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </section>

      {!minimized && expanded && (
        <details open className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">Expandable Details</summary>
          <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">
            {core.summary || 'No additional details available.'}
          </div>
        </details>
      )}
    </div>
  );
}

