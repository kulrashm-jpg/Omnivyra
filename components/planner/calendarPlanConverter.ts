/**
 * Converts API plan weeks into campaign_structure and calendar_plan.
 * Campaign structure: phases + narrative (from phase_label, theme).
 * Calendar plan: weeks, days, activities only.
 */

import type {
  CalendarPlan,
  CalendarPlanActivity,
  CalendarPlanDay,
  CampaignStructure,
  CampaignStructurePhase,
} from './plannerSessionStore';

interface WeekData {
  week?: number;
  theme?: string;
  phase_label?: string;
  narrative_summary?: string;
  objective?: string;
  content_focus?: string;
  cta_focus?: string;
  contentFocus?: string;
  ctaFocus?: string;
  dailyObjective?: string;
  execution_items?: Array<{
    execution_id?: string;
    topic?: string;
    platform?: string;
    content_type?: string;
    topic_slots?: Array<{ platform?: string; content_type?: string; topic?: string }>;
  }>;
  daily_execution_items?: Array<{
    execution_id?: string;
    platform?: string;
    content_type?: string;
    topic?: string;
    title?: string;
    day?: string;
  }>;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface ConvertedPlan {
  campaign_structure: CampaignStructure;
  calendar_plan: CalendarPlan;
}

function generatePhaseId(index: number, weekNum: number): string {
  return `phase-${index}-w${weekNum}`;
}

export function weeksToCalendarPlan(weeks: unknown[]): ConvertedPlan {
  const structurePhases: CampaignStructurePhase[] = [];
  const activities: CalendarPlanActivity[] = [];
  const daysByKey = new Map<string, CalendarPlanDay>();
  const weeksWithPhaseId: Array<Record<string, unknown>> = [];

  let currentPhase: CampaignStructurePhase | null = null;
  const narrativeParts: string[] = [];

  weeks.forEach((w, wi) => {
    const week = w as WeekData;
    const weekNum = week?.week ?? wi + 1;
    const theme = week?.theme ?? week?.phase_label ?? '';
    const phaseLabel = week?.phase_label ?? week?.theme ?? '';

    const wk = week as WeekData;
    const narrativeHint = wk.narrative_summary ?? theme;
    const objective = wk.objective ?? wk.dailyObjective ?? narrativeHint ?? '';
    const contentFocus = wk.content_focus ?? wk.contentFocus ?? theme ?? '';
    const ctaFocus = wk.cta_focus ?? wk.ctaFocus ?? '';
    if (phaseLabel && (!currentPhase || currentPhase.label !== phaseLabel)) {
      if (currentPhase) currentPhase.week_end = weekNum - 1;
      const phaseId = generatePhaseId(structurePhases.length, weekNum);
      currentPhase = {
        id: phaseId,
        label: phaseLabel,
        week_start: weekNum,
        week_end: weekNum,
        narrative_hint: narrativeHint,
        objective: objective || undefined,
        content_focus: contentFocus || undefined,
        cta_focus: ctaFocus || undefined,
      };
      structurePhases.push(currentPhase);
      if (phaseLabel || narrativeHint) narrativeParts.push(`${phaseLabel || `Week ${weekNum}`} (W${weekNum})${narrativeHint ? `: ${narrativeHint}` : ''}`);
    } else if (currentPhase) {
      currentPhase.week_end = weekNum;
    }

    weeksWithPhaseId.push({
      ...(typeof w === 'object' && w !== null ? (w as Record<string, unknown>) : {}),
      phase_id: currentPhase?.id ?? null,
    });

    const execItems = Array.isArray(week?.execution_items) ? week.execution_items : [];
    const dailyItems = Array.isArray(week?.daily_execution_items) ? week.daily_execution_items : [];

    if (dailyItems.length > 0) {
      dailyItems.forEach((item, di) => {
        const execId = String(item?.execution_id ?? '').trim() || `wk${weekNum}-exec-${di + 1}`;
        const day = item.day ?? DAYS[di % 7];
        const act: CalendarPlanActivity = {
          execution_id: execId,
          week_number: weekNum,
          platform: item.platform ?? 'linkedin',
          content_type: item.content_type ?? 'post',
          title: item.topic ?? item.title ?? (theme || `Week ${weekNum}`),
          theme,
          day,
        };
        activities.push(act);
        const dayKey = `${weekNum}-${day}`;
        if (!daysByKey.has(dayKey)) {
          daysByKey.set(dayKey, { week_number: weekNum, day, activities: [] });
        }
        daysByKey.get(dayKey)!.activities.push(act);
      });
    } else if (execItems.length > 0) {
      execItems.forEach((exec, ei) => {
        const slots = Array.isArray(exec.topic_slots) ? exec.topic_slots : [];
        if (slots.length > 0) {
          slots.forEach((slot, si) => {
            const execId = String(exec.execution_id ?? '').trim() || `wk${weekNum}-exec-${ei + 1}-${si + 1}`;
            const day = DAYS[si % 7];
            const act: CalendarPlanActivity = {
              execution_id: execId,
              week_number: weekNum,
              platform: slot.platform ?? exec.platform ?? 'linkedin',
              content_type: slot.content_type ?? exec.content_type ?? 'post',
              title: slot.topic ?? exec.topic ?? (theme || `Week ${weekNum}`),
              theme,
              day,
            };
            activities.push(act);
            const dayKey = `${weekNum}-${day}`;
            if (!daysByKey.has(dayKey)) {
              daysByKey.set(dayKey, { week_number: weekNum, day, activities: [] });
            }
            daysByKey.get(dayKey)!.activities.push(act);
          });
        } else {
          const execId = String(exec.execution_id ?? '').trim() || `wk${weekNum}-exec-${ei + 1}`;
          const day = DAYS[0];
          const act: CalendarPlanActivity = {
            execution_id: execId,
            week_number: weekNum,
            platform: exec.platform ?? 'linkedin',
            content_type: exec.content_type ?? 'post',
            title: exec.topic ?? (theme || `Week ${weekNum}`),
            theme,
            day,
          };
          activities.push(act);
          const dayKey = `${weekNum}-${day}`;
          if (!daysByKey.has(dayKey)) {
            daysByKey.set(dayKey, { week_number: weekNum, day, activities: [] });
          }
          daysByKey.get(dayKey)!.activities.push(act);
        }
      });
    } else if (theme) {
      const execId = `wk${weekNum}-theme`;
      const act: CalendarPlanActivity = {
        execution_id: execId,
        week_number: weekNum,
        platform: 'linkedin',
        content_type: 'post',
        title: theme,
        theme,
        day: 'Monday',
      };
      activities.push(act);
      const dayKey = `${weekNum}-Monday`;
      if (!daysByKey.has(dayKey)) {
        daysByKey.set(dayKey, { week_number: weekNum, day: 'Monday', activities: [] });
      }
      daysByKey.get(dayKey)!.activities.push(act);
    }
  });

  if (currentPhase && structurePhases.length > 0) {
    const lastWeek = (weeks[weeks.length - 1] as WeekData)?.week ?? weeks.length;
    currentPhase.week_end = lastWeek;
  }

  const days = Array.from(daysByKey.values()).sort(
    (a, b) => a.week_number - b.week_number || DAYS.indexOf(a.day) - DAYS.indexOf(b.day)
  );

  const campaign_structure: CampaignStructure = {
    phases: structurePhases,
    narrative: narrativeParts.length > 0 ? narrativeParts.join(' · ') : structurePhases.map((p) => `${p.label} (W${p.week_start}-${p.week_end})`).join(' · ') || 'Campaign plan',
  };

  const calendar_plan: CalendarPlan = {
    weeks: weeksWithPhaseId,
    days,
    activities,
  };

  return { campaign_structure, calendar_plan };
}
