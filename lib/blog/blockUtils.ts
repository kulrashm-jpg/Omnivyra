/**
 * Utility functions for the blog block system.
 * Pure functions — no side effects, no imports from React.
 */

import type { ContentBlock, BlockType, ListItem } from './blockTypes';

// ── ID generation ─────────────────────────────────────────────────────────────

export function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // SSR fallback
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Anchor generation ─────────────────────────────────────────────────────────

export function generateAnchor(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

// ── Block factory ─────────────────────────────────────────────────────────────
// Creates a new block with sensible defaults for a given type.

export function createBlock(type: BlockType): ContentBlock {
  const id = newId();

  switch (type) {
    case 'paragraph':
      return { id, type: 'paragraph', html: '<p></p>' };

    case 'heading':
      return { id, type: 'heading', level: 2, text: '', anchor: '' };

    case 'key_insights':
      return { id, type: 'key_insights', title: 'Key Insights', items: [''] };

    case 'callout':
      return { id, type: 'callout', variant: 'insight', title: '', body: '' };

    case 'quote':
      return { id, type: 'quote', text: '', author: '', source: '' };

    case 'image':
      return { id, type: 'image', url: '', alt: '', caption: '' };

    case 'media':
      return { id, type: 'media', mediaType: 'youtube', url: '', title: '', description: '' };

    case 'divider':
      return { id, type: 'divider', variant: 'section_break' };

    case 'list':
      return { id, type: 'list', listType: 'bullet', items: [{ id: newId(), text: '' }] };

    case 'references':
      return { id, type: 'references', items: [{ id: newId(), title: '', url: '' }] };

    case 'internal_link':
      return { id, type: 'internal_link', slug: '', title: '', excerpt: '' };

    case 'summary':
      return { id, type: 'summary', body: '' };
  }
}

// ── Text extraction ───────────────────────────────────────────────────────────
// Strips HTML tags and extracts plain text from a block for word counting,
// read-time estimation, and TTS.

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractListText(items: ListItem[]): string {
  return items
    .map((item) => item.text + (item.children ? ' ' + extractListText(item.children) : ''))
    .join(' ');
}

export function extractTextFromBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':
      return stripHtml(block.html);
    case 'heading':
      return block.text;
    case 'key_insights':
      return block.items.join(' ');
    case 'callout':
      return [block.title ?? '', block.body].join(' ');
    case 'quote':
      return [block.text, block.author ?? ''].join(' ');
    case 'image':
      return [block.alt, block.caption ?? ''].join(' ');
    case 'media':
      return [block.title ?? '', block.description ?? ''].join(' ');
    case 'list':
      return extractListText(block.items);
    case 'references':
      return block.items.map((r) => r.title).join(' ');
    case 'internal_link':
      return [block.title ?? '', block.excerpt ?? ''].join(' ');
    case 'summary':
      return block.body;
    case 'divider':
      return '';
  }
}

export function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks.map(extractTextFromBlock).join(' ');
}

// ── Read-time estimation ──────────────────────────────────────────────────────
// Assumes 200 words per minute. Returns minutes, minimum 1.

export function estimateReadTimeFromBlocks(blocks: ContentBlock[]): number {
  const text = extractTextFromBlocks(blocks);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ── Block reordering helpers ──────────────────────────────────────────────────

export function moveBlockUp(blocks: ContentBlock[], index: number): ContentBlock[] {
  if (index <= 0) return blocks;
  const next = [...blocks];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

export function moveBlockDown(blocks: ContentBlock[], index: number): ContentBlock[] {
  if (index >= blocks.length - 1) return blocks;
  const next = [...blocks];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}

export function deleteBlock(blocks: ContentBlock[], index: number): ContentBlock[] {
  return blocks.filter((_, i) => i !== index);
}

export function duplicateBlock(blocks: ContentBlock[], index: number): ContentBlock[] {
  const block = blocks[index];
  const clone: ContentBlock = { ...block, id: newId() } as ContentBlock;
  const next = [...blocks];
  next.splice(index + 1, 0, clone);
  return next;
}

export function insertBlockAfter(
  blocks: ContentBlock[],
  index: number,
  type: BlockType,
): ContentBlock[] {
  const newBlock = createBlock(type);
  const next = [...blocks];
  next.splice(index + 1, 0, newBlock);
  return next;
}

// ── Heading anchor sync ───────────────────────────────────────────────────────
// Ensures all heading blocks have anchor IDs derived from their text.
// Call before saving to the API.

export function syncHeadingAnchors(blocks: ContentBlock[]): ContentBlock[] {
  const seenAnchors = new Set<string>();
  return blocks.map((block) => {
    if (block.type !== 'heading') return block;
    let anchor = generateAnchor(block.text);
    if (!anchor) anchor = block.id.slice(0, 8);
    // Deduplicate: append index suffix if anchor already used
    let candidate = anchor;
    let suffix = 2;
    while (seenAnchors.has(candidate)) {
      candidate = `${anchor}-${suffix}`;
      suffix++;
    }
    seenAnchors.add(candidate);
    return { ...block, anchor: candidate };
  });
}

// ── TOC extraction ────────────────────────────────────────────────────────────
// Returns an ordered list of headings for table-of-contents generation.

export interface TocEntry {
  level: 2 | 3;
  text: string;
  anchor: string;
}

export function extractToc(blocks: ContentBlock[]): TocEntry[] {
  return blocks
    .filter((b): b is import('./blockTypes').HeadingBlock => b.type === 'heading')
    .map((b) => ({ level: b.level, text: b.text, anchor: b.anchor }));
}
