export const CREATOR_DEPENDENT_PLANNING_LABELS = [
  'Videos',
  'Long Videos',
  'Carousels',
  'Images',
  'Shorts',
  'Reels',
  'Songs',
  'Audio',
  'Podcasts',
  'Slides',
  'Slideware',
] as const;

export const PLANNING_CONTENT_TYPE_LABELS = [
  'Text posts',
  'Videos',
  'Long Videos',
  'Blogs',
  'Articles',
  'White Papers',
  'Carousels',
  'Images',
  'Stories',
  'Threads',
  'Shorts',
  'Reels',
  'Spaces',
  'Songs',
  'Audio',
  'Podcasts',
  'Newsletters',
  'Webinars',
  'Slides',
  'Slideware',
] as const;

export function prettyContentTypeLabel(contentType: string): string {
  const t = String(contentType || '').trim();
  if (!t) return '';
  if (t === 'feed_post') return 'Post';
  if (t === 'tweet') return 'Post';
  if (t === 'short') return 'Short';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function canonicalPlanningTypeLabel(label: string): string {
  const s = String(label || '').trim();
  if (!s) return '';
  const n = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n === 'post' || n === 'posts' || n === 'text post' || n === 'text posts' || n === 'textpost' || n === 'textposts') return 'Text posts';
  if (n === 'text' || n === 'texts') return 'Text posts';
  if (n === 'video' || n === 'videos') return 'Videos';
  if (n === 'long video' || n === 'long videos' || n === 'long-form video' || n === 'long-form videos') return 'Long Videos';
  if (n === 'blog' || n === 'blogs') return 'Blogs';
  if (n === 'article' || n === 'articles') return 'Articles';
  if (n === 'white paper' || n === 'white papers' || n === 'whitepaper' || n === 'whitepapers') return 'White Papers';
  if (n === 'document' || n === 'documents' || n === 'pdf' || n === 'pdfs') return 'White Papers';
  if (n === 'carousel' || n === 'carousels') return 'Carousels';
  if (n === 'image' || n === 'images') return 'Images';
  if (n === 'story' || n === 'stories') return 'Stories';
  if (n === 'thread' || n === 'threads') return 'Threads';
  if (n === 'short' || n === 'shorts') return 'Shorts';
  if (n === 'reel' || n === 'reels') return 'Reels';
  if (n === 'live' || n === 'lives') return 'Videos';
  if (n === 'space' || n === 'spaces') return 'Spaces';
  if (n === 'song' || n === 'songs') return 'Songs';
  if (n === 'audio') return 'Audio';
  if (n === 'podcast' || n === 'podcasts') return 'Podcasts';
  if (n === 'newsletter' || n === 'newsletters') return 'Newsletters';
  if (n === 'webinar' || n === 'webinars') return 'Webinars';
  if (n === 'slide' || n === 'slides') return 'Slides';
  if (n === 'slideware') return 'Slideware';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function planningLabelToParseKeyAndTag(label: string): { parseKey: string; tag?: string; displayUnit?: string } {
  const canon = canonicalPlanningTypeLabel(label);
  switch (canon) {
    case 'Posts':
    case 'Text posts':
      return { parseKey: 'post' };
    case 'Images':
      return { parseKey: 'post', tag: 'image' };
    case 'Carousels':
      return { parseKey: 'post', tag: 'carousel' };
    case 'Videos':
      return { parseKey: 'video' };
    case 'Reels':
      return { parseKey: 'video', tag: 'reels' };
    case 'Shorts':
      return { parseKey: 'video', tag: 'shorts' };
    case 'Spaces':
      return { parseKey: 'video', tag: 'spaces' };
    case 'Songs':
      return { parseKey: 'video', tag: 'song' };
    case 'Audio':
      return { parseKey: 'video', tag: 'audio' };
    case 'Podcasts':
      return { parseKey: 'video', tag: 'podcast' };
    case 'Long Videos':
      return { parseKey: 'video', tag: 'long-form' };
    case 'Blogs':
      return { parseKey: 'blog' };
    case 'Articles':
      return { parseKey: 'blog', tag: 'article' };
    case 'White Papers':
      return { parseKey: 'blog', displayUnit: 'white paper' };
    case 'Newsletters':
      return { parseKey: 'blog', tag: 'newsletter' };
    case 'Webinars':
      return { parseKey: 'blog', tag: 'webinar' };
    case 'Slides':
    case 'Slideware':
      return { parseKey: 'blog', tag: 'slides' };
    case 'Stories':
      return { parseKey: 'story' };
    case 'Threads':
      return { parseKey: 'thread' };
    default:
      return { parseKey: 'post', tag: canon.toLowerCase() };
  }
}

export function computeEligiblePlanningTypeSet(hints: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of hints || []) {
    const canon = canonicalPlanningTypeLabel(raw);
    if (canon) out.add(canon);
  }
  return out;
}

export function extractPlanningTypeHintsFromCapacityValue(value: unknown): string[] {
  const out = new Set<string>();
  const add = (label: string) => {
    const canon = canonicalPlanningTypeLabel(label);
    if (canon) out.add(canon);
  };

  const text = typeof value === 'string' ? value : '';
  if (text) {
    const t = text.toLowerCase();
    const hasPositive = (re: RegExp): boolean => {
      let m: RegExpExecArray | null = null;
      while ((m = re.exec(t)) !== null) {
        const n = Number(m[1] || 0);
        if (Number.isFinite(n) && n > 0) return true;
      }
      return false;
    };

    if (hasPositive(/\b(\d{1,3})\s*white\s*papers?\b/g) || hasPositive(/\b(\d{1,3})\s*whitepapers?\b/g)) add('White Papers');
    if (hasPositive(/\b(\d{1,3})\s*blogs?\b/g)) add('Blogs');
    if (hasPositive(/\b(\d{1,3})\s*articles?\b/g)) add('Articles');
    if (hasPositive(/\b(\d{1,3})\s*(?:posts?|feed\s*posts?|text\s*posts?)\b/g)) add('Text posts');
    if (hasPositive(/\b(\d{1,3})\s*videos?\b/g)) add('Videos');
    if (hasPositive(/\b(\d{1,3})\s*reels?\b/g)) add('Reels');
    if (hasPositive(/\b(\d{1,3})\s*shorts?\b/g)) add('Shorts');
    if (hasPositive(/\b(\d{1,3})\s*threads?\b/g)) add('Threads');
    if (hasPositive(/\b(\d{1,3})\s*stories?\b/g)) add('Stories');
    if (hasPositive(/\b(\d{1,3})\s*carousels?\b/g)) add('Carousels');
    if (hasPositive(/\b(\d{1,3})\s*images?\b/g)) add('Images');
    if (hasPositive(/\b(\d{1,3})\s*podcasts?\b/g)) add('Podcasts');
    if (hasPositive(/\b(\d{1,3})\s*(?:audio|songs?)\b/g)) add('Audio');
    if (hasPositive(/\b(\d{1,3})\s*spaces?\b/g)) add('Spaces');
    if (hasPositive(/\b(\d{1,3})\s*(?:slides?|slideware)\b/g)) add('Slides');
    return Array.from(out);
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    };

    if (num(obj.post) > 0) add('Text posts');
    if (num(obj.video) > 0) add('Videos');
    if (num(obj.blog) > 0) add('Blogs');
    if (num(obj.story) > 0) add('Stories');
    if (num(obj.thread) > 0) add('Threads');

    const breakdown = obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
      ? (obj.breakdown as Record<string, unknown>)
      : null;
    if (breakdown) {
      const map: Record<string, string> = {
        reels: 'Reels',
        shorts: 'Shorts',
        long_videos: 'Long Videos',
        carousels: 'Carousels',
        images: 'Images',
        white_papers: 'White Papers',
        articles: 'Articles',
        newsletters: 'Newsletters',
        webinars: 'Webinars',
        slides: 'Slides',
        podcasts: 'Podcasts',
        audio: 'Audio',
        spaces: 'Spaces',
      };
      for (const [k, v] of Object.entries(breakdown)) {
        if (num(v) <= 0) continue;
        const label = map[String(k || '').toLowerCase()];
        if (label) add(label);
      }
    }
  }

  return Array.from(out);
}

export function isEligiblePlanningType(candidate: string, eligible: Set<string>): boolean {
  if (eligible.size === 0) {
    const c0 = canonicalPlanningTypeLabel(candidate);
    if (!c0) return false;
    return ['Text posts', 'Posts', 'Images', 'Carousels', 'Blogs', 'Articles', 'White Papers', 'Threads', 'Stories'].includes(c0);
  }
  const c = canonicalPlanningTypeLabel(candidate);
  if (!c) return false;
  if (eligible.has(c)) return true;
  if (eligible.has('Videos') && ['Reels', 'Shorts', 'Long Videos', 'Spaces', 'Audio', 'Podcasts'].includes(c)) return true;
  if ((eligible.has('Posts') || eligible.has('Text posts')) && ['Images', 'Carousels'].includes(c)) return true;
  if (eligible.has('Blogs') && ['Articles', 'White Papers', 'Newsletters', 'Webinars', 'Slides', 'Slideware'].includes(c)) return true;
  if (c === 'Articles' && eligible.has('Articles')) return true;
  if (c === 'Blogs' && eligible.has('Articles')) return true;
  return false;
}

export function getPlatformSupportedPlanningTypes(platform: string, platformContentTypeOptions: Record<string, string[]>): Set<string> {
  const key = String(platform || '').toLowerCase().trim();
  const raw = platformContentTypeOptions[key] || [];
  const supportedCanon = new Set<string>(raw.map(canonicalPlanningTypeLabel).filter(Boolean));

  if (key === 'linkedin') {
    ['Text posts', 'Posts', 'Images', 'Carousels', 'Videos', 'Articles', 'White Papers'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'facebook') {
    ['Text posts', 'Posts', 'Images', 'Carousels', 'Videos', 'Reels', 'Stories'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'instagram') {
    ['Text posts', 'Posts', 'Images', 'Carousels', 'Videos', 'Reels', 'Stories'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'x' || key === 'twitter') {
    ['Text posts', 'Posts', 'Threads', 'Spaces', 'Videos'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'youtube') {
    ['Videos', 'Long Videos', 'Shorts'].forEach((t) => supportedCanon.add(t));
  }

  if (supportedCanon.has('Articles') || supportedCanon.has('White Papers')) supportedCanon.add('Blogs');
  if (supportedCanon.has('Images') || supportedCanon.has('Carousels')) {
    supportedCanon.add('Text posts');
    supportedCanon.add('Posts');
  }
  if (supportedCanon.has('Reels') || supportedCanon.has('Shorts') || supportedCanon.has('Long Videos')) supportedCanon.add('Videos');

  return supportedCanon;
}

export function getAllSupportedContentTypeKeysForPlatform(
  platform: string,
  platformContentTypeRawOptions: Record<string, string[]>,
  platformContentTypeOptions: Record<string, string[]>
): string[] {
  const rawFromCatalog = platformContentTypeRawOptions[platform] || [];
  const supportedCanon = getPlatformSupportedPlanningTypes(platform, platformContentTypeOptions);
  const covered = new Set(rawFromCatalog.map((r) => canonicalPlanningTypeLabel(prettyContentTypeLabel(r))).filter(Boolean));
  const additional = Array.from(supportedCanon).filter((c) => !covered.has(c));
  return [...rawFromCatalog, ...additional];
}

export function getEligiblePlatformPlanningTypeOptions(args: {
  platform: string;
  platformContentTypeOptions: Record<string, string[]>;
  eligible: Set<string>;
}): string[] {
  const supported = getPlatformSupportedPlanningTypes(args.platform, args.platformContentTypeOptions);
  const list = Array.from(supported).filter((opt) => isEligiblePlanningType(opt, args.eligible));
  const priority = new Map<string, number>([
    ['Text posts', 1], ['Images', 2], ['Carousels', 3], ['Blogs', 4], ['Articles', 5],
    ['White Papers', 6], ['Videos', 7], ['Reels', 8], ['Shorts', 9], ['Long Videos', 10],
    ['Stories', 11], ['Threads', 12], ['Spaces', 13], ['Audio', 14], ['Podcasts', 15],
    ['Newsletters', 16], ['Webinars', 17], ['Slides', 18], ['Slideware', 19],
  ]);
  return list.sort((a, b) => (priority.get(a) ?? 999) - (priority.get(b) ?? 999) || a.localeCompare(b));
}
