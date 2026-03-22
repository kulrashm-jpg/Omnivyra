/**
 * HTML → ContentBlock[] converter
 *
 * Parses the structured HTML produced by the blog generation engine and
 * converts it into the canonical ContentBlock[] format used by the entire
 * Omnivyra blog system (extraction, repurposing, intelligence, quality check).
 *
 * Designed for the specific HTML structure the AI generates — uses a
 * character-level tag parser to correctly handle nested elements.
 *
 * Works in both Node.js (API routes) and modern browsers.
 */

import type {
  ContentBlock,
  KeyInsightsBlock,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  ListItem,
  QuoteBlock,
  SummaryBlock,
  ReferencesBlock,
  ReferenceItem,
} from './blockTypes';

// ── UUID ──────────────────────────────────────────────────────────────────────

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (old environments)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Anchor slugify (mirrors blockUtils.ts) ────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Strip HTML tags ────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Token interface ───────────────────────────────────────────────────────────

interface HtmlToken {
  tag:       string;
  outerHtml: string;
  innerHtml: string;
  attrs:     string; // raw attribute string from opening tag
}

// ── Character-level block extractor ──────────────────────────────────────────
/**
 * Extracts top-level block elements from HTML.
 * Handles arbitrary nesting within each block correctly by tracking depth.
 */
function extractTopLevelBlocks(html: string): HtmlToken[] {
  const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'div', 'section']);
  const tokens: HtmlToken[] = [];

  let i = 0;
  const len = html.length;

  while (i < len) {
    // Skip whitespace / text nodes between blocks
    if (html[i] !== '<') { i++; continue; }

    // Try to match an opening tag
    const openMatch = html.slice(i).match(/^<([a-z][a-z0-9]*)([^>]*)>/i);
    if (!openMatch) { i++; continue; }

    const tag   = openMatch[1].toLowerCase();
    const attrs = openMatch[2];

    if (!BLOCK_TAGS.has(tag)) { i++; continue; }

    // Self-closing? (e.g. <br />) — skip
    if (attrs.trimEnd().endsWith('/')) { i += openMatch[0].length; continue; }

    // Track nesting depth for this tag to find matching closing tag
    let depth   = 1;
    let j       = i + openMatch[0].length;
    const openRe  = new RegExp(`^<${tag}(?:[^a-z0-9][^>]*)?>`, 'i');
    const closeRe = new RegExp(`^</${tag}>`, 'i');

    while (j < len && depth > 0) {
      if (html[j] !== '<') { j++; continue; }
      const rest = html.slice(j);
      const closeM = rest.match(closeRe);
      if (closeM) { depth--; if (depth === 0) { j += closeM[0].length; break; } else { j += closeM[0].length; continue; } }
      const openM = rest.match(openRe);
      if (openM) { depth++; j += openM[0].length; continue; }
      j++;
    }

    const outerHtml = html.slice(i, j);
    // innerHtml = outerHtml without opening and closing tags
    const innerStart = i + openMatch[0].length;
    const innerEnd   = j - `</${tag}>`.length;
    const innerHtml  = html.slice(innerStart, innerEnd);

    tokens.push({ tag, outerHtml, innerHtml, attrs });
    i = j;
  }

  return tokens;
}

// ── List item extractor ───────────────────────────────────────────────────────
/**
 * Extracts <li> elements from list HTML using a depth-tracking character-level
 * parser. This correctly handles nested lists inside <li> elements, unlike a
 * non-greedy regex which stops at the first </li> it encounters.
 */
function extractLiContents(html: string): string[] {
  const contents: string[] = [];
  const len = html.length;
  let i = 0;

  while (i < len) {
    if (html[i] !== '<') { i++; continue; }
    const rest = html.slice(i);
    const openM = rest.match(/^<li(?:[^a-z0-9][^>]*)?>(?!.*\/>)/i);
    if (!openM) { i++; continue; }

    const contentStart = i + openM[0].length;
    let depth = 1;
    let j     = contentStart;

    while (j < len && depth > 0) {
      if (html[j] !== '<') { j++; continue; }
      const r = html.slice(j);
      if (/^<\/li>/i.test(r))       { depth--; if (depth === 0) break; j += 5; continue; }
      if (/^<li(?:[^a-z0-9]|>)/i.test(r)) { depth++; }
      j++;
    }

    contents.push(html.slice(contentStart, j));
    i = j + 5; // skip </li>
  }

  return contents;
}

function extractListItems(html: string): ListItem[] {
  const items: ListItem[] = [];

  for (const content of extractLiContents(html)) {
    // Find nested list using depth-aware extraction (find first <ul>/<ol> at top level of content)
    const nestedRe = /<(ul|ol)(?:[^a-z0-9][^>]*)?>/i;
    const nestedOpen = content.match(nestedRe);
    let text: string;
    let children: ListItem[] | undefined;

    if (nestedOpen) {
      // Find this nested list using the top-level block extractor logic
      const nestedTokens = extractTopLevelBlocks(content);
      const nestedToken  = nestedTokens.find(t => t.tag === 'ul' || t.tag === 'ol');
      if (nestedToken) {
        children = extractListItems(nestedToken.innerHtml);
        text = stripTags(content.replace(nestedToken.outerHtml, '')).trim();
      } else {
        text = stripTags(content).trim();
      }
    } else {
      text = stripTags(content).trim();
    }

    if (text || children?.length) {
      items.push({ id: uuid(), text: text || '', ...(children?.length ? { children } : {}) });
    }
  }

  return items;
}

// ── Reference item extractor ──────────────────────────────────────────────────

function extractReferenceItems(html: string): ReferenceItem[] {
  const items: ReferenceItem[] = [];

  for (const inner of extractLiContents(html)) {
    const aMatch = inner.match(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/i);
    if (aMatch) {
      items.push({ id: uuid(), url: aMatch[1], title: stripTags(aMatch[2]).trim() || aMatch[1] });
    } else {
      const text = stripTags(inner).trim();
      if (text) items.push({ id: uuid(), url: '#', title: text });
    }
  }
  return items;
}

// ── Main converter ────────────────────────────────────────────────────────────

export function htmlToBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (!html?.trim()) return blocks;

  // ── 1. Extract key-insights div first (before tokenising) ────────────────
  const kiMatch = html.match(/<div[^>]*class=["'][^"']*key-insights[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  let remaining = html;
  if (kiMatch) {
    const items = extractListItems(kiMatch[1]).map(li => li.text).filter(Boolean);
    if (items.length > 0) {
      const block: KeyInsightsBlock = { id: uuid(), type: 'key_insights', title: 'Key Insights', items };
      blocks.push(block);
    }
    remaining = html.replace(kiMatch[0], '');
  }

  // ── 2. Tokenise remaining HTML ────────────────────────────────────────────
  const tokens = extractTopLevelBlocks(remaining);

  // ── 3. State machine ──────────────────────────────────────────────────────
  let inSummary    = false;
  let inReferences = false;
  let summaryParts: string[] = [];

  const flushSummary = () => {
    if (inSummary && summaryParts.length > 0) {
      const block: SummaryBlock = { id: uuid(), type: 'summary', body: summaryParts.join(' ').trim() };
      blocks.push(block);
      summaryParts = [];
    }
    inSummary = false;
  };

  for (const token of tokens) {
    const { tag, innerHtml } = token;

    // ── Headings ────────────────────────────────────────────────────────────
    if (tag === 'h2' || tag === 'h3') {
      const text = stripTags(innerHtml).trim();
      if (!text) continue;

      const textLow = text.toLowerCase().replace(/[^a-z]/g, '');
      if (textLow === 'summary' || textLow === 'conclusion') {
        flushSummary();
        inSummary    = true;
        inReferences = false;
        continue;
      }
      if (textLow === 'references' || textLow === 'sources' || textLow === 'furtherreading') {
        flushSummary();
        inSummary    = false;
        inReferences = true;
        continue;
      }

      // Normal section heading
      flushSummary();
      inReferences = false;
      const level  = tag === 'h3' ? 3 : 2;
      const anchor = slugify(text);
      const block: HeadingBlock = { id: uuid(), type: 'heading', level: level as 2 | 3, text, anchor };
      blocks.push(block);
      continue;
    }

    // ── Paragraphs ───────────────────────────────────────────────────────────
    if (tag === 'p') {
      const text = stripTags(innerHtml).trim();
      if (!text) continue;

      if (inSummary) {
        summaryParts.push(text);
        continue;
      }
      if (inReferences) continue; // references come from <ol>

      // Keep inline formatting (bold, italic, links) in the paragraph html
      const block: ParagraphBlock = { id: uuid(), type: 'paragraph', html: `<p>${innerHtml}</p>` };
      blocks.push(block);
      continue;
    }

    // ── Unordered list ───────────────────────────────────────────────────────
    if (tag === 'ul' && !inReferences) {
      const items = extractListItems(innerHtml);
      if (items.length > 0) {
        const block: ListBlock = { id: uuid(), type: 'list', listType: 'bullet', items };
        blocks.push(block);
      }
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────────────
    if (tag === 'ol') {
      if (inReferences) {
        const refs = extractReferenceItems(innerHtml);
        if (refs.length > 0) {
          const block: ReferencesBlock = { id: uuid(), type: 'references', items: refs };
          blocks.push(block);
        }
      } else {
        const items = extractListItems(innerHtml);
        if (items.length > 0) {
          const block: ListBlock = { id: uuid(), type: 'list', listType: 'numbered', items };
          blocks.push(block);
        }
      }
      continue;
    }

    // ── Blockquote ───────────────────────────────────────────────────────────
    if (tag === 'blockquote' && !inSummary && !inReferences) {
      const text = stripTags(innerHtml).trim();
      if (text) {
        const block: QuoteBlock = { id: uuid(), type: 'quote', text };
        blocks.push(block);
      }
      continue;
    }
  }

  // Flush any open summary
  flushSummary();

  return blocks;
}
