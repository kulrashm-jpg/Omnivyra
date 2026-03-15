/**
 * Campaign Wizard Adapter
 * Converts existing structures (campaign_snapshot, plannerSessionStore, wizard_state)
 * into the unified wizard store format and exports to planning context for APIs.
 */

import type { CampaignWizardState, WizardContentMix } from '../../store/campaignWizardStore';

export interface StrategyContextLike {
  duration_weeks?: number;
  platforms?: string[];
  posting_frequency?: Record<string, number>;
  content_mix?: string[];
}

export interface CampaignSnapshot {
  wizard_state?: {
    step?: number;
    questionnaire_answers?: Record<string, unknown>;
    planned_start_date?: string;
    pre_planning_result?: Record<string, unknown> | null;
    cross_platform_sharing_enabled?: boolean;
    updated_at?: string;
  };
  cross_platform_sharing?: { enabled?: boolean; mode?: string };
  execution_config?: Record<string, unknown>;
  context_payload?: { platforms?: string[] };
}

export interface PlannerSession {
  idea_spine?: { title?: string; description?: string } | null;
  strategy_context?: StrategyContextLike | null;
}

/** Hydrate wizard store state from campaign_snapshot (DB). */
export function hydrateWizardFromSnapshot(snapshot: CampaignSnapshot | null | undefined): Partial<CampaignWizardState> {
  if (!snapshot || typeof snapshot !== 'object') return {};

  const ws = snapshot.wizard_state;
  const cps = snapshot.cross_platform_sharing;
  const ec = snapshot.execution_config as Record<string, unknown> | undefined;
  const payload = snapshot.context_payload;

  const out: Partial<CampaignWizardState> = {};

  if (ws && typeof ws === 'object') {
    if (typeof ws.step === 'number') out.step = ws.step;
    if (typeof ws.planned_start_date === 'string' && ws.planned_start_date.trim()) {
      out.plannedStartDate = ws.planned_start_date.trim();
    }
    if (ws.pre_planning_result && typeof ws.pre_planning_result === 'object') {
      out.prePlanningResult = ws.pre_planning_result as Record<string, unknown>;
    }
    if (typeof ws.cross_platform_sharing_enabled === 'boolean') {
      out.crossPlatformSharingEnabled = ws.cross_platform_sharing_enabled;
    }
    const qa = ws.questionnaire_answers;
    if (qa && typeof qa === 'object') {
      out.questionnaireAnswers = {
        availableVideo: Number(qa.availableVideo ?? qa.available_video ?? 0) || 0,
        availablePost: Number(qa.availablePost ?? qa.available_post ?? 0) || 0,
        availableBlog: Number(qa.availableBlog ?? qa.available_blog ?? 0) || 0,
        availableSong: Number(qa.availableSong ?? qa.available_song ?? 0) || 0,
        contentSuited: qa.contentSuited as boolean | null ?? null,
        videoPerWeek: Number(qa.videoPerWeek ?? qa.video_per_week ?? 2) || 2,
        postPerWeek: Number(qa.postPerWeek ?? qa.post_per_week ?? 3) || 3,
        blogPerWeek: Number(qa.blogPerWeek ?? qa.blog_per_week ?? 0) || 0,
        songPerWeek: Number(qa.songPerWeek ?? qa.song_per_week ?? 0) || 0,
        inHouseNotes: String(qa.inHouseNotes ?? qa.in_house_notes ?? '').trim(),
      };
    }
  }

  if (cps && typeof cps === 'object' && typeof cps.enabled === 'boolean') {
    out.crossPlatformSharingEnabled = cps.enabled;
  }

  if (payload?.platforms && Array.isArray(payload.platforms) && payload.platforms.length > 0) {
    out.platforms = payload.platforms.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
  }

  if (ec && typeof ec === 'object') {
    const dur = ec.duration_weeks ?? ec.durationWeeks;
    if (typeof dur === 'number' && dur > 0) out.durationWeeks = Math.floor(dur);
    const pf = ec.posting_frequency ?? ec.postingFrequency;
    if (pf && typeof pf === 'object') {
      const post = Object.values(pf as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
      const platformCount = Math.max(1, Object.keys(pf as object).length);
      const avgPerWeek = Math.round((post || 3) / platformCount);
      out.contentMix = {
        post_per_week: avgPerWeek,
        video_per_week: 2,
        blog_per_week: 0,
        reel_per_week: 0,
      };
    }
  }

  return out;
}

/** Hydrate wizard store state from planner session (StrategyBuilderStep, etc.). */
export function hydrateWizardFromPlannerSession(session: PlannerSession | null | undefined): Partial<CampaignWizardState> {
  if (!session || typeof session !== 'object') return {};

  const strat = session.strategy_context;
  const spine = session.idea_spine;

  const out: Partial<CampaignWizardState> = {};

  if (strat && typeof strat === 'object') {
    if (typeof strat.duration_weeks === 'number' && strat.duration_weeks > 0) {
      out.durationWeeks = Math.floor(strat.duration_weeks);
    }
    if (Array.isArray(strat.platforms) && strat.platforms.length > 0) {
      out.platforms = strat.platforms.map((p) => String(p).trim().toLowerCase().replace(/^twitter$/i, 'x')).filter(Boolean);
    }
    const pf = strat.posting_frequency;
    if (pf && typeof pf === 'object') {
      const counts = Object.values(pf as Record<string, number>);
      const avg = counts.length > 0
        ? Math.round(counts.reduce((a, b) => a + (Number(b) || 0), 0) / counts.length)
        : 3;
      out.contentMix = {
        post_per_week: avg,
        video_per_week: 2,
        blog_per_week: 0,
        reel_per_week: 0,
      };
    }
  }

  return out;
}

/** Export wizard state to planning context for APIs (ai/plan, planner-finalize). */
export function exportWizardToPlanningContext(wizard: Partial<CampaignWizardState> | null | undefined): Record<string, unknown> {
  if (!wizard || typeof wizard !== 'object') return {};

  const ctx: Record<string, unknown> = {};

  if (typeof wizard.durationWeeks === 'number' && wizard.durationWeeks > 0) {
    ctx.duration_weeks = wizard.durationWeeks;
  }
  if (Array.isArray(wizard.platforms) && wizard.platforms.length > 0) {
    ctx.platforms = wizard.platforms.join(', ');
  }
  const mix = wizard.contentMix;
  if (mix && typeof mix === 'object') {
    ctx.content_mix = mix;
    ctx.platform_content_requests = buildPlatformContentRequests(mix, wizard.platforms ?? ['linkedin']);
  }
  if (typeof wizard.crossPlatformSharingEnabled === 'boolean') {
    ctx.cross_platform_sharing = {
      enabled: wizard.crossPlatformSharingEnabled,
      mode: wizard.crossPlatformSharingEnabled ? 'shared' : 'unique',
    };
  }
  const qa = wizard.questionnaireAnswers;
  if (qa && typeof qa === 'object') {
    ctx.available_content = {
      post: qa.availablePost ?? 0,
      video: qa.availableVideo ?? 0,
      blog: qa.availableBlog ?? 0,
    };
    ctx.weekly_capacity = {
      post: qa.postPerWeek ?? 3,
      video: qa.videoPerWeek ?? 2,
      blog: qa.blogPerWeek ?? 0,
    };
  }
  if (typeof wizard.plannedStartDate === 'string' && wizard.plannedStartDate.trim()) {
    ctx.tentative_start = wizard.plannedStartDate.trim();
  }
  if (wizard.prePlanningResult && typeof wizard.prePlanningResult === 'object') {
    ctx.pre_planning_result = wizard.prePlanningResult;
  }

  return ctx;
}

/** Export wizard state to save-wizard-state API payload format. */
export function exportWizardToSaveWizardStatePayload(wizard: Partial<CampaignWizardState> | null | undefined): Record<string, unknown> {
  if (!wizard || typeof wizard !== 'object') return {};

  const payload: Record<string, unknown> = {};
  if (typeof wizard.step === 'number') payload.step = wizard.step;
  if (typeof wizard.plannedStartDate === 'string') payload.planned_start_date = wizard.plannedStartDate;
  if (wizard.prePlanningResult != null) payload.pre_planning_result = wizard.prePlanningResult;
  if (typeof wizard.crossPlatformSharingEnabled === 'boolean') payload.cross_platform_sharing_enabled = wizard.crossPlatformSharingEnabled;
  if (wizard.questionnaireAnswers && typeof wizard.questionnaireAnswers === 'object') {
    payload.questionnaire_answers = {
      availableVideo: wizard.questionnaireAnswers.availableVideo,
      availablePost: wizard.questionnaireAnswers.availablePost,
      availableBlog: wizard.questionnaireAnswers.availableBlog,
      availableSong: wizard.questionnaireAnswers.availableSong,
      contentSuited: wizard.questionnaireAnswers.contentSuited,
      videoPerWeek: wizard.questionnaireAnswers.videoPerWeek,
      postPerWeek: wizard.questionnaireAnswers.postPerWeek,
      blogPerWeek: wizard.questionnaireAnswers.blogPerWeek,
      songPerWeek: wizard.questionnaireAnswers.songPerWeek,
      inHouseNotes: wizard.questionnaireAnswers.inHouseNotes,
    };
  }
  payload.updated_at = new Date().toISOString();
  return payload;
}

function buildPlatformContentRequests(
  mix: WizardContentMix,
  platforms: string[]
): Array<{ platform: string; content_type: string; count_per_week: number }> {
  const rows: Array<{ platform: string; content_type: string; count_per_week: number }> = [];
  const plats = platforms.length > 0 ? platforms : ['linkedin'];

  for (const p of plats) {
    const platform = String(p).trim().toLowerCase() || 'linkedin';
    if (mix.post_per_week > 0) rows.push({ platform, content_type: 'post', count_per_week: mix.post_per_week });
    if (mix.video_per_week > 0) rows.push({ platform, content_type: 'video', count_per_week: mix.video_per_week });
    if (mix.blog_per_week > 0) rows.push({ platform, content_type: 'article', count_per_week: mix.blog_per_week });
    if (mix.reel_per_week > 0) rows.push({ platform, content_type: 'reel', count_per_week: mix.reel_per_week });
  }

  return rows;
}
