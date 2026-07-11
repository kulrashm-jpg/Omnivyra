/**
 * Strategic Mix P3 — characterization of the planner-state serialization
 * contract, written BEFORE the Assignment layer touches it.
 *
 * `serializePlannerState` is the shape that travels the canonical planning
 * persistence seam (PUT planner-draft-state) AND the localStorage cache —
 * P1 requires the two to be interchangeable by construction. These tests
 * lock the pre-P3 guarantees so extending the payload can never break them:
 *
 *  - every legacy key keeps its exact pass-through value
 *  - transient/UI-only fields (selected_activity, plan_preview, health_report,
 *    recommended_*) are NEVER serialized
 *  - defaults for absent optionals stay byte-identical
 *  - output is JSON-safe (the seam stores it as jsonb)
 */

import {
  serializePlannerState,
  type PlannerDraftState,
} from '../../../components/planner/plannerDraftPersistence';
import type { PlannerSessionState } from '../../../components/planner/plannerSessionStore';

const LEGACY_KEYS = [
  'idea_spine',
  'strategy_context',
  'skeleton_confirmed',
  'strategy_confirmed',
  'campaign_type',
  'platform_content_requests',
  'plan_snapshot_hash',
  'campaign_structure',
  'calendar_plan',
  'company_context_mode',
  'focus_modules',
  'strategic_themes',
  'strategic_card',
] as const;

function richState(): PlannerSessionState {
  return {
    idea_spine: { title: 'Launch Q4', description: 'Big push', origin: 'direct' },
    strategy_context: {
      duration_weeks: 4,
      platforms: ['linkedin', 'x'],
      posting_frequency: { linkedin: 3 },
      content_mix: ['image'],
      campaign_goal: 'awareness',
      target_audience: 'CTOs',
    },
    skeleton_confirmed: true,
    strategy_confirmed: false,
    planner_entry_mode: 'direct',
    campaign_type: 'HYBRID',
    platform_content_requests: { linkedin: { image: 2 } },
    source_ids: { campaign_id: 'camp-9' },
    plan_preview: { weeks: [{ week: 1 }] }, // transient — must NOT serialize
    plan_snapshot_hash: 'hash-1',
    campaign_structure: { narrative: 'arc', phases: [{ label: 'P1' }] },
    calendar_plan: {
      days: [
        {
          week_number: 1,
          day: 'Monday',
          activities: [
            { execution_id: 'ex-1', week_number: 1, platform: 'linkedin', content_type: 'image', title: 'Kickoff', day: 'Monday' },
          ],
        },
      ],
    },
    selected_activity: { execution_id: 'ex-1' }, // UI-only — must NOT serialize
    recommended_goal: 'nope', // transient — must NOT serialize
    recommended_audience: ['nope'], // transient — must NOT serialize
    company_context_mode: 'minimal',
    focus_modules: ['products'],
    strategic_themes: [{ week: 1, title: 'Awareness' }],
    strategic_card: null,
    health_report: { score: 1 }, // UI-only — must NOT serialize
    draft_campaign_id: 'draft-7',
  };
}

describe('serializePlannerState — canonical seam payload (pre-P3 contract)', () => {
  it('passes every legacy key through with its exact value', () => {
    const s = richState();
    const out = serializePlannerState(s);
    expect(out.idea_spine).toEqual(s.idea_spine);
    expect(out.strategy_context).toEqual(s.strategy_context);
    expect(out.skeleton_confirmed).toBe(true);
    expect(out.strategy_confirmed).toBe(false);
    expect(out.campaign_type).toBe('HYBRID');
    expect(out.platform_content_requests).toEqual({ linkedin: { image: 2 } });
    expect(out.plan_snapshot_hash).toBe('hash-1');
    expect(out.campaign_structure).toEqual(s.campaign_structure);
    expect(out.calendar_plan).toEqual(s.calendar_plan);
    expect(out.company_context_mode).toBe('minimal');
    expect(out.focus_modules).toEqual(['products']);
    expect(out.strategic_themes).toEqual([{ week: 1, title: 'Awareness' }]);
    expect(out.strategic_card).toBeNull();
    for (const key of LEGACY_KEYS) expect(key in out).toBe(true);
  });

  it('never serializes transient/UI-only fields', () => {
    const out = serializePlannerState(richState());
    for (const forbidden of [
      'plan_preview',
      'selected_activity',
      'recommended_goal',
      'recommended_audience',
      'health_report',
      'account_context',
      'source_ids', // entry context is owned by the live entry, not the draft
      'planner_entry_mode',
    ]) {
      expect(forbidden in out).toBe(false);
    }
  });

  it('keeps byte-identical defaults for absent optionals', () => {
    const minimal = {
      idea_spine: null,
      strategy_context: null,
      planner_entry_mode: 'direct',
      campaign_type: undefined,
      platform_content_requests: null,
      source_ids: {},
      plan_preview: null,
    } as unknown as PlannerSessionState;
    const out = serializePlannerState(minimal);
    expect(out.skeleton_confirmed).toBe(false);
    expect(out.strategy_confirmed).toBe(false);
    expect(out.campaign_type).toBe('TEXT');
    expect(out.platform_content_requests).toBeNull();
    expect(out.plan_snapshot_hash).toBeNull();
    expect(out.campaign_structure).toBeNull();
    expect(out.calendar_plan).toBeNull();
    expect(out.company_context_mode).toBe('full_company_context');
    expect(out.focus_modules).toEqual([]);
    expect(out.strategic_themes).toEqual([]);
    expect(out.strategic_card).toBeNull();
  });

  it('output survives a JSON round-trip unchanged (jsonb seam safety)', () => {
    const out: PlannerDraftState = serializePlannerState(richState());
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

describe('P3 — assignments travel the SAME canonical seam (I-7: no new substrate)', () => {
  it('serializes assignments verbatim and defaults to [] when absent', () => {
    const assignment = {
      id: 'asg-1',
      campaign_id: 'camp-9',
      asset_id: 'asset-1',
      asset_version: null,
      structure_id: 'ex-1',
      week: 1,
      day: 'Monday',
      platform: 'linkedin',
      content_type: 'image',
      slot: null,
      status: 'draft' as const,
      notes: '',
      ordering: 0,
      created_at: '2026-07-11T10:00:00.000Z',
      updated_at: '2026-07-11T10:00:00.000Z',
    };
    const withAssignments = { ...richState(), assignments: [assignment] };
    expect(serializePlannerState(withAssignments).assignments).toEqual([assignment]);
    expect(serializePlannerState(richState()).assignments).toEqual([]);
  });

  it('every legacy key is untouched by the presence of assignments', () => {
    const s = richState();
    const before = serializePlannerState(s);
    const after = serializePlannerState({ ...s, assignments: [] });
    for (const key of LEGACY_KEYS) expect(after[key]).toEqual(before[key]);
  });
});
