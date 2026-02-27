export type CampaignWaveItem = {
  platform: string;
  topic: string;
  base_date: string; // YYYY-MM-DD
  stability?: 'stable' | 'unstable' | 'unknown';
};

export type WaveAssignment = {
  wave_group_id: string;
  wave_order: number;
  wave_offset_days: number;
  scheduled_date: string; // YYYY-MM-DD
};

function normalizeKey(value: any): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeTopic(value: any): string {
  const s = String(value || '').trim();
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addDaysToIsoDate(dateOnly: string, offsetDays: number): string {
  const [y, m, d] = String(dateOnly || '').split('-').map((n) => Number(n));
  if (!y || !m || !d) return dateOnly;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(offsetDays) || 0));
  return dt.toISOString().slice(0, 10);
}

function waveOffsetForIndex(index: number): number {
  // Rules:
  // primary = day 0
  // secondary = +1 or +2 days (choose +1 deterministically)
  // tertiary = +3 to +5 days (choose +3, then +4, +5 deterministically)
  // if more than 5 platforms, continue increasing offsets.
  if (index <= 0) return 0;
  if (index === 1) return 1;
  if (index === 2) return 3;
  if (index === 3) return 4;
  if (index === 4) return 5;
  return 5 + (index - 4);
}

function stabilityRank(s?: string): number {
  if (s === 'stable') return 0;
  if (s === 'unknown') return 1;
  if (s === 'unstable') return 2;
  return 1;
}

/**
 * Deterministic wave schedule for shared topics across platforms.
 * Groups by (base_date, normalized topic). Orders platforms by stability then key.
 */
export function generatePlatformWaveSchedule(
  dailyItems: CampaignWaveItem[]
): Map<string, WaveAssignment> {
  const items = Array.isArray(dailyItems) ? dailyItems : [];

  const groups = new Map<string, CampaignWaveItem[]>();
  for (const it of items) {
    const base_date = String(it?.base_date || '').slice(0, 10);
    const topicKey = normalizeTopic(it?.topic);
    const platform = normalizeKey(it?.platform);
    if (!base_date || !topicKey || !platform) continue;
    const groupKey = `${base_date}::${topicKey}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push({ ...it, base_date, topic: String(it.topic || ''), platform });
    groups.set(groupKey, arr);
  }

  const out = new Map<string, WaveAssignment>();

  for (const [groupKey, groupItems] of groups.entries()) {
    if (groupItems.length < 2) continue; // only wave when topic appears across multiple platforms
    const [base_date, topicKey] = groupKey.split('::');
    const wave_group_id = `wave-${base_date}-${topicKey.replace(/\s+/g, '-').slice(0, 40)}`;

    const ordered = [...groupItems].sort((a, b) => {
      const ar = stabilityRank(a.stability);
      const br = stabilityRank(b.stability);
      if (ar !== br) return ar - br;
      const ap = normalizeKey(a.platform);
      const bp = normalizeKey(b.platform);
      if (ap < bp) return -1;
      if (ap > bp) return 1;
      return 0;
    });

    for (let i = 0; i < ordered.length; i += 1) {
      const it = ordered[i];
      const offset = waveOffsetForIndex(i);
      const scheduled_date = addDaysToIsoDate(base_date, offset);
      const key = `${groupKey}::${normalizeKey(it.platform)}`;
      out.set(key, {
        wave_group_id,
        wave_order: i + 1,
        wave_offset_days: offset,
        scheduled_date,
      });
    }
  }

  return out;
}

