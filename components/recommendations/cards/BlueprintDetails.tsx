import React from 'react';
import type { RecommendationStrategicCardDraft } from '@/lib/recommendationStrategicCard';

function StrategicCardEditorField(props: {
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const sharedClassName =
    'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">{props.label}</span>
      {props.multiline ? (
        <textarea
          value={props.value}
          rows={3}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          className={sharedClassName}
        />
      ) : (
        <input
          type="text"
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          className={sharedClassName}
        />
      )}
    </label>
  );
}

export type BlueprintDetailsProps = {
  draft: RecommendationStrategicCardDraft;
  saving: boolean;
  onChange: (draft: RecommendationStrategicCardDraft) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function BlueprintDetails(props: BlueprintDetailsProps) {
  const { draft, saving, onChange, onCancel, onSave } = props;

  const update = <K extends keyof RecommendationStrategicCardDraft>(
    section: K,
    field: keyof RecommendationStrategicCardDraft[K],
    value: string
  ) => {
    onChange({
      ...draft,
      [section]: {
        ...draft[section],
        [field]: value,
      },
    });
  };

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Refine Strategic Card</h4>
          <p className="mt-1 text-xs text-gray-600">
            Adjust the campaign-level strategy before approval. These edits will flow into saved recommendation campaigns too.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField label="Polished Title" value={draft.core.polished_title} onChange={(value) => update('core', 'polished_title', value)} />
        <StrategicCardEditorField label="Topic" value={draft.core.topic} onChange={(value) => update('core', 'topic', value)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4">
        <StrategicCardEditorField label="Summary" value={draft.core.summary} multiline onChange={(value) => update('core', 'summary', value)} />
        <StrategicCardEditorField label="Narrative Direction" value={draft.core.narrative_direction} multiline onChange={(value) => update('core', 'narrative_direction', value)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField label="Aspect" value={draft.strategic_context.aspect} onChange={(value) => update('strategic_context', 'aspect', value)} />
        <StrategicCardEditorField label="Estimated Reach" value={draft.core.estimated_reach} onChange={(value) => update('core', 'estimated_reach', value)} />
        <StrategicCardEditorField label="Facets" value={draft.strategic_context.facets} placeholder="Comma-separated" onChange={(value) => update('strategic_context', 'facets', value)} />
        <StrategicCardEditorField label="Audience Personas" value={draft.strategic_context.audience_personas} placeholder="Comma-separated" onChange={(value) => update('strategic_context', 'audience_personas', value)} />
        <StrategicCardEditorField label="Messaging Hooks" value={draft.strategic_context.messaging_hooks} placeholder="Comma-separated" onChange={(value) => update('strategic_context', 'messaging_hooks', value)} />
        <StrategicCardEditorField label="Formats" value={draft.core.formats} placeholder="Comma-separated" onChange={(value) => update('core', 'formats', value)} />
        <StrategicCardEditorField label="Regions" value={draft.core.regions} placeholder="Comma-separated" onChange={(value) => update('core', 'regions', value)} />
        <StrategicCardEditorField label="Duration Weeks" value={draft.blueprint.duration_weeks} onChange={(value) => update('blueprint', 'duration_weeks', value)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField label="Problem Being Solved" value={draft.intelligence.problem_being_solved} multiline onChange={(value) => update('intelligence', 'problem_being_solved', value)} />
        <StrategicCardEditorField label="Expected Transformation" value={draft.intelligence.expected_transformation} multiline onChange={(value) => update('intelligence', 'expected_transformation', value)} />
        <StrategicCardEditorField label="Why Now" value={draft.intelligence.why_now} multiline onChange={(value) => update('intelligence', 'why_now', value)} />
        <StrategicCardEditorField label="Campaign Angle" value={draft.intelligence.campaign_angle} multiline onChange={(value) => update('intelligence', 'campaign_angle', value)} />
        <StrategicCardEditorField label="Gap Being Filled" value={draft.intelligence.gap_being_filled} multiline onChange={(value) => update('intelligence', 'gap_being_filled', value)} />
        <StrategicCardEditorField label="Authority Reason" value={draft.intelligence.authority_reason} multiline onChange={(value) => update('intelligence', 'authority_reason', value)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField label="Execution Stage" value={draft.execution.execution_stage} onChange={(value) => update('execution', 'execution_stage', value)} />
        <StrategicCardEditorField label="Momentum Level" value={draft.execution.momentum_level} onChange={(value) => update('execution', 'momentum_level', value)} />
        <StrategicCardEditorField label="Stage Objective" value={draft.execution.stage_objective} multiline onChange={(value) => update('execution', 'stage_objective', value)} />
        <StrategicCardEditorField label="Psychological Goal" value={draft.execution.psychological_goal} multiline onChange={(value) => update('execution', 'psychological_goal', value)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField label="Progression Summary" value={draft.blueprint.progression_summary} multiline onChange={(value) => update('blueprint', 'progression_summary', value)} />
        <StrategicCardEditorField label="Primary Recommendations" value={draft.blueprint.primary_recommendations} multiline placeholder="Comma-separated topics" onChange={(value) => update('blueprint', 'primary_recommendations', value)} />
        <StrategicCardEditorField label="Supporting Recommendations" value={draft.blueprint.supporting_recommendations} multiline placeholder="Comma-separated topics" onChange={(value) => update('blueprint', 'supporting_recommendations', value)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField label="Core Problem Statement" value={draft.company_context_snapshot.core_problem_statement} multiline onChange={(value) => update('company_context_snapshot', 'core_problem_statement', value)} />
        <StrategicCardEditorField label="Desired Transformation" value={draft.company_context_snapshot.desired_transformation} multiline onChange={(value) => update('company_context_snapshot', 'desired_transformation', value)} />
        <StrategicCardEditorField label="Brand Voice" value={draft.company_context_snapshot.brand_voice} multiline onChange={(value) => update('company_context_snapshot', 'brand_voice', value)} />
        <StrategicCardEditorField label="Brand Positioning" value={draft.company_context_snapshot.brand_positioning} multiline onChange={(value) => update('company_context_snapshot', 'brand_positioning', value)} />
        <StrategicCardEditorField label="Reader Emotion Target" value={draft.company_context_snapshot.reader_emotion_target} multiline onChange={(value) => update('company_context_snapshot', 'reader_emotion_target', value)} />
        <StrategicCardEditorField label="Narrative Flow Seed" value={draft.company_context_snapshot.narrative_flow_seed} multiline onChange={(value) => update('company_context_snapshot', 'narrative_flow_seed', value)} />
        <StrategicCardEditorField label="Recommended CTA Style" value={draft.company_context_snapshot.recommended_cta_style} multiline onChange={(value) => update('company_context_snapshot', 'recommended_cta_style', value)} />
        <StrategicCardEditorField label="Pain Symptoms" value={draft.company_context_snapshot.pain_symptoms} placeholder="Comma-separated" onChange={(value) => update('company_context_snapshot', 'pain_symptoms', value)} />
        <StrategicCardEditorField label="Authority Domains" value={draft.company_context_snapshot.authority_domains} placeholder="Comma-separated" onChange={(value) => update('company_context_snapshot', 'authority_domains', value)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onSave} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Save Refinement
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </section>
  );
}
