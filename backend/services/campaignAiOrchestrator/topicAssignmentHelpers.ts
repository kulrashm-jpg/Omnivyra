export function deriveTopicWeights(
  topicsToCover: unknown,
  weeklyContextCapsule: unknown
): Array<{ topic: string; weight: number }> {
  const rawTopics = Array.isArray(topicsToCover)
    ? topicsToCover.map((t) => String(t ?? '').trim()).filter(Boolean)
    : [];
  const uniqueTopics: string[] = [];
  const seen = new Set<string>();
  for (const t of rawTopics) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTopics.push(t);
  }

  const capsule = weeklyContextCapsule && typeof weeklyContextCapsule === 'object'
    ? (weeklyContextCapsule as Record<string, unknown>)
    : null;
  const explicitByTopic = new Map<string, number>();
  const explicitRaw = capsule ? (capsule as any)?.topic_priorities ?? (capsule as any)?.topic_importance ?? null : null;
  if (Array.isArray(explicitRaw)) {
    for (const row of explicitRaw) {
      const topic = String((row as any)?.topic ?? (row as any)?.title ?? '').trim();
      const weightRaw = (row as any)?.weight ?? (row as any)?.importance ?? (row as any)?.priority;
      const w = Number(weightRaw);
      if (!topic) continue;
      if (!Number.isFinite(w)) continue;
      explicitByTopic.set(topic.toLowerCase(), Math.max(1, Math.min(3, Math.floor(w))));
    }
  }

  const parseExplicitWeightFromText = (topic: string): number | null => {
    const n = topic.toLowerCase();
    if (/\b(weight|importance)\s*[:=]\s*(\d)\b/.test(n)) {
      const m = n.match(/\b(?:weight|importance)\s*[:=]\s*(\d)\b/);
      const w = m ? Number(m[1]) : NaN;
      if (Number.isFinite(w)) return Math.max(1, Math.min(3, Math.floor(w)));
    }
    if (/\b(priority)\s*[:=]\s*(high|p1|1)\b/.test(n) || /\b(high priority|p1)\b/.test(n)) return 3;
    if (/\b(priority)\s*[:=]\s*(medium|p2|2)\b/.test(n) || /\b(medium priority|p2)\b/.test(n)) return 2;
    if (/\b(priority)\s*[:=]\s*(low|p3|3)\b/.test(n) || /\b(low priority|p3)\b/.test(n)) return 1;
    return null;
  };

  return uniqueTopics.map((topic, idx) => {
    const explicit =
      explicitByTopic.get(topic.toLowerCase()) ??
      parseExplicitWeightFromText(topic);
    const fallback = idx === 0 ? 3 : idx === 1 ? 2 : 1;
    const weight = explicit != null ? explicit : fallback;
    return { topic, weight };
  });
}

export function weightedAssignment(
  topicsWithWeights: Array<{ topic: string; weight: number }>,
  slotsCount: number
): Array<string | null> {
  const topics = (topicsWithWeights || []).filter((t) => t?.topic);
  const nSlots = Math.max(0, Math.floor(slotsCount));
  if (nSlots === 0) return [];
  if (topics.length === 0) return Array.from({ length: nSlots }, () => null);

  const expanded: string[] = [];
  for (const t of topics) {
    const w = Math.max(1, Math.floor(Number(t.weight) || 1));
    for (let i = 0; i < w; i += 1) expanded.push(t.topic);
  }
  if (expanded.length === 0) return Array.from({ length: nSlots }, () => null);

  const uniqueTopics = topics.map((t) => t.topic);
  if (nSlots >= uniqueTopics.length) {
    const slots: string[] = [...uniqueTopics];
    const remaining = nSlots - slots.length;
    const reduced: string[] = [];
    const usedOnce = new Map<string, number>(uniqueTopics.map((t) => [t, 1]));
    for (const t of expanded) {
      const u = usedOnce.get(t) ?? 0;
      if (u > 0) {
        usedOnce.set(t, u - 1);
        continue;
      }
      reduced.push(t);
    }
    const pool = reduced.length > 0 ? reduced : expanded;
    for (let i = 0; i < remaining; i += 1) {
      slots.push(pool[i % pool.length]!);
    }
    return slots.slice(0, nSlots);
  }

  const slots: string[] = [];
  for (let i = 0; i < nSlots; i += 1) {
    slots.push(expanded[i % expanded.length]!);
  }
  return slots;
}
