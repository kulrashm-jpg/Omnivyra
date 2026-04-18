import type { StructuredPlan } from './types';

export function applyLocalWeekTextReplacement(
  plan: StructuredPlan,
  weekNumber: number,
  rawOldText: string,
  newTextRaw: string
): { nextPlan: StructuredPlan; replacedCount: number } {
  const oldText = (rawOldText || '').trim();
  const newText = (newTextRaw || '').trim();
  if (!oldText || !newText || !plan?.weeks?.length) return { nextPlan: plan, replacedCount: 0 };

  const normalizeCandidate = (s: string) => {
    const t = s.trim();
    const m = t.match(/^([A-Za-z][A-Za-z\s()\/-]*):\s*(.+)$/);
    return m ? m[2].trim() : t;
  };

  const candidates = Array.from(new Set([oldText, normalizeCandidate(oldText)])).filter(Boolean);
  const escapeRegExp = (s: string) => s.replace(new RegExp('[.*+?^${}()|[\\]\\\\]', 'g'), '\\$&');

  const deepReplace = (value: any, needle: string): { next: any; count: number } => {
    if (typeof value === 'string') {
      if (value.includes(needle)) {
        const re = new RegExp(escapeRegExp(needle), 'g');
        const matches = value.match(re);
        return { next: value.replace(re, newText), count: matches ? matches.length : 0 };
      }
      const tokens = needle.trim().split(/\s+/).filter(Boolean);
      if (tokens.length >= 3 && needle.length >= 12) {
        const reWs = new RegExp(tokens.map(escapeRegExp).join('\\s+'), 'g');
        const matches = value.match(reWs);
        if (matches?.length) return { next: value.replace(reWs, newText), count: matches.length };
      }
      return { next: value, count: 0 };
    }
    if (Array.isArray(value)) {
      let changed = false;
      let count = 0;
      const nextArr = value.map((item) => {
        const r = deepReplace(item, needle);
        if (r.count > 0) changed = true;
        count += r.count;
        return r.next;
      });
      return { next: changed ? nextArr : value, count };
    }
    if (value && typeof value === 'object') {
      let changed = false;
      let count = 0;
      const nextObj: any = { ...(value as any) };
      for (const [k, v] of Object.entries(value)) {
        const r = deepReplace(v, needle);
        if (r.count > 0) changed = true;
        count += r.count;
        nextObj[k] = r.next;
      }
      return { next: changed ? nextObj : value, count };
    }
    return { next: value, count: 0 };
  };

  let replacedCount = 0;
  const weeks = plan.weeks.map((w) => {
    if (w.week !== weekNumber) return w;
    let updated: any = w;
    let total = 0;
    for (const needle of candidates) {
      const r = deepReplace(updated, needle);
      updated = r.next;
      total += r.count;
    }
    replacedCount = total;
    return total > 0 ? updated : w;
  });

  return { nextPlan: replacedCount > 0 ? { ...plan, weeks } : plan, replacedCount };
}
