/**
 * Converts a legacy blog post (content_markdown + media_blocks) into a
 * ContentBlock[] array.
 *
 * Called client-side in BlogEditorForm when a post has content_markdown but
 * no content_blocks. The admin reviews and saves to persist.
 * Pure function — no side effects.
 */

import type { ContentBlock, MediaType } from './blockTypes';
import type { MediaBlockItem } from '../../components/blog/BlogMediaBlock';
import { newId, generateAnchor } from './blockUtils';

// ── Markdown → blocks ─────────────────────────────────────────────────────────

function parseInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function isBlankOrWhitespace(line: string): boolean {
  return line.trim() === '';
}

export function migrateMarkdownToBlocks(
  markdown: string,
  mediaBlocks?: MediaBlockItem[] | null,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = (markdown || '').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (isBlankOrWhitespace(line)) {
      i++;
      continue;
    }

    // Horizontal rule → divider
    if (/^---+$/.test(line.trim())) {
      blocks.push({ id: newId(), type: 'divider', variant: 'section_break' });
      i++;
      continue;
    }

    // H2 heading
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      const text = h2Match[1].trim();
      blocks.push({
        id: newId(),
        type: 'heading',
        level: 2,
        text,
        anchor: generateAnchor(text),
      });
      i++;
      continue;
    }

    // H3 heading
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      const text = h3Match[1].trim();
      blocks.push({
        id: newId(),
        type: 'heading',
        level: 3,
        text,
        anchor: generateAnchor(text),
      });
      i++;
      continue;
    }

    // H1 heading → converted to H2 (H1 reserved for post title)
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      const text = h1Match[1].trim();
      blocks.push({
        id: newId(),
        type: 'heading',
        level: 2,
        text,
        anchor: generateAnchor(text),
      });
      i++;
      continue;
    }

    // Blockquote → quote block
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({
        id: newId(),
        type: 'quote',
        text: quoteLines.join('\n').trim(),
        author: '',
        source: '',
      });
      continue;
    }

    // Bullet list
    if (/^[-*]\s/.test(line)) {
      const items: import('./blockTypes').ListItem[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push({ id: newId(), text: parseInlineMarkdown(lines[i].replace(/^[-*]\s/, '').trim()) });
        i++;
      }
      blocks.push({ id: newId(), type: 'list', listType: 'bullet', items });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: import('./blockTypes').ListItem[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push({ id: newId(), text: parseInlineMarkdown(lines[i].replace(/^\d+\.\s/, '').trim()) });
        i++;
      }
      blocks.push({ id: newId(), type: 'list', listType: 'numbered', items });
      continue;
    }

    // Paragraph — accumulate consecutive non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      !isBlankOrWhitespace(lines[i]) &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^>\s/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      const html = paraLines
        .map((l) => `<p>${parseInlineMarkdown(l)}</p>`)
        .join('');
      blocks.push({ id: newId(), type: 'paragraph', html });
    }
  }

  // Append legacy media blocks at the end
  if (Array.isArray(mediaBlocks)) {
    for (const m of mediaBlocks) {
      const validTypes: MediaType[] = ['youtube', 'spotify_track', 'spotify_podcast', 'external_link'];
      if (validTypes.includes(m.type as MediaType)) {
        blocks.push({
          id: newId(),
          type: 'media',
          mediaType: m.type as MediaType,
          url: m.url,
          title: '',
          description: '',
        });
      }
    }
  }

  // Always return at least one paragraph block so the editor is never empty
  if (blocks.length === 0) {
    blocks.push({ id: newId(), type: 'paragraph', html: '<p></p>' });
  }

  return blocks;
}
