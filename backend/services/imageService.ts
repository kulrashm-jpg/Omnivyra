/**
 * Image Service — Centralized image retrieval layer.
 *
 * Responsibilities:
 *  1. Provider integration: Unsplash, Pexels, Pixabay
 *  2. Normalized response format across all providers
 *  3. Provider fallback logic (primary → secondary → tertiary)
 *  4. In-memory cache with TTL to reduce API calls / rate-limit risk
 *  5. Semantic topic → visual keyword mapping
 *  6. Quality filtering (dimensions, aspect ratio, safe-content)
 *  7. Attribution generation per provider
 *  8. Per-provider rate limit protection (sliding window + Retry-After)
 *  9. Structured logging and monitoring metrics
 */

// ─── Normalized image type ────────────────────────────────────────────────────

export interface NormalizedImage {
  id: string;
  thumb: string;       // ~400 px wide — for grid/picker
  full: string;        // ~1200 px wide — for preview / attachment
  alt: string;
  width: number;
  height: number;
  author: string;
  author_url?: string;
  source_url?: string;
  source: 'unsplash' | 'pexels' | 'pixabay';
  attribution: string; // required credit string
  color?: string;      // dominant hex color hint
}

export interface ImageSearchOptions {
  perPage?: number;        // default 12, max 24
  page?: number;           // 1-based, default 1
  orientation?: 'landscape' | 'portrait' | 'squarish';
  minWidth?: number;       // quality filter — default 600
  minHeight?: number;      // quality filter — default 400
  minAspectRatio?: number; // for landscape: default 1.2 (width/height)
}

export interface ImageSearchResult {
  images: NormalizedImage[];
  query: string;           // resolved query (after semantic mapping)
  originalQuery: string;
  source: string;          // which provider(s) returned results
  fromCache: boolean;
}

export interface ImageServiceMetrics {
  cache: { entries: number; maxEntries: number; ttlMs: number };
  rateLimits: Record<string, { requestsInWindow: number; limit: number; windowMs: number; blockedUntil?: number }>;
  counters: { hits: number; misses: number; rateLimitSkips: number; qualityDropped: number };
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  result: ImageSearchResult;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes
const MAX_CACHE_ENTRIES = 500;

function cacheKey(query: string, opts: ImageSearchOptions): string {
  return `${query.toLowerCase().trim()}::${opts.perPage ?? 12}::${opts.page ?? 1}::${opts.orientation ?? 'landscape'}`;
}

function cacheGet(key: string): ImageSearchResult | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return { ...entry.result, fromCache: true };
}

function cacheSet(key: string, result: ImageSearchResult): void {
  if (_cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Rate limit protection ────────────────────────────────────────────────────

interface RateLimitState {
  timestamps: number[];   // rolling request timestamps
  blockedUntil?: number;  // epoch ms — set from Retry-After header
}

// Conservative limits (below documented free-tier limits to leave headroom)
// Unsplash: 50 req/hr → ~40/hr window; Pexels: 200/hr → ~160/hr; Pixabay: 100/min → ~80/min
const RATE_LIMIT_CONFIG: Record<string, { limit: number; windowMs: number }> = {
  unsplash: { limit: 40,  windowMs: 60 * 60 * 1000 }, // 40 per hour
  pexels:   { limit: 160, windowMs: 60 * 60 * 1000 }, // 160 per hour
  pixabay:  { limit: 80,  windowMs: 60 * 1000 },      // 80 per minute
};

const _rateLimitState: Record<string, RateLimitState> = {
  unsplash: { timestamps: [] },
  pexels:   { timestamps: [] },
  pixabay:  { timestamps: [] },
};

function isRateLimited(provider: string): boolean {
  const state = _rateLimitState[provider];
  const cfg   = RATE_LIMIT_CONFIG[provider];
  if (!state || !cfg) return false;

  const now = Date.now();

  // Check if blocked by Retry-After
  if (state.blockedUntil && now < state.blockedUntil) return true;
  if (state.blockedUntil && now >= state.blockedUntil) delete state.blockedUntil;

  // Prune timestamps outside the rolling window
  state.timestamps = state.timestamps.filter((t) => now - t < cfg.windowMs);

  return state.timestamps.length >= cfg.limit;
}

function recordRequest(provider: string): void {
  const state = _rateLimitState[provider];
  if (state) state.timestamps.push(Date.now());
}

function applyRetryAfter(provider: string, retryAfterSecs: number): void {
  const state = _rateLimitState[provider];
  if (state) {
    state.blockedUntil = Date.now() + retryAfterSecs * 1000;
    imageLog('warn', provider, '', `rate-limited — blocked for ${retryAfterSecs}s`);
  }
}

// ─── Monitoring counters ──────────────────────────────────────────────────────

const _counters = { hits: 0, misses: 0, rateLimitSkips: 0, qualityDropped: 0 };

// ─── Semantic topic → visual keyword mapping ──────────────────────────────────

const SEMANTIC_MAP: Record<string, string[]> = {
  // Wellness / Mental Health
  'mental clarity':         ['mental clarity focus', 'mindfulness meditation', 'peaceful mind'],
  'mental health':          ['mental wellness', 'mindfulness calm', 'self care wellness'],
  'meditation':             ['meditation peaceful', 'mindfulness zen', 'calm focus'],
  'wellness':               ['wellness lifestyle', 'healthy living', 'self care routine'],
  'mindfulness':            ['mindfulness practice', 'meditation calm', 'present moment'],
  'stress':                 ['stress relief', 'calm peaceful', 'relaxation wellness'],
  'anxiety':                ['calm peaceful nature', 'wellness mindfulness', 'soothing landscape'],
  'sleep':                  ['sleep restful', 'bedroom peaceful', 'night calm'],
  'fitness':                ['fitness workout', 'exercise healthy', 'gym training'],
  'nutrition':              ['healthy food', 'nutrition meal', 'fresh vegetables fruit'],

  // Business / Marketing
  'marketing':              ['marketing strategy', 'brand creative', 'digital marketing'],
  'content marketing':      ['content creation', 'blogging creative', 'digital content'],
  'social media':           ['social media marketing', 'digital connection', 'online community'],
  'branding':               ['brand identity', 'creative design', 'logo brand'],
  'advertising':            ['advertising campaign', 'creative ad', 'marketing billboard'],
  'sales':                  ['sales business', 'handshake deal', 'business growth'],
  'startup':                ['startup office', 'entrepreneur founder', 'business idea'],
  'entrepreneurship':       ['entrepreneur success', 'business founder', 'startup hustle'],
  'innovation':             ['innovation technology', 'creative idea', 'future tech'],
  'strategy':               ['business strategy', 'planning board', 'chess strategy'],

  // Productivity / Work
  'productivity':           ['productivity workspace', 'focused work', 'efficient planning'],
  'focus':                  ['focus concentration', 'desk workspace', 'deep work'],
  'remote work':            ['remote work home office', 'laptop work', 'home workspace'],
  'team':                   ['team collaboration', 'group work', 'office teamwork'],
  'leadership':             ['leadership business', 'team leader', 'executive meeting'],
  'meeting':                ['business meeting', 'team discussion', 'conference room'],
  'planning':               ['planning strategy', 'calendar schedule', 'project planning'],
  'time management':        ['time clock schedule', 'calendar planning', 'deadline work'],
  'workflow':               ['workflow process', 'office productivity', 'business flow'],

  // Technology
  'technology':             ['technology innovation', 'digital tech', 'computer modern'],
  'ai':                     ['artificial intelligence', 'machine learning tech', 'robot future'],
  'data':                   ['data analytics', 'chart graph', 'statistics business'],
  'software':               ['software coding', 'developer programming', 'code screen'],
  'cybersecurity':          ['cybersecurity digital', 'security lock', 'data protection'],
  'cloud':                  ['cloud computing', 'data center', 'digital network'],
  'mobile':                 ['mobile smartphone', 'app phone', 'digital device'],

  // Finance / Growth
  'finance':                ['finance money', 'investment growth', 'business financial'],
  'investment':             ['investment growth', 'stock market', 'financial planning'],
  'growth':                 ['growth success', 'chart upward', 'business expansion'],
  'revenue':                ['revenue profit', 'business success', 'financial growth'],
  'savings':                ['savings piggy bank', 'financial planning', 'money saving'],

  // Education / Learning
  'education':              ['education learning', 'student study', 'school books'],
  'learning':               ['learning growth', 'books study', 'education knowledge'],
  'training':               ['training professional', 'workshop learning', 'skill development'],
  'coaching':               ['coaching mentor', 'leadership training', 'business coaching'],
  'knowledge':              ['knowledge books', 'wisdom learning', 'education library'],

  // Creative
  'creativity':             ['creativity art', 'creative design', 'inspiration idea'],
  'design':                 ['design creative', 'graphic art', 'visual creative'],
  'photography':            ['photography camera', 'creative photo', 'visual art'],
  'writing':                ['writing author', 'book manuscript', 'journalism'],

  // Community / Social
  'community':              ['community people', 'group together', 'social connection'],
  'networking':             ['networking business', 'handshake connection', 'professional meeting'],
  'collaboration':          ['collaboration teamwork', 'people working together', 'partnership'],
  'diversity':              ['diversity inclusion', 'multicultural team', 'people together'],

  // Nature / Abstract
  'success':                ['success achievement', 'winner trophy', 'goal accomplished'],
  'motivation':             ['motivation inspiration', 'success goal', 'determination'],
  'change':                 ['change transformation', 'new beginning', 'evolution'],
  'future':                 ['future technology', 'innovation forward', 'modern progress'],
};

export function resolveSemanticQuery(rawQuery: string): string {
  const normalized = rawQuery.toLowerCase().trim();
  if (SEMANTIC_MAP[normalized]) return SEMANTIC_MAP[normalized][0];
  let best: string | null = null;
  let bestLen = 0;
  for (const key of Object.keys(SEMANTIC_MAP)) {
    if (normalized.includes(key) && key.length > bestLen) {
      best = SEMANTIC_MAP[key][0];
      bestLen = key.length;
    }
  }
  return best ?? rawQuery;
}

function semanticVariants(rawQuery: string): string[] {
  const normalized = rawQuery.toLowerCase().trim();
  for (const key of Object.keys(SEMANTIC_MAP)) {
    if (normalized === key || normalized.includes(key)) return SEMANTIC_MAP[key];
  }
  return [rawQuery];
}

// ─── Quality filtering ────────────────────────────────────────────────────────

function passesQualityFilter(img: NormalizedImage, minW: number, minH: number, minAspect?: number): boolean {
  // Dimension check
  if (img.width > 0 && img.width < minW) { _counters.qualityDropped++; return false; }
  if (img.height > 0 && img.height < minH) { _counters.qualityDropped++; return false; }

  // Aspect ratio check (landscape: width/height ≥ minAspect)
  if (minAspect && img.width > 0 && img.height > 0) {
    const ratio = img.width / img.height;
    if (ratio < minAspect) { _counters.qualityDropped++; return false; }
  }

  // Must have a usable thumb URL
  if (!img.thumb) { _counters.qualityDropped++; return false; }

  return true;
}

// ─── Attribution helpers ──────────────────────────────────────────────────────

function buildAttribution(source: NormalizedImage['source'], author: string): string {
  switch (source) {
    case 'unsplash': return `Photo by ${author} on Unsplash (unsplash.com)`;
    case 'pexels':   return `Photo by ${author} on Pexels (pexels.com)`;
    case 'pixabay':  return `Image by ${author} on Pixabay (pixabay.com)`;
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

function imageLog(level: LogLevel, provider: string, query: string, detail?: string): void {
  if (process.env.NODE_ENV === 'test') return;
  const ts  = new Date().toISOString();
  const msg = `[IMAGE_SERVICE] ${ts} ${level.toUpperCase()} provider=${provider}${query ? ` query="${query}"` : ''}${detail ? ` — ${detail}` : ''}`;
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);
}

// ─── Provider adapters ────────────────────────────────────────────────────────

async function fetchUnsplash(
  query: string,
  perPage: number,
  page: number,
  orientation: string
): Promise<NormalizedImage[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  if (isRateLimited('unsplash')) {
    _counters.rateLimitSkips++;
    imageLog('warn', 'unsplash', query, 'rate-limited — skipping');
    return [];
  }

  const url =
    `https://api.unsplash.com/search/photos` +
    `?query=${encodeURIComponent(query)}` +
    `&per_page=${perPage}&page=${page}` +
    `&orientation=${orientation}&content_filter=high`;

  recordRequest('unsplash');
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('X-Ratelimit-Reset') ?? res.headers.get('Retry-After') ?? 3600);
    applyRetryAfter('unsplash', retryAfter);
    return [];
  }
  if (!res.ok) {
    imageLog('warn', 'unsplash', query, `HTTP ${res.status}`);
    return [];
  }

  const data = await res.json() as { results?: any[] };
  return (data.results ?? []).map((p: any): NormalizedImage => {
    const author = p.user?.name ?? 'Unknown';
    return {
      id: `unsplash-${p.id}`,
      thumb: p.urls?.small ?? '',
      full: p.urls?.regular ?? p.urls?.full ?? '',
      alt: p.alt_description ?? p.description ?? query,
      width: Number(p.width ?? 0),
      height: Number(p.height ?? 0),
      author,
      author_url: p.user?.links?.html,
      source_url: p.links?.html,
      source: 'unsplash',
      attribution: buildAttribution('unsplash', author),
      color: p.color ?? undefined,
    };
  });
}

async function fetchPexels(
  query: string,
  perPage: number,
  page: number,
  orientation: string
): Promise<NormalizedImage[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  if (isRateLimited('pexels')) {
    _counters.rateLimitSkips++;
    imageLog('warn', 'pexels', query, 'rate-limited — skipping');
    return [];
  }

  const pexelsOrientation = orientation === 'squarish' ? 'square' : orientation;
  const url =
    `https://api.pexels.com/v1/search` +
    `?query=${encodeURIComponent(query)}` +
    `&per_page=${perPage}&page=${page}` +
    `&orientation=${pexelsOrientation}`;

  recordRequest('pexels');
  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 3600);
    applyRetryAfter('pexels', retryAfter);
    return [];
  }
  if (!res.ok) {
    imageLog('warn', 'pexels', query, `HTTP ${res.status}`);
    return [];
  }

  const data = await res.json() as { photos?: any[] };
  return (data.photos ?? []).map((p: any): NormalizedImage => {
    const author = p.photographer ?? 'Unknown';
    return {
      id: `pexels-${p.id}`,
      thumb: p.src?.medium ?? p.src?.small ?? '',
      full: p.src?.large2x ?? p.src?.large ?? '',
      alt: p.alt ?? query,
      width: Number(p.width ?? 0),
      height: Number(p.height ?? 0),
      author,
      author_url: p.photographer_url,
      source_url: p.url,
      source: 'pexels',
      attribution: buildAttribution('pexels', author),
    };
  });
}

async function fetchPixabay(
  query: string,
  perPage: number,
  page: number,
  orientation: string
): Promise<NormalizedImage[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  if (isRateLimited('pixabay')) {
    _counters.rateLimitSkips++;
    imageLog('warn', 'pixabay', query, 'rate-limited — skipping');
    return [];
  }

  const pixabayOrientation = orientation === 'squarish' ? 'all' : orientation === 'landscape' ? 'horizontal' : 'vertical';
  const url =
    `https://pixabay.com/api/` +
    `?key=${key}` +
    `&q=${encodeURIComponent(query)}` +
    `&per_page=${perPage}&page=${page}` +
    `&image_type=photo&orientation=${pixabayOrientation}&safesearch=true`;

  recordRequest('pixabay');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 60);
    applyRetryAfter('pixabay', retryAfter);
    return [];
  }
  if (!res.ok) {
    imageLog('warn', 'pixabay', query, `HTTP ${res.status}`);
    return [];
  }

  const data = await res.json() as { hits?: any[] };
  return (data.hits ?? []).map((p: any): NormalizedImage => {
    const author = p.user ?? 'Unknown';
    return {
      id: `pixabay-${p.id}`,
      thumb: p.previewURL ?? p.webformatURL ?? '',
      full: p.largeImageURL ?? p.webformatURL ?? '',
      alt: String(p.tags ?? query).split(',')[0].trim(),
      width: Number(p.imageWidth ?? p.webformatWidth ?? 0),
      height: Number(p.imageHeight ?? p.webformatHeight ?? 0),
      author,
      source_url: p.pageURL,
      source: 'pixabay',
      attribution: buildAttribution('pixabay', author),
    };
  });
}

// ─── Core search function ─────────────────────────────────────────────────────

/**
 * Search for images with full fallback + caching + semantic resolution + rate limiting.
 *
 * Flow:
 *  1. Check in-memory cache
 *  2. Resolve semantic query → try all providers in parallel
 *  3. If zero results, try next semantic variant
 *  4. If all variants exhausted, fall back to raw query
 *  5. Apply quality filter (dimensions + aspect ratio)
 *  6. Interleave results from different sources for variety
 *  7. Cache result and return
 */
export async function searchImages(
  rawQuery: string,
  options: ImageSearchOptions = {}
): Promise<ImageSearchResult> {
  const perPage    = Math.min(options.perPage ?? 12, 24);
  const page       = options.page ?? 1;
  const orientation = options.orientation ?? 'landscape';
  const minWidth   = options.minWidth ?? 600;
  const minHeight  = options.minHeight ?? 400;
  const minAspect  = options.minAspectRatio ?? (orientation === 'landscape' ? 1.2 : undefined);

  const semanticQuery = resolveSemanticQuery(rawQuery);
  const key = cacheKey(semanticQuery, { perPage, page, orientation });

  // L1: in-memory cache hit
  const cached = cacheGet(key);
  if (cached) {
    _counters.hits++;
    imageLog('info', 'cache', semanticQuery, `hit (${cached.images.length} results)`);
    return cached;
  }
  _counters.misses++;

  const queryVariants = semanticVariants(rawQuery);
  let resolvedQuery = semanticQuery;
  let images: NormalizedImage[] = [];
  let usedProviders: string[] = [];

  // Try each semantic query variant until we get results
  for (const variant of queryVariants) {
    const [unsplash, pexels, pixabay] = await Promise.allSettled([
      fetchUnsplash(variant, perPage, page, orientation),
      fetchPexels(variant, perPage, page, orientation),
      fetchPixabay(variant, perPage, page, orientation),
    ]);

    const buckets: { source: string; imgs: NormalizedImage[] }[] = [];
    if (unsplash.status === 'fulfilled' && unsplash.value.length > 0)
      buckets.push({ source: 'unsplash', imgs: unsplash.value });
    if (pexels.status === 'fulfilled' && pexels.value.length > 0)
      buckets.push({ source: 'pexels', imgs: pexels.value });
    if (pixabay.status === 'fulfilled' && pixabay.value.length > 0)
      buckets.push({ source: 'pixabay', imgs: pixabay.value });

    if (buckets.length === 0) {
      imageLog('warn', 'all', variant, 'zero results — trying next semantic variant');
      continue;
    }

    usedProviders = buckets.map((b) => b.source);
    resolvedQuery = variant;

    // Interleave results for visual variety
    const maxLen = Math.max(...buckets.map((b) => b.imgs.length));
    for (let i = 0; i < maxLen; i++) {
      for (const { imgs } of buckets) {
        if (imgs[i]) images.push(imgs[i]);
      }
    }
    break;
  }

  // Raw query fallback if all semantic variants failed
  if (images.length === 0 && rawQuery !== resolvedQuery) {
    imageLog('warn', 'all', rawQuery, 'semantic variants exhausted — trying raw query');
    const [u, pe, pi] = await Promise.allSettled([
      fetchUnsplash(rawQuery, perPage, page, orientation),
      fetchPexels(rawQuery, perPage, page, orientation),
      fetchPixabay(rawQuery, perPage, page, orientation),
    ]);
    images = [
      ...(u.status === 'fulfilled' ? u.value : []),
      ...(pe.status === 'fulfilled' ? pe.value : []),
      ...(pi.status === 'fulfilled' ? pi.value : []),
    ];
    resolvedQuery = rawQuery;
    usedProviders = [...new Set(images.map((r) => r.source))];
  }

  // Quality filter — fall back to unfiltered if filter removes everything
  const filtered = images.filter((img) => passesQualityFilter(img, minWidth, minHeight, minAspect));
  const final = (filtered.length > 0 ? filtered : images).slice(0, perPage);

  imageLog('info', usedProviders.join('+') || 'none', resolvedQuery, `${final.length} images returned (quality-filtered from ${images.length})`);

  const result: ImageSearchResult = {
    images: final,
    query: resolvedQuery,
    originalQuery: rawQuery,
    source: usedProviders.join(', ') || 'none',
    fromCache: false,
  };

  if (final.length > 0) cacheSet(key, result);
  return result;
}

// ─── Health / monitoring ──────────────────────────────────────────────────────

/** Return full service metrics for the health endpoint. */
export function getImageServiceMetrics(): ImageServiceMetrics {
  const now = Date.now();
  const rateLimits: ImageServiceMetrics['rateLimits'] = {};
  for (const [provider, state] of Object.entries(_rateLimitState)) {
    const cfg = RATE_LIMIT_CONFIG[provider];
    const active = state.timestamps.filter((t) => now - t < cfg.windowMs);
    rateLimits[provider] = {
      requestsInWindow: active.length,
      limit: cfg.limit,
      windowMs: cfg.windowMs,
      ...(state.blockedUntil && state.blockedUntil > now ? { blockedUntil: state.blockedUntil } : {}),
    };
  }
  return {
    cache: { entries: _cache.size, maxEntries: MAX_CACHE_ENTRIES, ttlMs: CACHE_TTL_MS },
    rateLimits,
    counters: { ..._counters },
  };
}

/** @deprecated Use getImageServiceMetrics() */
export function getImageCacheStats() {
  return getImageServiceMetrics().cache;
}
