
/**
 * POST /api/planner/skeleton-command
 * Modifies an existing calendar skeleton via natural language.
 *
 * Intent is classified server-side before calling the AI.
 * REMOVE uses a filter object (platform/content_type/week_number/day) applied
 * deterministically server-side — no hallucinated execution_ids.
 * ADD and MOVE still use structured diffs returned by the AI.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function randId(): string {
  return 'act-' + Math.random().toString(36).slice(2, 8);
}

function resolveDay(raw: string): string {
  const lower = String(raw ?? '').trim().toLowerCase();
  const match = DAYS.find((d) => d.toLowerCase().startsWith(lower.slice(0, 3)));
  return match ?? raw;
}

/** Build a date→week reference table the AI can use to resolve "21st" / "March 21" etc. */
function buildWeekCalendar(startDateStr: string, durationWeeks: number): string {
  try {
    const base = new Date(startDateStr + 'T00:00:00');
    if (isNaN(base.getTime())) return '';
    const lines: string[] = ['Date reference:'];
    for (let w = 1; w <= durationWeeks; w++) {
      const weekStart = new Date(base);
      weekStart.setDate(base.getDate() + (w - 1) * 7);
      const parts: string[] = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(weekStart);
        dt.setDate(weekStart.getDate() + d);
        parts.push(`${DAYS[d]}=${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
      }
      lines.push(`  Week ${w}: ${parts.join(', ')}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

type Intent = 'add' | 'remove' | 'move' | 'mixed';

function classifyIntent(msg: string): Intent {
  const m = msg.toLowerCase();
  const hasAdd    = /\b(add|schedule|create|include|put)\b/.test(m);
  const hasRemove = /\b(remove|delete|drop|clear|cancel)\b/.test(m);
  const hasMove   = /\b(move|shift|reschedule|change day|change week|swap|arrange|reorder|reorganize|redistribute)\b/.test(m);
  if (hasAdd && !hasRemove && !hasMove) return 'add';
  if (hasRemove && !hasAdd && !hasMove) return 'remove';
  if (hasMove && !hasAdd && !hasRemove) return 'move';
  return 'mixed';
}

interface Activity {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  day?: string;
  phase?: string;
  objective?: string;
}

interface RemoveFilter {
  platform?: string | null;
  content_type?: string | null;
  week_number?: number | null;
  day?: string | null;
}

interface MoveOp { id: string; day?: string; week_number?: number; }

/** Apply a filter object to the activity list and return matching execution_ids */
function applyRemoveFilter(actList: Activity[], filter: RemoveFilter): Set<string> {
  const platform    = filter.platform    ? String(filter.platform).toLowerCase().trim()    : null;
  const contentType = filter.content_type ? String(filter.content_type).toLowerCase().trim() : null;
  const weekNumber  = typeof filter.week_number === 'number' ? filter.week_number : null;
  const day         = filter.day ? resolveDay(String(filter.day)) : null;

  const matched = actList.filter((a) => {
    if (platform    && (a.platform    ?? '').toLowerCase() !== platform)    return false;
    if (contentType && (a.content_type ?? '').toLowerCase() !== contentType) return false;
    if (weekNumber  && a.week_number !== weekNumber)                          return false;
    if (day         && (a.day ?? '') !== day)                                 return false;
    return true;
  });
  return new Set(matched.map((a) => a.execution_id ?? '').filter(Boolean));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, message, activities, strategy_context } = req.body ?? {};

    if (!companyId || typeof companyId !== 'string') return res.status(400).json({ error: 'companyId is required' });
    if (!message  || typeof message  !== 'string') return res.status(400).json({ error: 'message is required' });

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    const actList: Activity[] = Array.isArray(activities) ? activities : [];
    const strat = strategy_context as Record<string, unknown> | null | undefined;
    const durationWeeks   = typeof strat?.duration_weeks   === 'number' ? strat.duration_weeks   : 6;
    const stratPlatforms  = Array.isArray(strat?.platforms) ? (strat.platforms as string[]).join(', ') : '';
    const plannedStart    = typeof strat?.planned_start_date === 'string' ? strat.planned_start_date : '';
    const weekCalendar    = plannedStart ? buildWeekCalendar(plannedStart, durationWeeks) : '';

    const intent = classifyIntent(message);

    const campaignCtx = [
      `Duration: ${durationWeeks} weeks`,
      stratPlatforms ? `Platforms: ${stratPlatforms}` : '',
      plannedStart   ? `Start date: ${plannedStart}` : '',
      weekCalendar,
    ].filter(Boolean).join('\n');

    const activityFields = `execution_id, week_number (1–${durationWeeks}), platform, content_type, title, day (Monday–Sunday), theme, objective`;
    const platforms      = 'linkedin, instagram, twitter, x, facebook, youtube, tiktok, pinterest, reddit';
    const contentTypes   = 'post, story, reel, video, carousel, image, thread, article, pin, live';

    // ── Intent-specific prompts ──────────────────────────────────────────────

    let systemPrompt: string;

    if (intent === 'add') {
      systemPrompt = `You are a campaign calendar assistant. Your ONLY job is to generate NEW activities to ADD to the schedule.
Do NOT touch, remove, or reference any existing activities.

Campaign info:
${campaignCtx}

Activity fields: ${activityFields}
Platforms: ${platforms}
Content types: ${contentTypes}

Rules:
- Generate EXACTLY the number of activities the user requests. One day + one week = ONE activity. Do NOT multiply.
- "one video on Saturday week 1" → exactly 1 activity (week_number=1, day=Saturday).
- "alternate days" means every other day: Monday, Wednesday, Friday (or Tuesday, Thursday, Saturday).
- "every week" → one entry per week (${durationWeeks} total).
- Use the date reference above to resolve dates like "21st" → correct week_number + day.
- Generate unique execution_ids like "act-abc123".

Respond with ONLY valid JSON — no markdown:
{ "add": [ { "execution_id": "act-abc123", "week_number": 1, "platform": "linkedin", "content_type": "post", "title": "...", "day": "Monday" } ], "reply": "Added X activities." }`;

    } else if (intent === 'remove') {
      systemPrompt = `You are a campaign calendar assistant. Your ONLY job is to identify WHICH activities to delete by extracting filter criteria.
Do NOT add or move any activities.

Campaign info:
${campaignCtx}

Week number words: "week one"=1, "week two"=2, "week three"=3, "week four"=4, "week five"=5, "week six"=6, etc.

Extract the deletion filter from the user's instruction:
- platform: social media platform name, lowercase (e.g. "facebook"). null if not specified.
- content_type: content type, lowercase (e.g. "video", "post"). null if not specified.
- week_number: integer week number. null if not specified (means ALL weeks).
- day: day of week (e.g. "Monday"). null if not specified (means ALL days).

Respond with ONLY valid JSON — no markdown:
{ "filter": { "platform": "facebook", "content_type": "video", "week_number": 1, "day": null }, "reply": "Removed Facebook videos from week 1." }

Use null for any field the user did NOT explicitly mention. Do not guess.`;

    } else if (intent === 'move') {
      systemPrompt = `You are a campaign calendar assistant. Your ONLY job is to MOVE existing activities to a different day or week.
Do NOT add or delete anything.

Campaign info:
${campaignCtx}

Respond with ONLY valid JSON — no markdown:
{ "move": [ { "id": "execution_id_1", "day": "Friday", "week_number": 2 } ], "reply": "Moved X activities." }

Only provide the fields that change (day and/or week_number). Keep all other fields intact.`;

    } else {
      // mixed / complex — handles "remove X and arrange/add Y", compound edits
      systemPrompt = `You are a campaign calendar assistant. Apply the user's compound instruction.

Campaign info:
${campaignCtx}

Activity fields: ${activityFields}
Platforms: ${platforms}
Content types: ${contentTypes}

Week number words: "week one"=1, "week two"=2, "week three"=3, etc.

For DELETIONS use a filter object (server applies it precisely):
  "delete_filter": { "platform": "facebook", "content_type": "post", "week_number": null, "day": null }

For ADDITIONS list each new activity:
  "add": [ { "execution_id": "act-abc123", "week_number": 1, "platform": "...", "content_type": "...", "title": "...", "day": "Monday" } ]

For MOVES list each change:
  "move": [ { "id": "execution_id", "day": "Wednesday" } ]

"arrange on alternate days" means: delete existing, re-add on Monday, Wednesday, Friday.

Respond with ONLY valid JSON — no markdown:
{
  "delete_filter": { "platform": null, "content_type": null, "week_number": null, "day": null },
  "add": [],
  "move": [],
  "reply": "One sentence summary."
}
Use null in delete_filter for fields not specified. Use [] for unused arrays.`;
    }

    const result = await runCompletionWithOperation({
      companyId,
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Existing activities (${actList.length}):\n${JSON.stringify(actList, null, 2)}\n\nInstruction: ${message.trim()}`,
        },
      ],
      operation: 'generatePlatformVariants',
    });

    let parsed: Record<string, unknown> = {};
    try {
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      return res.status(500).json({ error: 'AI returned malformed JSON' });
    }

    // ── Build delete set ─────────────────────────────────────────────────────
    let deleteSet = new Set<string>();

    if (intent === 'remove') {
      // Filter-based deletion — deterministic, no hallucinated IDs
      const filter = (parsed.filter ?? {}) as RemoveFilter;
      deleteSet = applyRemoveFilter(actList, filter);
    } else if (intent === 'mixed') {
      // Mixed can use delete_filter (preferred) or fallback to delete array
      if (parsed.delete_filter && typeof parsed.delete_filter === 'object') {
        deleteSet = applyRemoveFilter(actList, parsed.delete_filter as RemoveFilter);
      } else if (Array.isArray(parsed.delete)) {
        deleteSet = new Set((parsed.delete as string[]).filter(Boolean));
      }
    }
    // add/move intents never delete

    const toAdd:  Activity[] = (intent === 'remove') ? [] : (Array.isArray(parsed.add)  ? parsed.add  as Activity[]  : []);
    const toMove: MoveOp[]   = (intent === 'remove') ? [] : (Array.isArray(parsed.move) ? parsed.move as MoveOp[]   : []);
    const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'Done.';

    // Apply diff deterministically
    const moveMap = new Map<string, MoveOp>(toMove.filter((m) => m?.id).map((m) => [m.id, m]));

    const updated: Activity[] = actList
      .filter((a) => !deleteSet.has(a.execution_id ?? ''))
      .map((a) => {
        const mv = moveMap.get(a.execution_id ?? '');
        if (!mv) return a;
        return {
          ...a,
          ...(mv.day                            ? { day: resolveDay(mv.day) }     : {}),
          ...(typeof mv.week_number === 'number' ? { week_number: mv.week_number } : {}),
        };
      });

    for (const act of toAdd) {
      if (!act || typeof act !== 'object') continue;
      updated.push({
        ...act,
        execution_id: (act.execution_id as string) || randId(),
        day:          act.day        ? resolveDay(act.day as string)             : 'Monday',
        week_number:  typeof act.week_number === 'number' ? act.week_number      : 1,
      });
    }

    return res.status(200).json({
      activities: updated,
      deleted: deleteSet.size,
      added:   toAdd.length,
      moved:   toMove.length,
      reply,
    });

  } catch (err: unknown) {
    console.error('[planner/skeleton-command]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
}
