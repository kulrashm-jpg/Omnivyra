/**
 * lib/media/imageService.ts — Client-side image search service
 *
 * Shared by:
 *   - Activity Workspace (ImagePicker component)
 *   - Blog editor (featured image picker)
 *
 * Delegates to /api/images/search → backend/services/imageService.ts
 *
 * ISOLATION RULES:
 *   ✔ Shared: query building, API call, result type
 *   ✗ Not shared: UI components, state, or flow (each consumer owns those)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface ImageResult {
  id:          string;
  thumb:       string;
  full:        string;
  alt:         string;
  author:      string;
  attribution: string;
  source:      'unsplash' | 'pexels' | 'pixabay';
}

export interface ImageSearchInput {
  /** Post/content title — highest-signal for query building */
  title?:   string;
  /** Short description or excerpt */
  excerpt?: string;
  /** Content tags */
  tags?:    string[];
  /** Manual query override — bypasses query building when provided */
  query?:   string;
  /** Number of results (1–24, default 12) */
  perPage?: number;
}

// ── Query building ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through',
  'but','or','and','not','no','so','yet','if','while','when','where','who',
  'which','how','this','that','these','those','i','me','my','we','our','you',
  'your','he','she','it','they','them','their','its','about','just','also',
  'than','then','up','out','more','very','what','there','all',
]);

/**
 * Build a compact, semantically useful search query from structured metadata.
 * Priority: title (base) + up to 2 meaningful keywords from excerpt + first tag.
 */
export function buildImageQuery(input: Omit<ImageSearchInput, 'query' | 'perPage'>): string {
  const base = (input.title ?? '').trim().slice(0, 50);
  if (!base) return (input.tags?.[0] ?? '').trim();

  // Extract meaningful keywords from excerpt
  const excerptWords = (input.excerpt ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const tagWords = (input.tags ?? [])
    .flatMap((t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/))
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const extra = [...new Set([...excerptWords, ...tagWords])].slice(0, 2);
  return extra.length > 0 ? `${base} ${extra.join(' ')}` : base;
}

// ── API call ───────────────────────────────────────────────────────────────

/**
 * Search for stock images. Pass either a `query` override or structured
 * `{ title, excerpt, tags }` — the service builds the query automatically.
 *
 * Returns an empty array on network errors (never throws).
 */
export async function searchImages(input: ImageSearchInput): Promise<ImageResult[]> {
  const q       = input.query?.trim() || buildImageQuery(input);
  const perPage = Math.min(24, Math.max(1, input.perPage ?? 12));

  if (!q) return [];

  try {
    const res = await fetch(
      `/api/images/search?q=${encodeURIComponent(q)}&per_page=${perPage}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as ImageResult[];
  } catch {
    return [];
  }
}
