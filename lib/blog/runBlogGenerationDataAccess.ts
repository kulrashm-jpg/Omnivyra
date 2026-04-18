/**
 * Data-access helpers for runBlogGeneration.
 * Separated here because they depend on supabase (not pure functions).
 */

import { supabase } from '../../backend/db/supabaseClient';
import { extractBlogContext } from './blockExtractor';
import type { AngleType, SeriesSummary } from './blogGenerationEngine';
import type { ContentBlock, InternalLinkBlock } from './blockTypes';
import { uuid } from './runBlogGenerationPureHelpers';
export type { FetchAngleDataFn, FetchSeriesDataFn } from './blogRunnerTypes';

// ── Default supabase implementations ─────────────────────────────────────────

/**
 * Default implementation — uses supabase directly.
 * Replace with an injectable in tests or edge cases.
 */
export async function defaultFetchAngleData(
  companyId: string,
  blogTable:  'blogs' | 'public_blogs',
): Promise<AngleType | null> {
  const query = supabase
    .from(blogTable)
    .select('angle_type')
    .eq('status', 'published')
    .not('angle_type', 'is', null);

  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const b of data as Array<{ angle_type: string }>) {
    if (b.angle_type) counts[b.angle_type] = (counts[b.angle_type] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top    = sorted[0]?.[0];
  return (top && ['analytical', 'contrarian', 'strategic'].includes(top))
    ? (top as AngleType)
    : null;
}

/**
 * Default implementation — uses supabase directly.
 * Replace with an injectable in tests or edge cases.
 */
export async function defaultFetchSeriesData(
  ids:       string[],
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
): Promise<SeriesSummary[]> {
  const query = supabase
    .from(blogTable)
    .select('title, content, content_blocks')
    .in('id', ids);

  // Company blogs: scope to company to prevent cross-company data access
  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return [];

  return (data as Array<{ title: string; content: string; content_blocks: unknown }>).map(b => {
    const extracted = extractBlogContext(b.content_blocks);
    return {
      title:      b.title,
      headings:   extracted.h2_headings,
      key_points: extracted.key_insights,
      summary:    extracted.summary,
    };
  });
}

// ── Internal link injection ───────────────────────────────────────────────────

export async function injectInternalLinks(
  blocks:    ContentBlock[],
  topic:     string,
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
  excludeTitles: string[] = [],
): Promise<ContentBlock[]> {
  try {
    // Extract meaningful keywords from the topic (3+ chars, not stop words)
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
      'was', 'one', 'our', 'out', 'has', 'have', 'from', 'with', 'they',
      'been', 'this', 'that', 'will', 'each', 'make', 'like', 'into',
      'them', 'than', 'its', 'over', 'such', 'what', 'how', 'why', 'most',
      'about', 'which', 'when', 'your', 'does', 'more',
    ]);
    const keywords = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    if (keywords.length === 0) return blocks;

    // Fetch published blogs for this company
    const query = supabase
      .from(blogTable)
      .select('slug, title, excerpt')
      .eq('status', 'published')
      .not('slug', 'is', null);

    if (blogTable === 'blogs') {
      query.eq('company_id', companyId);
    }

    const { data } = await query.limit(50);
    if (!data || data.length === 0) return blocks;

    // Score each blog by keyword overlap with the topic
    const excludeSet = new Set(excludeTitles.map(t => t.toLowerCase()));
    const publishedBlogs = (data as Array<{ slug: string; title: string; excerpt: string | null }>)
      .filter(b => b.slug && b.title && !excludeSet.has(b.title.toLowerCase()))
      .map((b) => ({ ...b, titleLow: b.title.toLowerCase() }));

    const scored = publishedBlogs
      .map(b => {
        const score = keywords.filter(kw => b.titleLow.includes(kw)).length;
        return { ...b, score };
      })
      .filter(b => b.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2); // take top 2

    const fallbackRelated = publishedBlogs
      .filter((b) => !scored.some((s) => s.slug === b.slug))
      .slice(0, Math.max(0, 2 - scored.length))
      .map(({ titleLow: _titleLow, ...rest }) => ({ ...rest, score: 0 }));

    const chosenLinks = [...scored, ...fallbackRelated].slice(0, 2);

    if (chosenLinks.length === 0) return blocks;

    // Build InternalLinkBlock entries
    const linkBlocks: InternalLinkBlock[] = chosenLinks.map(b => ({
      id:      uuid(),
      type:    'internal_link' as const,
      slug:    b.slug,
      title:   b.title,
      excerpt: b.excerpt || undefined,
    }));

    // Find H2 heading positions to insert after
    const h2Indices: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      if (blk.type === 'heading' && blk.level === 2) {
        // Skip Summary/References headings
        const text = blk.text.toLowerCase().replace(/[^a-z]/g, '');
        if (text !== 'summary' && text !== 'conclusion' && text !== 'references' && text !== 'sources') {
          h2Indices.push(i);
        }
      }
    }

    // Determine insertion indices: after 2nd H2 section and after 4th (or last substantive) H2 section
    // "After a section" means before the next H2 heading (or at the end of content sections)
    const result = [...blocks];
    let inserted = 0;

    // For each link, find the insertion point after the target H2 section
    const targetH2Positions = linkBlocks.length >= 2
      ? [Math.min(1, h2Indices.length - 1), Math.min(3, h2Indices.length - 1)]
      : [Math.min(1, h2Indices.length - 1)];

    for (let li = linkBlocks.length - 1; li >= 0; li--) {
      const h2Pos = targetH2Positions[li] ?? 0;
      if (h2Pos < 0 || h2Pos >= h2Indices.length) continue;

      const h2BlockIdx = h2Indices[h2Pos];
      // Find the next H2 after this one (or summary/references), insert just before it
      let insertAt = result.length; // default: end
      for (let i = h2BlockIdx + 1; i < result.length; i++) {
        const blk = result[i];
        if (blk.type === 'heading' && blk.level === 2) {
          insertAt = i;
          break;
        }
        if (blk.type === 'summary' || blk.type === 'references') {
          insertAt = i;
          break;
        }
      }

      result.splice(insertAt + inserted, 0, linkBlocks[li]);
      inserted++;
    }

    return result;
  } catch {
    // Internal link injection is best-effort — never block generation
    return blocks;
  }
}
