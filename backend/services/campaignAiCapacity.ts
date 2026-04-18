export type StructuredCapacityCounts = {
  post: number;
  video: number;
  blog: number;
  story: number;
  thread: number;
};

export type StructuredCapacityBreakdown = Record<string, number>;
export type StructuredCapacityCountsWithBreakdown = StructuredCapacityCounts & {
  breakdown?: StructuredCapacityBreakdown;
  _declared_none?: boolean;
};

const EMPTY_CAPACITY_COUNTS: StructuredCapacityCounts = {
  post: 0,
  video: 0,
  blog: 0,
  story: 0,
  thread: 0,
};

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function parseFrequencyPerWeek(s: string): number {
  const t = String(s || '').trim().toLowerCase();
  const m = t.match(/^(\d+)\s*\/?\s*w/);
  if (m) return clampInt(parseInt(m[1] || '0', 10));
  if (/^daily$/i.test(t) || /^daily\b/.test(t)) return 5;
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n >= 0) return clampInt(n);
  return 0;
}

function parseCountsFromText(text: string): StructuredCapacityCounts {
  const t = String(text || '').toLowerCase();
  const out: StructuredCapacityCounts = { ...EMPTY_CAPACITY_COUNTS };
  const isNo =
    /\b(no|none|zero|don'?t have|do not have|not yet|n\/a)\b/.test(t) && !/\b\d+\b/.test(t);
  if (isNo) return out;

  const addMatches = (re: RegExp, key: keyof StructuredCapacityCounts) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n > 0) out[key] += n;
    }
  };

  addMatches(/\b(\d{1,3})\s*(?:posts?|feed\s*posts?)\b/g, 'post');
  addMatches(/\b(\d{1,3})\s*videos?\b/g, 'video');
  addMatches(/\b(\d{1,3})\s*(?:blogs?|articles?)\b/g, 'blog');
  addMatches(/\b(\d{1,3})\s*white\s*papers?\b/g, 'blog');
  addMatches(/\b(\d{1,3})\s*stories?\b/g, 'story');
  addMatches(/\b(\d{1,3})\s*threads?\b/g, 'thread');

  return out;
}

function parseCountsWithBreakdownFromText(text: string): { counts: StructuredCapacityCounts; breakdown: StructuredCapacityBreakdown } {
  const t = String(text || '').toLowerCase();
  const breakdown: StructuredCapacityBreakdown = {};
  const counts: StructuredCapacityCounts = parseCountsFromText(text);

  const addBreakdown = (key: string, n: number) => {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return;
    const v = clampInt(n);
    if (v <= 0) return;
    breakdown[k] = (breakdown[k] ?? 0) + v;
  };

  const addMatchesBreakdown = (re: RegExp, breakdownKey: string, rollup: keyof StructuredCapacityCounts) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n <= 0) continue;
      addBreakdown(breakdownKey, n);
      counts[rollup] += n;
    }
  };

  const addMatchesBreakdownOnly = (re: RegExp, breakdownKey: string) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n <= 0) continue;
      addBreakdown(breakdownKey, n);
    }
  };

  addMatchesBreakdown(/\b(\d{1,3})\s*reels?\b/g, 'reels', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*shorts?\b/g, 'shorts', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:long[-\s]?form|long)\s*videos?\b/g, 'long_videos', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*carousels?\b/g, 'carousels', 'post');
  addMatchesBreakdown(/\b(\d{1,3})\s*images?\b/g, 'images', 'post');
  addMatchesBreakdownOnly(/\b(\d{1,3})\s*white\s*papers?\b/g, 'white_papers');
  addMatchesBreakdown(/\b(\d{1,3})\s*lives?\b/g, 'lives', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*spaces?\b/g, 'spaces', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:songs?|audio)\b/g, 'audio', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*podcasts?\b/g, 'podcasts', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*newsletters?\b/g, 'newsletters', 'blog');
  addMatchesBreakdown(/\b(\d{1,3})\s*webinars?\b/g, 'webinars', 'blog');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:slides?|slideware)\b/g, 'slides', 'blog');

  const tagToKey = (tag: string): string | null => {
    const n = String(tag || '').toLowerCase();
    if (n.includes('reel')) return 'reels';
    if (n.includes('short')) return 'shorts';
    if (n.includes('long')) return 'long_videos';
    if (n.includes('carousel')) return 'carousels';
    if (n.includes('image')) return 'images';
    if (n.includes('live')) return 'lives';
    if (n.includes('space')) return 'spaces';
    if (n.includes('podcast')) return 'podcasts';
    if (n.includes('audio') || n.includes('song')) return 'audio';
    if (n.includes('newsletter')) return 'newsletters';
    if (n.includes('webinar')) return 'webinars';
    if (n.includes('slide')) return 'slides';
    if (n.includes('article')) return 'articles';
    if (n.includes('white')) return 'white_papers';
    return null;
  };

  const taggedVideo = /\b(\d{1,3})\s*videos?(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  let m: RegExpExecArray | null = null;
  while ((m = taggedVideo.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }
  const taggedPost = /\b(\d{1,3})\s*(?:posts?|feed\s*posts?)(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  while ((m = taggedPost.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }
  const taggedBlog = /\b(\d{1,3})\s*(?:blogs?|articles?)(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  while ((m = taggedBlog.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }

  return { counts, breakdown };
}

const PLANNING_LABEL_TO_KEY: Record<string, keyof StructuredCapacityCounts> = {
  post: 'post', posts: 'post', 'text post': 'post', 'text posts': 'post',
  carousel: 'post', carousels: 'post', image: 'post', images: 'post',
  video: 'video', videos: 'video', 'long videos': 'video', 'long video': 'video',
  reel: 'video', reels: 'video', short: 'video', shorts: 'video',
  song: 'video', songs: 'video', audio: 'video', podcast: 'video', podcasts: 'video',
  space: 'video', spaces: 'video',
  blog: 'blog', blogs: 'blog',
  article: 'blog', articles: 'blog',
  newsletter: 'blog', newsletters: 'blog',
  'white paper': 'blog', 'white papers': 'blog', whitepaper: 'blog', whitepapers: 'blog',
  webinar: 'blog', webinars: 'blog',
  slide: 'blog', slides: 'blog', slideware: 'blog',
  story: 'story', stories: 'story',
  thread: 'thread', threads: 'thread',
};

export function normalizeCapacityCountsWithBreakdown(value: unknown): StructuredCapacityCountsWithBreakdown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const counts = normalizeCapacityCounts(obj);
    const breakdownRaw = obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
      ? (obj.breakdown as Record<string, unknown>)
      : null;
    const breakdown: StructuredCapacityBreakdown = {};
    if (breakdownRaw) {
      for (const [k, v] of Object.entries(breakdownRaw)) {
        const n = clampInt(typeof v === 'number' ? v : Number(v));
        if (n > 0) breakdown[String(k).toLowerCase()] = n;
      }
    }
    const declaredNone = Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone);
    const withMeta = declaredNone ? ({ ...counts, _declared_none: true } as StructuredCapacityCountsWithBreakdown) : counts;
    return Object.keys(breakdown).length > 0
      ? ({ ...withMeta, breakdown } as StructuredCapacityCountsWithBreakdown)
      : (withMeta as StructuredCapacityCountsWithBreakdown);
  }
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    const isNo =
      /\b(no|none|zero|don'?t have|do not have|no content|not yet|n\/a)\b/.test(t) &&
      !/\b\d+\b/.test(t) &&
      !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/i.test(value);
    const parsed = parseCountsWithBreakdownFromText(value);
    const base: StructuredCapacityCountsWithBreakdown = isNo
      ? ({ ...parsed.counts, _declared_none: true } as StructuredCapacityCountsWithBreakdown)
      : (parsed.counts as StructuredCapacityCountsWithBreakdown);
    return Object.keys(parsed.breakdown).length > 0
      ? ({ ...base, breakdown: parsed.breakdown } as StructuredCapacityCountsWithBreakdown)
      : base;
  }
  return { ...EMPTY_CAPACITY_COUNTS };
}

export function normalizeCapacityCounts(value: unknown): StructuredCapacityCounts {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const out: StructuredCapacityCounts = { ...EMPTY_CAPACITY_COUNTS };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'breakdown' || k === '_declared_none' || k === 'declared_none' || k === 'declaredNone') continue;
      const n = clampInt(typeof v === 'number' ? v : Number(v));
      if (n <= 0) continue;
      const key = PLANNING_LABEL_TO_KEY[k.toLowerCase()] ?? PLANNING_LABEL_TO_KEY[k] ?? (k.toLowerCase() as keyof StructuredCapacityCounts);
      if (key && key in out) {
        out[key] += n;
      } else if (['post', 'video', 'blog', 'story', 'thread'].includes(String(k).toLowerCase())) {
        out[k.toLowerCase() as keyof StructuredCapacityCounts] += n;
      } else {
        out.post += n;
      }
    }
    return out;
  }
  if (typeof value === 'string') return parseCountsFromText(value);
  return { ...EMPTY_CAPACITY_COUNTS };
}
