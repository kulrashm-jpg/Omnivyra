type WeekLike = {
  week?: number;
  week_number?: number;
  weekNumber?: number;
  execution_items?: any[];
  platform_allocation?: Record<string, number>;
  content_type_mix?: any;
};

const ROLE_ROTATION_ORDER = ['Authority Building', 'Audience Expansion', 'Education', 'Demand Capture'] as const;
const HEAVY_TYPES = new Set(['article', 'blog', 'long_video']);

function weekOrdinal(w: any, idx: number): number {
  const raw = Number(w?.week ?? w?.week_number ?? w?.weekNumber ?? idx + 1);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : idx + 1;
}

function normalizePlatformKey(raw: unknown): string {
  const n = String(raw ?? '').trim().toLowerCase();
  if (n === 'twitter') return 'x';
  return n;
}

function normalizeContentType(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function countTotalSlots(week: any): number {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  let sum = 0;
  for (const exec of execItems) {
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    sum += slots.length;
  }
  return sum;
}

function computeStrategicRoleDistribution(week: any): Record<string, number> {
  const counts: Record<string, number> = {};
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  for (const exec of execItems) {
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    for (const slot of slots) {
      const role = String(slot?.intent?.strategic_role ?? '').trim();
      if (!role) continue;
      counts[role] = (counts[role] ?? 0) + 1;
    }
  }
  return counts;
}

function computePlatformAllocationFromExecution(week: any): Record<string, number> {
  const out: Record<string, number> = {};
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  for (const exec of execItems) {
    const count = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0) || 0));
    const platforms: string[] = Array.isArray(exec?.selected_platforms)
      ? exec.selected_platforms.map(normalizePlatformKey).filter(Boolean)
      : [];
    for (const p of platforms) {
      out[p] = (out[p] ?? 0) + count;
    }
  }
  return out;
}

function sortSlotsByNarrativeOrder(week: any): Array<{ execIdx: number; slotIdx: number; slot: any }> {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  const all: Array<{ execIdx: number; slotIdx: number; slot: any }> = [];
  for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
    const exec = execItems[execIdx];
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
      all.push({ execIdx, slotIdx, slot: slots[slotIdx] });
    }
  }
  // Stable deterministic order for rebalancing operations: global index asc, then exec order, then slot order
  all.sort((a, b) => {
    const ga = Number(a.slot?.global_progression_index);
    const gb = Number(b.slot?.global_progression_index);
    const na = Number.isFinite(ga) ? ga : Number.MAX_SAFE_INTEGER;
    const nb = Number.isFinite(gb) ? gb : Number.MAX_SAFE_INTEGER;
    return na - nb || a.execIdx - b.execIdx || a.slotIdx - b.slotIdx;
  });
  return all;
}

function enforceRoleBalance(week: any): void {
  const total = countTotalSlots(week);
  if (total <= 0) return;

  const dist = computeStrategicRoleDistribution(week);
  const max = Object.values(dist).reduce((a, b) => Math.max(a, b), 0);
  if (max / total <= 0.6) return;

  // deterministic rebalance: rotate roles by narrative order
  const slotsOrdered = sortSlotsByNarrativeOrder(week);
  for (let i = 0; i < slotsOrdered.length; i += 1) {
    const slot = slotsOrdered[i]!.slot;
    if (!slot?.intent || typeof slot.intent !== 'object') continue;
    slot.intent.strategic_role = ROLE_ROTATION_ORDER[i % ROLE_ROTATION_ORDER.length]!;
  }

  const dist2 = computeStrategicRoleDistribution(week);
  const max2 = Object.values(dist2).reduce((a, b) => Math.max(a, b), 0);
  if (max2 / total > 0.6) {
    throw new Error('DETERMINISTIC_WEEKLY_ROLE_BALANCE_REQUIRED');
  }
}

function enforceHeavyFormatControl(week: any): void {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  const total = countTotalSlots(week);
  if (total <= 0) return;
  const allowedHeavy = Math.floor(total * 0.3);

  let heavySlots = 0;
  for (const exec of execItems) {
    const ct = normalizeContentType(exec?.content_type ?? exec?.contentType ?? '');
    if (!HEAVY_TYPES.has(ct)) continue;
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    heavySlots += slots.length;
  }
  if (heavySlots <= allowedHeavy) return;

  let overflow = heavySlots - allowedHeavy;
  // deterministic conversion: walk execution_items in order; convert tail slots first to feed_post via split when needed
  for (let execIdx = 0; execIdx < execItems.length && overflow > 0; execIdx += 1) {
    const exec = execItems[execIdx];
    const ct = normalizeContentType(exec?.content_type ?? exec?.contentType ?? '');
    if (!HEAVY_TYPES.has(ct)) continue;
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    const count = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0) || 0));
    if (slots.length !== count) continue;
    if (slots.length === 0) continue;

    if (overflow >= slots.length) {
      exec.content_type = 'feed_post';
      overflow -= slots.length;
      continue;
    }

    // split: move last `overflow` slots into a new feed_post execution item
    const move = overflow;
    const movedSlots = slots.splice(slots.length - move, move);
    exec.count_per_week = slots.length;
    // re-sequence progression_step for remaining slots
    for (let i = 0; i < slots.length; i += 1) {
      slots[i]!.progression_step = i + 1;
    }

    const newExec = {
      ...exec,
      content_type: 'feed_post',
      count_per_week: movedSlots.length,
      topic_slots: movedSlots,
    };
    for (let i = 0; i < movedSlots.length; i += 1) {
      movedSlots[i]!.progression_step = i + 1;
    }

    execItems.splice(execIdx + 1, 0, newExec);
    overflow = 0;
  }

  if (overflow > 0) {
    throw new Error('DETERMINISTIC_WEEKLY_LOAD_OVERFLOW');
  }

  // verify heavy <= 30% after conversion
  let heavyAfter = 0;
  const totalAfter = countTotalSlots(week);
  for (const exec of execItems) {
    const ct = normalizeContentType(exec?.content_type ?? exec?.contentType ?? '');
    if (!HEAVY_TYPES.has(ct)) continue;
    heavyAfter += (Array.isArray(exec?.topic_slots) ? exec.topic_slots.length : 0);
  }
  if (totalAfter > 0 && heavyAfter / totalAfter > 0.3) {
    throw new Error('DETERMINISTIC_WEEKLY_LOAD_OVERFLOW');
  }
}

function enforcePlatformDominance(week: any): void {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  if (execItems.length === 0) return;

  // If the plan only uses a single platform, dominance is unavoidable and should not block execution.
  // Deterministically accept the allocation as-is.
  const usedPlatforms = new Set<string>();
  for (const exec of execItems) {
    const selected: string[] = Array.isArray(exec?.selected_platforms)
      ? exec.selected_platforms.map(normalizePlatformKey).filter(Boolean)
      : [];
    for (const p of selected) usedPlatforms.add(p);
  }
  if (usedPlatforms.size <= 1) {
    (week as any).platform_allocation = computePlatformAllocationFromExecution(week);
    return;
  }

  const recalc = (): { allocation: Record<string, number>; total: number; dominant: { platform: string; count: number } | null } => {
    const allocation = computePlatformAllocationFromExecution(week);
    const entries = Object.entries(allocation);
    const total = entries.reduce((s, [, c]) => s + (Number(c) || 0), 0);
    if (entries.length === 0 || total <= 0) return { allocation, total, dominant: null };
    entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || String(a[0]).localeCompare(String(b[0])));
    return { allocation, total, dominant: { platform: String(entries[0]![0]), count: Number(entries[0]![1]) || 0 } };
  };

  let state = recalc();
  if (!state.dominant) return;
  if (state.dominant.count / state.total <= 0.7) {
    (week as any).platform_allocation = state.allocation;
    return;
  }

  const attemptMove = (): boolean => {
    state = recalc();
    if (!state.dominant) return false;
    const dom = state.dominant.platform;

    for (let i = 0; i < execItems.length; i += 1) {
      const exec = execItems[i];
      const count = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0) || 0));
      if (count <= 0) continue;
      const selected: string[] = Array.isArray(exec?.selected_platforms)
        ? exec.selected_platforms.map(normalizePlatformKey).filter(Boolean)
        : [];
      if (!selected.includes(dom)) continue;

      const options: string[] = Array.isArray(exec?.platform_options)
        ? exec.platform_options.map(normalizePlatformKey).filter(Boolean)
        : [];
      const uniqueOptions = Array.from(new Set(options)).sort((a, b) => a.localeCompare(b));
      const candidates = uniqueOptions.filter((p) => p && p !== dom);
      if (candidates.length === 0) continue;

      // deterministic target: lowest current allocation, tie -> alphabetical
      candidates.sort((a, b) => (state.allocation[a] ?? 0) - (state.allocation[b] ?? 0) || a.localeCompare(b));
      const target = candidates[0]!;

      exec.selected_platforms = [target];
      (week as any).platform_allocation = computePlatformAllocationFromExecution(week);
      return true;
    }
    return false;
  };

  // Iterate moves until dominance resolved or no more moves possible.
  for (let guard = 0; guard < execItems.length + 5; guard += 1) {
    state = recalc();
    if (!state.dominant) break;
    if (state.dominant.count / state.total <= 0.7) break;
    const moved = attemptMove();
    if (!moved) throw new Error('DETERMINISTIC_PLATFORM_LOAD_IMBALANCE');
  }

  state = recalc();
  if (state.dominant && state.total > 0 && state.dominant.count / state.total > 0.7) {
    throw new Error('DETERMINISTIC_PLATFORM_LOAD_IMBALANCE');
  }
  (week as any).platform_allocation = state.allocation;
}

function recomputeContentTypeMix(week: any): void {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  const totals: Record<string, number> = {};
  for (const exec of execItems) {
    const ct = normalizeContentType(exec?.content_type ?? exec?.contentType ?? '');
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    if (!ct || slots.length === 0) continue;
    totals[ct] = (totals[ct] ?? 0) + slots.length;
  }
  const mix = Object.entries(totals)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))
    .map(([ct, n]) => `${n} ${ct}`);
  (week as any).content_type_mix = mix;
}

export function balanceWeeklyExecutionLoad(weeks: unknown): any[] {
  if (!Array.isArray(weeks)) return [];
  const arr = (weeks as any[]).map((w) => w);
  const ordered = arr
    .map((w, idx) => ({ w, idx, ord: weekOrdinal(w, idx) }))
    .sort((a, b) => a.ord - b.ord || a.idx - b.idx);

  for (const entry of ordered) {
    const w = entry.w as WeekLike;
    if (!Array.isArray((w as any)?.execution_items)) continue;
    enforceRoleBalance(w);
    enforceHeavyFormatControl(w);
    enforcePlatformDominance(w);
    recomputeContentTypeMix(w);
  }

  return ordered.map((x) => x.w);
}

