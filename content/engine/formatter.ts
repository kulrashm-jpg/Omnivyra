import type { ContentBlock } from '../../lib/blog/blockTypes';
import type { ContentType } from '../core/contentTypes';
import { htmlToBlocks } from '../../lib/blog/htmlToBlocks';
import { sanitizeHTML } from './sanitizer';
import { z } from 'zod';

export type ContentMeta = {
  type: ContentType;
  generatedAt: string;
  template?: string;
};

export type GeneratedContent = {
  blocks: ContentBlock[];
  meta: ContentMeta;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatToBlocks(aiOutput: string): ContentBlock[] {
  return htmlToBlocks(sanitizeHTML(aiOutput));
}

export function formatGeneratedContent(input: {
  type: ContentType;
  aiOutput: unknown;
  template?: string;
}): GeneratedContent {
  const raw = z.string().min(1).parse(input.aiOutput);
  const blocks = formatToBlocks(raw);
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('Invalid generation output: missing blocks.');
  }

  return {
    blocks,
    meta: {
      type: input.type,
      generatedAt: new Date().toISOString(),
      template: input.template,
    },
  };
}

export function formatToHTML(blocks: ContentBlock[]): string {
  const html = blocks.map((block) => {
    switch (block.type) {
      case 'paragraph':
        return `<p>${block.html}</p>`;
      case 'heading':
        return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
      case 'quote':
        return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
      case 'summary':
        return `<section><h2>Summary</h2><p>${escapeHtml(block.body)}</p></section>`;
      case 'list': {
        const tag = block.listType === 'numbered' ? 'ol' : 'ul';
        const items = block.items.map((item) => `<li>${item.text}</li>`).join('');
        return `<${tag}>${items}</${tag}>`;
      }
      default:
        return '';
    }
  }).join('\n');

  return sanitizeHTML(html);
}
