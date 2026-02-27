type WeekLike = {
  week?: number;
  week_number?: number;
  weekNumber?: number;
  campaign_stage?: string;
  weekly_narrative_spine?: string;
  audience_awareness_target?: string;
  execution_items?: any[];
};

function ensureNonEmptyString(value: unknown): string | null {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const t = s.trim();
  return t ? t : null;
}

function getWeekOrdinal(w: WeekLike, idx: number): number {
  const raw = Number((w as any)?.week ?? (w as any)?.week_number ?? (w as any)?.weekNumber ?? idx + 1);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : idx + 1;
}

function stageRank(stageRaw: unknown): number | null {
  const s = String(stageRaw ?? '').trim().toLowerCase();
  if (s === 'awareness') return 1;
  if (s === 'education') return 2;
  if (s === 'consideration') return 3;
  if (s === 'conversion') return 4;
  return null;
}

export function validateWeeklyNarrativeFlow(weeks: unknown): void {
  if (!Array.isArray(weeks) || weeks.length === 0) {
    throw new Error('DETERMINISTIC_WEEKLY_NARRATIVE_FLOW_REQUIRED');
  }

  const ordered = (weeks as any[])
    .map((w, idx) => ({ w, idx, n: getWeekOrdinal(w, idx) }))
    .sort((a, b) => a.n - b.n || a.idx - b.idx);

  // Stage progression must be non-decreasing (no backward jumps), starting at awareness.
  let prevRank = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const w = ordered[i]!.w as WeekLike;
    const stage = ensureNonEmptyString((w as any)?.campaign_stage);
    const spine = ensureNonEmptyString((w as any)?.weekly_narrative_spine);
    const awareness = ensureNonEmptyString((w as any)?.audience_awareness_target);
    if (!stage || !spine || !awareness) {
      throw new Error('DETERMINISTIC_WEEKLY_NARRATIVE_FLOW_REQUIRED');
    }
    const r = stageRank(stage);
    if (!r) throw new Error('DETERMINISTIC_WEEKLY_NARRATIVE_FLOW_REQUIRED');
    if (i === 0 && r !== 1) throw new Error('DETERMINISTIC_WEEKLY_NARRATIVE_FLOW_REQUIRED');
    if (r < prevRank) throw new Error('DETERMINISTIC_WEEKLY_NARRATIVE_FLOW_REQUIRED');
    prevRank = r;
  }

  // Global progression index must be strictly increasing across ALL weeks, no duplicates.
  const indices: number[] = [];
  for (const entry of ordered) {
    const week = entry.w as any;
    const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
    for (const exec of execItems) {
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      for (const slot of slots) {
        const n = Number(slot?.global_progression_index);
        if (!Number.isFinite(n) || n < 1) {
          throw new Error('DETERMINISTIC_WEEKLY_NARRATIVE_FLOW_REQUIRED');
        }
        indices.push(n);
      }
    }
  }

  const seen = new Set<number>();
  for (const n of indices) {
    if (seen.has(n)) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_ORDER_INVALID');
    seen.add(n);
  }
  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! <= sorted[i - 1]!) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_ORDER_INVALID');
  }
}

