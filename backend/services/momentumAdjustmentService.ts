/**
 * Adaptive Momentum Engine — self-healing campaign planning.
 * When workload balancing reduces content, preserve narrative momentum by
 * marking later weeks as absorbing intent from earlier weeks. Additive only;
 * no new content generation, no schema breaks.
 */

export type MomentumTransferStrength = 'light' | 'moderate' | 'heavy';

export type MomentumAdjustment = {
  absorbed_from_week?: number[];
  carried_forward_to?: number[];
  reason?: string;
  /** Qualitative strength for future AI-driven intensity; V1 from reduced count. */
  momentum_transfer_strength?: MomentumTransferStrength;
  /** V2: narrative recovery was applied to this week (destination). */
  narrative_recovery?: boolean;
};

export type RecoveredTopic = {
  topic: string;
  recovered_from_week: number;
};

function getMomentumTransferStrength(reducedCount: number): MomentumTransferStrength {
  if (reducedCount <= 2) return 'light';
  if (reducedCount <= 5) return 'moderate';
  return 'heavy';
}

export type AdjustCampaignMomentumInput = {
  weeks: any[];
  validation_result?: {
    status?: string;
    planning_adjustments_summary?: { reduced: string[]; preserved: string[]; text: string };
  } | null;
};

/**
 * Detect momentum loss: balanced status + reduced content in planning_adjustments_summary.
 * When true, we redistribute strategic weight forward (metadata only).
 */
function hasMomentumLoss(input: AdjustCampaignMomentumInput): boolean {
  const vr = input.validation_result;
  if (!vr || vr.status !== 'balanced') return false;
  const summary = vr.planning_adjustments_summary;
  return Boolean(summary?.reduced?.length);
}

/**
 * Adjust campaign momentum: add week-level metadata so later weeks are marked
 * as absorbing narrative intent from earlier weeks. Forward only; phase order preserved.
 * Does NOT generate new content or change execution logic.
 */
export function adjustCampaignMomentum(input: AdjustCampaignMomentumInput): any[] {
  const weeks = Array.isArray(input.weeks) ? input.weeks : [];
  if (weeks.length === 0) return weeks;
  if (!hasMomentumLoss(input)) return weeks;

  const summary = input.validation_result!.planning_adjustments_summary!;
  const reducedCount = summary.reduced?.length ?? 0;
  const strength = getMomentumTransferStrength(reducedCount);
  const reason = 'Week 1 workload reduction carried forward.';

  return weeks.map((w: any, index: number) => {
    const weekNumber = Number(w?.week ?? w?.week_number ?? index + 1);
    const isWeek1 = weekNumber === 1;
    const isWeek2 = weekNumber === 2;

    if (isWeek1) {
      return {
        ...w,
        momentum_adjustments: {
          ...(w.momentum_adjustments || {}),
          carried_forward_to: [2],
          reason,
          momentum_transfer_strength: strength,
        },
      };
    }
    if (isWeek2) {
      return {
        ...w,
        momentum_adjustments: {
          ...(w.momentum_adjustments || {}),
          absorbed_from_week: [1],
          reason,
          momentum_transfer_strength: strength,
        },
      };
    }
    return w;
  });
}

function normalizeTopicForCompare(t: string): string {
  return String(t ?? '').trim().toLowerCase();
}

/**
 * Extract topics from a week for recovery: topics_to_cover (preferred) or execution_items.topic_slots.topic.
 * Does NOT remove from source. Returns last N topics (for append order).
 */
function getTopicsFromWeek(week: any, count: number): string[] {
  const list: string[] = [];
  const fromCover = Array.isArray(week?.topics_to_cover) ? week.topics_to_cover : [];
  for (const t of fromCover) {
    const s = typeof t === 'string' ? t.trim() : String(t ?? '').trim();
    if (s) list.push(s);
  }
  if (list.length >= count) return list.slice(-count);
  const fromSlots = (week?.execution_items ?? []).flatMap((it: any) =>
    (it?.topic_slots ?? []).map((s: any) => (s?.topic != null ? String(s.topic).trim() : '')).filter(Boolean)
  );
  for (const t of fromSlots) {
    if (t && !list.includes(t)) list.push(t);
  }
  return list.slice(-count);
}

/**
 * V2 Narrative Recovery: carry forward missing narrative context into later weeks.
 * Runs AFTER momentum_adjustments are assigned. Additive only; no ID or execution changes.
 * Trigger: week has carried_forward_to and momentum_transfer_strength !== "light".
 */
export function recoverNarrativeMomentum(weeks: any[]): any[] {
  const w = Array.isArray(weeks) ? weeks : [];
  if (w.length === 0) return w;

  const byWeekNumber = new Map<number, any>();
  for (let i = 0; i < w.length; i++) {
    const week = w[i];
    const num = Number(week?.week ?? week?.week_number ?? i + 1);
    byWeekNumber.set(num, { week, index: i });
  }

  const result = w.map((week: any) => ({ ...week }));

  for (let i = 0; i < result.length; i++) {
    const week = result[i];
    const ma = week?.momentum_adjustments;
    const carriedTo = ma?.carried_forward_to;
    const strength = ma?.momentum_transfer_strength;
    if (!Array.isArray(carriedTo) || carriedTo.length === 0 || strength === 'light') continue;

    const sourceWeekNum = Number(week?.week ?? week?.week_number ?? i + 1);
    const destWeekNum = Number(carriedTo[0]);
    if (!Number.isFinite(destWeekNum) || destWeekNum === sourceWeekNum) continue;

    const destEntry = byWeekNumber.get(destWeekNum);
    if (!destEntry) continue;

    const destIndex = destEntry.index;
    const destWeek = result[destIndex];
    const count = strength === 'heavy' ? 2 : 1;
    const toRecover = getTopicsFromWeek(week, count);
    if (toRecover.length === 0) continue;

    const existingTopics = new Set(
      (Array.isArray(destWeek.topics_to_cover) ? destWeek.topics_to_cover : [])
        .map((t: string) => normalizeTopicForCompare(t))
        .filter(Boolean)
    );

    const recoveredTopics: RecoveredTopic[] = (destWeek?.week_extras?.recovered_topics ?? []).slice();
    const appended: string[] = [];

    for (const topic of toRecover) {
      if (existingTopics.has(normalizeTopicForCompare(topic))) continue;
      recoveredTopics.push({ topic, recovered_from_week: sourceWeekNum });
      appended.push(topic);
    }

    if (appended.length === 0) continue;

    const destTopicsToCover = Array.isArray(destWeek.topics_to_cover) ? [...destWeek.topics_to_cover] : [];
    for (const t of appended) destTopicsToCover.push(t);

    result[destIndex] = {
      ...destWeek,
      topics_to_cover: destTopicsToCover,
      week_extras: {
        ...(destWeek.week_extras && typeof destWeek.week_extras === 'object' ? destWeek.week_extras : {}),
        recovered_topics: recoveredTopics,
      },
      momentum_adjustments: {
        ...(destWeek.momentum_adjustments || {}),
        narrative_recovery: true,
      },
    };
  }

  return result;
}
