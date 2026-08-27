/**
 * P2 — grounded generation context (PURE).
 *
 * Resolves the canonical context chain for ONE content slot:
 *
 *   Campaign → Week → Strategic Card → Skeleton → Day → Platform
 *           → Content Type → Assigned assets
 *
 * Everything is derived from the campaign's OWN server-side planner_state
 * (campaign_versions.campaign_snapshot.planner_state) — the same snapshot the
 * release seam reads. The browser supplies only identifiers; it never supplies
 * strategy. That is what makes cross-campaign grounding impossible: a slot id
 * that is not in THIS campaign's plan simply does not resolve.
 *
 * OWNERSHIP — this module resolves and shapes context. It performs NO I/O and
 * NO tenancy check; the caller must already have proven that the planner_state
 * it passes belongs to the authorized campaign.
 *
 * NOT a second prompt system: the platform specs (PLATFORM_SPECS) and
 * content-type guidance (CONTENT_TYPE_GUIDANCE) already live in
 * backend/services/contentWriter/workspaceContentPrompt and are untouched.
 * This module adds the campaign/strategic/structural/slot sections that were
 * missing, and nothing else.
 *
 * Pure and deterministic: same planner_state + same slot → same context. No
 * clock, no randomness, no I/O.
 */

/* ── Shapes read out of planner_state (all optional — legacy states vary) ── */

interface PlannerCardLike {
  core?: { topic?: unknown; polished_title?: unknown; summary?: unknown; narrative_direction?: unknown };
  strategic_context?: {
    campaign_goal?: unknown; target_audience?: unknown; key_message?: unknown;
    selected_aspects?: unknown; selected_offerings?: unknown;
  };
  intelligence?: {
    problem_being_solved?: unknown; why_now?: unknown;
    expected_transformation?: unknown; campaign_angle?: unknown;
  };
  execution?: { execution_stage?: unknown; stage_objective?: unknown; psychological_goal?: unknown };
}

interface PlannerThemeLike {
  week?: unknown; title?: unknown; phase_label?: unknown;
  objective?: unknown; content_focus?: unknown; cta_focus?: unknown;
}

interface PlannerActivityLike {
  execution_id?: unknown; week_number?: unknown; day?: unknown;
  platform?: unknown; content_type?: unknown; title?: unknown;
  theme?: unknown; objective?: unknown;
  content_planning_status?: unknown;
  draft_content?: { body?: unknown; manually_edited?: unknown } | null;
}

interface PlannerAssignmentLike {
  asset_id?: unknown; structure_id?: unknown; slot?: unknown;
  status?: unknown; content_type?: unknown; platform?: unknown;
}

export interface PlannerStateLike {
  strategy_context?: {
    campaign_goal?: unknown; target_audience?: unknown; key_message?: unknown;
    duration_weeks?: unknown; platforms?: unknown; planned_start_date?: unknown;
    posting_frequency?: unknown; content_mix?: unknown;
  } | null;
  strategic_card?: PlannerCardLike | null;
  strategic_themes?: PlannerThemeLike[] | null;
  calendar_plan?: {
    activities?: PlannerActivityLike[];
    days?: Array<{ week_number?: unknown; day?: unknown; activities?: PlannerActivityLike[] }>;
  } | null;
  campaign_type?: unknown;
  platform_content_requests?: Record<string, Record<string, unknown>> | null;
  assignments?: PlannerAssignmentLike[] | null;
}

/* ── The resolved context ── */

export interface GenerationCampaignContext {
  campaign_id: string;
  goal: string | null;
  audience: string[];
  key_message: string | null;
  duration_weeks: number | null;
  start_date: string | null;
}

export interface GenerationStrategicContext {
  topic: string | null;
  summary: string | null;
  narrative_direction: string | null;
  problem_being_solved: string | null;
  why_now: string | null;
  expected_transformation: string | null;
  campaign_angle: string | null;
  execution_stage: string | null;
  stage_objective: string | null;
  selected_aspects: string[];
  selected_offerings: string[];
}

export interface GenerationWeekContext {
  week: number | null;
  theme_title: string | null;
  phase_label: string | null;
  objective: string | null;
  content_focus: string | null;
  cta_focus: string | null;
}

export interface GenerationStructureContext {
  campaign_type: string | null;
  platforms: string[];
  duration_weeks: number | null;
  /** Slots in this campaign's plan, and in this slot's week. */
  total_slots: number;
  week_slots: number;
  /** platform → content_type → per-week frequency, as declared in the skeleton. */
  platform_content_requests: Record<string, Record<string, number>>;
}

export interface GenerationSlotContext {
  structure_id: string;
  week: number | null;
  day: string | null;
  platform: string | null;
  content_type: string | null;
  title: string | null;
  objective: string | null;
  /** 1-based position among this week's slots on the same platform. */
  sequence_in_week: number;
  planning_status: string | null;
  has_manual_edit: boolean;
}

export interface GenerationAssetContext {
  asset_id: string;
  slot: string | null;
  status: string | null;
  content_type: string | null;
}

export interface GenerationContext {
  campaign: GenerationCampaignContext;
  strategic: GenerationStrategicContext;
  week: GenerationWeekContext;
  structure: GenerationStructureContext;
  slot: GenerationSlotContext;
  assets: GenerationAssetContext[];
}

export type GenerationContextFailureCode =
  | 'SLOT_NOT_IN_CAMPAIGN'
  | 'MISSING_SKELETON_CONTEXT'
  | 'MISSING_STRATEGIC_CONTEXT';

export interface GenerationContextResult {
  ok: boolean;
  context?: GenerationContext;
  code?: GenerationContextFailureCode;
  message?: string;
}

/* ── helpers (defensive: planner_state is snapshot JSON, not a typed row) ── */

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const strList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => x !== null);
  const single = str(v);
  return single ? single.split(',').map((s) => s.trim()).filter(Boolean) : [];
};

/** Slot identity — MUST match deriveStructureSlots so ids agree across the app. */
function slotIdOf(a: PlannerActivityLike, index: number): string {
  const explicit = str(a.execution_id);
  if (explicit) return explicit;
  const w = num(a.week_number) ?? 0;
  const d = str(a.day) ?? 'unknown';
  const p = str(a.platform) ?? 'unknown';
  const c = str(a.content_type) ?? 'unknown';
  return `w${w}-${d}-${p}-${c}-${index}`;
}

/** Flatten the plan exactly as the planner does: flat list first, else days. */
function flattenActivities(plan: PlannerStateLike['calendar_plan']): PlannerActivityLike[] {
  if (!plan) return [];
  if (Array.isArray(plan.activities) && plan.activities.length > 0) return plan.activities;
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    return plan.days.flatMap((d) =>
      (d.activities ?? []).map((a) => ({
        ...a,
        day: a.day ?? d.day,
        week_number: a.week_number ?? d.week_number,
      })),
    );
  }
  return [];
}

function normalizeRequests(raw: PlannerStateLike['platform_content_requests']): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [platform, types] of Object.entries(raw)) {
    if (!types || typeof types !== 'object') continue;
    const inner: Record<string, number> = {};
    for (const [ct, freq] of Object.entries(types as Record<string, unknown>)) {
      const n = num(freq);
      if (n !== null && n > 0) inner[ct] = n;
    }
    if (Object.keys(inner).length > 0) out[platform] = inner;
  }
  return out;
}

/**
 * Resolve the canonical generation context for one slot.
 *
 * `slotId` MUST belong to `plannerState`'s calendar plan — that check is the
 * cross-campaign guard. `platform` is validated against the slot rather than
 * trusted: a client cannot substitute an arbitrary platform.
 */
export function resolveGenerationContext(input: {
  campaignId: string;
  plannerState: PlannerStateLike | null | undefined;
  slotId: string;
  /** Optional caller assertion; must match the slot's own platform if given. */
  platform?: string | null;
}): GenerationContextResult {
  const state = input.plannerState ?? {};
  const activities = flattenActivities(state.calendar_plan);

  if (activities.length === 0) {
    return {
      ok: false,
      code: 'MISSING_SKELETON_CONTEXT',
      message: 'This campaign has no skeleton yet — build the structure before generating content.',
    };
  }

  // ── Ownership: the slot must be part of THIS campaign's plan ──
  let slotActivity: PlannerActivityLike | null = null;
  let slotIndex = -1;
  for (let i = 0; i < activities.length; i += 1) {
    if (slotIdOf(activities[i], i) === input.slotId) {
      slotActivity = activities[i];
      slotIndex = i;
      break;
    }
  }
  if (!slotActivity) {
    return {
      ok: false,
      code: 'SLOT_NOT_IN_CAMPAIGN',
      message: 'That content slot does not belong to this campaign.',
    };
  }

  const slotPlatform = str(slotActivity.platform);
  const assertedPlatform = str(input.platform);
  if (assertedPlatform && slotPlatform && assertedPlatform.toLowerCase() !== slotPlatform.toLowerCase()) {
    return {
      ok: false,
      code: 'SLOT_NOT_IN_CAMPAIGN',
      message: `That slot is a ${slotPlatform} slot, not ${assertedPlatform}.`,
    };
  }

  const strategy = state.strategy_context ?? {};
  const card = state.strategic_card ?? {};
  const themes = Array.isArray(state.strategic_themes) ? state.strategic_themes : [];
  const slotWeek = num(slotActivity.week_number);

  // ── Strategic context must exist in SOME form: a card, or a weekly theme,
  //    or a campaign goal. Otherwise generation would be generic — fail loudly
  //    rather than silently producing ungrounded content. ──
  const weekTheme = themes.find((t) => num(t.week) === slotWeek) ?? null;
  const hasCard = Boolean(
    str(card.core?.topic) || str(card.core?.summary) || str(card.intelligence?.problem_being_solved),
  );
  const hasTheme = Boolean(weekTheme && (str(weekTheme.title) || str(weekTheme.objective)));
  const hasGoal = Boolean(str(strategy.campaign_goal));
  if (!hasCard && !hasTheme && !hasGoal) {
    return {
      ok: false,
      code: 'MISSING_STRATEGIC_CONTEXT',
      message: 'This campaign has no strategy yet — add a strategic card or weekly themes before generating content.',
    };
  }

  const weekActivities = activities.filter((a) => num(a.week_number) === slotWeek);
  const samePlatformInWeek = weekActivities.filter(
    (a) => (str(a.platform) ?? '').toLowerCase() === (slotPlatform ?? '').toLowerCase(),
  );
  const sequence = Math.max(
    1,
    samePlatformInWeek.findIndex((a, i) => slotIdOf(a, activities.indexOf(a)) === input.slotId) + 1,
  );

  const assignments = Array.isArray(state.assignments) ? state.assignments : [];
  const assets: GenerationAssetContext[] = assignments
    .filter((a) => str(a.structure_id) === input.slotId && str(a.asset_id))
    .map((a) => ({
      asset_id: str(a.asset_id) as string,
      slot: str(a.slot),
      status: str(a.status),
      content_type: str(a.content_type),
    }));

  return {
    ok: true,
    context: {
      campaign: {
        campaign_id: input.campaignId,
        goal: str(strategy.campaign_goal),
        audience: strList(strategy.target_audience),
        key_message: str(strategy.key_message),
        duration_weeks: num(strategy.duration_weeks),
        start_date: str(strategy.planned_start_date),
      },
      strategic: {
        topic: str(card.core?.topic) ?? str(card.core?.polished_title),
        summary: str(card.core?.summary),
        narrative_direction: str(card.core?.narrative_direction),
        problem_being_solved: str(card.intelligence?.problem_being_solved),
        why_now: str(card.intelligence?.why_now),
        expected_transformation: str(card.intelligence?.expected_transformation),
        campaign_angle: str(card.intelligence?.campaign_angle),
        execution_stage: str(card.execution?.execution_stage),
        stage_objective: str(card.execution?.stage_objective),
        selected_aspects: strList(card.strategic_context?.selected_aspects),
        selected_offerings: strList(card.strategic_context?.selected_offerings),
      },
      week: {
        week: slotWeek,
        theme_title: weekTheme ? str(weekTheme.title) : str(slotActivity.theme),
        phase_label: weekTheme ? str(weekTheme.phase_label) : null,
        objective: weekTheme ? str(weekTheme.objective) : null,
        content_focus: weekTheme ? str(weekTheme.content_focus) : null,
        cta_focus: weekTheme ? str(weekTheme.cta_focus) : null,
      },
      structure: {
        campaign_type: str(state.campaign_type),
        platforms: strList(strategy.platforms),
        duration_weeks: num(strategy.duration_weeks),
        total_slots: activities.length,
        week_slots: weekActivities.length,
        platform_content_requests: normalizeRequests(state.platform_content_requests),
      },
      slot: {
        structure_id: input.slotId,
        week: slotWeek,
        day: str(slotActivity.day),
        platform: slotPlatform,
        content_type: str(slotActivity.content_type),
        title: str(slotActivity.title),
        objective: str(slotActivity.objective),
        sequence_in_week: sequence,
        planning_status: str(slotActivity.content_planning_status),
        has_manual_edit: slotActivity.draft_content?.manually_edited === true,
      },
      assets,
    },
  };
}

/**
 * Render the resolved context as prompt sections.
 *
 * Deliberately sectioned (Strategy / Structure / Execution / Constraints)
 * rather than a flat field dump, so the model can tell WHY the campaign
 * exists from WHERE this piece sits from WHAT it must not violate.
 *
 * Deterministic: same context → identical string. Omits absent fields rather
 * than emitting empty labels.
 */
export function buildGroundedContextBlock(ctx: GenerationContext): string {
  const line = (label: string, value: string | null | undefined): string | null =>
    value ? `${label}: ${value}` : null;
  const section = (title: string, lines: Array<string | null>): string | null => {
    const kept = lines.filter((l): l is string => Boolean(l));
    return kept.length > 0 ? `${title}:\n${kept.join('\n')}` : null;
  };

  const strategy = section('CAMPAIGN STRATEGY (why this campaign exists)', [
    line('Campaign goal', ctx.campaign.goal),
    line('Audience', ctx.campaign.audience.join(', ') || null),
    line('Key message', ctx.campaign.key_message),
    line('Strategic topic', ctx.strategic.topic),
    line('Summary', ctx.strategic.summary),
    line('Problem being solved', ctx.strategic.problem_being_solved),
    line('Why now', ctx.strategic.why_now),
    line('Desired transformation', ctx.strategic.expected_transformation),
    line('Campaign angle', ctx.strategic.campaign_angle),
    line('Narrative direction', ctx.strategic.narrative_direction),
    line('Focus areas', ctx.strategic.selected_aspects.join(', ') || null),
    line('Offerings in scope', ctx.strategic.selected_offerings.join(', ') || null),
  ]);

  const structure = section('CAMPAIGN STRUCTURE (where this piece sits)', [
    line('Campaign length', ctx.structure.duration_weeks ? `${ctx.structure.duration_weeks} weeks` : null),
    line('Campaign type', ctx.structure.campaign_type),
    line('Platforms in this campaign', ctx.structure.platforms.join(', ') || null),
    line('Total planned pieces', ctx.structure.total_slots ? String(ctx.structure.total_slots) : null),
    line('Pieces planned this week', ctx.structure.week_slots ? String(ctx.structure.week_slots) : null),
  ]);

  const execution = section('THIS PIECE (what it must accomplish)', [
    line('Week', ctx.week.week !== null ? String(ctx.week.week) : null),
    line('Weekly theme', ctx.week.theme_title),
    line('Campaign phase', ctx.week.phase_label),
    line('Weekly objective', ctx.week.objective),
    line('Weekly content focus', ctx.week.content_focus),
    line('Weekly CTA direction', ctx.week.cta_focus),
    line('Execution stage', ctx.strategic.execution_stage),
    line('Stage objective', ctx.strategic.stage_objective),
    line('Day', ctx.slot.day),
    line('Platform', ctx.slot.platform),
    line('Content type', ctx.slot.content_type),
    line('Slot objective', ctx.slot.objective),
    line(
      'Position',
      ctx.slot.platform && ctx.slot.week !== null
        ? `piece ${ctx.slot.sequence_in_week} for ${ctx.slot.platform} in week ${ctx.slot.week}`
        : null,
    ),
  ]);

  const assetLines = ctx.assets.map(
    (a) => `- asset ${a.asset_id}${a.content_type ? ` (${a.content_type})` : ''}${a.slot ? ` in slot "${a.slot}"` : ''}${a.status ? ` [${a.status}]` : ''}`,
  );
  const assetSection = assetLines.length > 0
    ? `ASSIGNED ASSETS (already approved for this piece — write copy that works WITH them, do not describe a different visual):\n${assetLines.join('\n')}`
    : null;

  const constraints = section('CONSTRAINTS (must not be violated)', [
    'Stay inside this campaign\'s strategy — do not introduce goals, offers, or audiences that are not listed above.',
    ctx.week.week !== null
      ? `This piece belongs to week ${ctx.week.week}. Do not write a generic campaign post that could sit in any week.`
      : null,
    ctx.slot.platform ? `Write for ${ctx.slot.platform} specifically, following that platform's template below.` : null,
    ctx.slot.content_type ? `Produce a ${ctx.slot.content_type}, not a different format.` : null,
    assetLines.length > 0 ? 'An asset is already assigned — the copy must complement it.' : null,
  ]);

  return [strategy, structure, execution, assetSection, constraints]
    .filter((s): s is string => Boolean(s))
    .join('\n\n');
}
