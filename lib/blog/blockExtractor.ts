/**
 * Shared content_blocks extraction utility.
 *
 * Works identically for public_blogs and company blogs (blogs table).
 * Call with any JSONB content_blocks array — nulls and non-arrays are safe.
 */

export interface BlogContextExtract {
  key_insights: string[];
  summary:      string;
  h2_headings:  string[];
}

export function extractBlogContext(blocks: unknown): BlogContextExtract {
  const key_insights: string[] = [];
  let   summary      = '';
  const h2_headings: string[] = [];

  if (!Array.isArray(blocks)) {
    return { key_insights, summary, h2_headings };
  }

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;

    if (b['type'] === 'key_insights' && Array.isArray(b['items'])) {
      for (const item of b['items']) {
        if (typeof item === 'string' && item.trim()) {
          key_insights.push(item);
        }
      }
    }

    if (b['type'] === 'summary' && typeof b['body'] === 'string' && b['body']) {
      summary = b['body'];
    }

    if (b['type'] === 'heading' && b['level'] === 2 && typeof b['text'] === 'string' && b['text']) {
      h2_headings.push(b['text']);
    }
  }

  return { key_insights, summary, h2_headings };
}
