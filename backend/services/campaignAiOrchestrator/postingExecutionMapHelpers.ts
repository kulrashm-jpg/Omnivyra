import { normalizePlatformKey } from './contentFormatHelpers';

export function buildPostingExecutionMapForWeek(week: any): any[] {
  const normalizePlatform = (p: unknown): string => normalizePlatformKey(String(p ?? ''));
  const normalizeType = (t: unknown): string =>
    String(t ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'post';
  const toInt = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  };
  const uniq = (arr: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of arr) {
      const t = String(raw ?? '').trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };

  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  if (execItems.length === 0) return [];

  const weekNo = toInt(week?.week ?? week?.week_number ?? week?.weekNumber) || 0;
  const entries: any[] = [];

  for (let execution_index = 0; execution_index < execItems.length; execution_index += 1) {
    const exec = execItems[execution_index];
    const content_type = normalizeType(exec?.content_type ?? exec?.contentType ?? 'post');
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];

    const selectedPlatformsRaw: string[] = Array.isArray(exec?.selected_platforms)
      ? exec.selected_platforms.map(normalizePlatform).filter(Boolean)
      : [];
    const platformOptionsRaw: string[] = Array.isArray(exec?.platform_options)
      ? exec.platform_options.map(normalizePlatform).filter(Boolean)
      : [];
    const defaultPlatforms = selectedPlatformsRaw.length > 0 ? selectedPlatformsRaw : platformOptionsRaw;

    const slotPlatformsRaw: string[][] = Array.isArray(exec?.slot_platforms)
      ? (exec.slot_platforms as any[]).map((arr) =>
          Array.isArray(arr) ? arr.map(normalizePlatform).filter(Boolean) : []
        )
      : [];

    for (let slot_index = 0; slot_index < slots.length; slot_index += 1) {
      const slot = slots[slot_index];
      const global_progression_index = toInt(slot?.global_progression_index ?? 0);
      const platformsForSlot = uniq(
        slotPlatformsRaw[slot_index] && slotPlatformsRaw[slot_index]!.length > 0
          ? slotPlatformsRaw[slot_index]!
          : defaultPlatforms
      ).sort((a, b) => a.localeCompare(b));

      for (const platform of platformsForSlot) {
        entries.push({
          posting_id: '',
          platform,
          content_type,
          topic_slot_ref: {
            execution_index,
            slot_index,
            global_progression_index,
          },
          posting_order: 0,
          __sort: {
            g: global_progression_index > 0 ? global_progression_index : Number.MAX_SAFE_INTEGER,
            p: platform,
            t: content_type,
          },
          __wk: weekNo,
        });
      }
    }
  }

  entries.sort((a, b) => {
    const ga = Number(a?.__sort?.g ?? Number.MAX_SAFE_INTEGER);
    const gb = Number(b?.__sort?.g ?? Number.MAX_SAFE_INTEGER);
    if (ga !== gb) return ga - gb;
    const pa = String(a?.__sort?.p ?? '');
    const pb = String(b?.__sort?.p ?? '');
    if (pa !== pb) return pa.localeCompare(pb);
    const ta = String(a?.__sort?.t ?? '');
    const tb = String(b?.__sort?.t ?? '');
    return ta.localeCompare(tb);
  });

  const wk = weekNo > 0 ? weekNo : toInt(week?.week ?? week?.week_number ?? week?.weekNumber) || 0;
  for (let i = 0; i < entries.length; i += 1) {
    const idx = i + 1;
    const platform = String(entries[i]?.platform ?? '').trim().toLowerCase();
    const ct = String(entries[i]?.content_type ?? '').trim().toLowerCase();
    entries[i].posting_order = idx;
    entries[i].posting_id = `wk${wk}-p${idx}-${platform}-${ct}`;
    delete entries[i].__sort;
    delete entries[i].__wk;
  }

  return entries;
}

export function attachPostingExecutionMapsToWeeks(weeks: any[]): void {
  if (!Array.isArray(weeks) || weeks.length === 0) return;

  for (const week of weeks) {
    const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
    if (execItems.length === 0) {
      if (week && typeof week === 'object' && (week as any).posting_execution_map == null) {
        (week as any).posting_execution_map = [];
      }
      continue;
    }

    const existing = (week as any)?.posting_execution_map;
    if (Array.isArray(existing) && existing.length > 0) continue;
    (week as any).posting_execution_map = buildPostingExecutionMapForWeek(week);
  }

  for (const week of weeks) {
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    const map: any[] = Array.isArray((week as any)?.posting_execution_map) ? (week as any).posting_execution_map : [];
    if (map.length === 0) continue;

    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    const seen = new Set<string>();
    let duplicates = 0;
    let invalidRefs = 0;

    for (const entry of map) {
      const posting_id = String(entry?.posting_id ?? '').trim();
      if (posting_id) {
        if (seen.has(posting_id)) duplicates += 1;
        seen.add(posting_id);
      }
      const ref = entry?.topic_slot_ref ?? {};
      const execution_index = Number(ref?.execution_index);
      const slot_index = Number(ref?.slot_index);
      if (!Number.isFinite(execution_index) || execution_index < 0 || execution_index >= execItems.length) {
        invalidRefs += 1;
        continue;
      }
      const slots: any[] = Array.isArray(execItems[execution_index]?.topic_slots) ? execItems[execution_index].topic_slots : [];
      if (!Number.isFinite(slot_index) || slot_index < 0 || slot_index >= slots.length) {
        invalidRefs += 1;
      }
    }

    if (duplicates > 0 || invalidRefs > 0) {
      console.warn('[weekly-posting-execution-map][validation]', {
        week: weekNo || null,
        entries: map.length,
        duplicates,
        invalidRefs,
      });
    }
  }
}
