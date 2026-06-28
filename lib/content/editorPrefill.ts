import { htmlToBlocks } from '../blog/htmlToBlocks';
import type { BlogFormState } from '../../components/blog/BlogEditorForm';

export type GeneratedOutput = {
  content_blocks?: unknown[];
  content_html?: string;
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function estimateBlockWords(blocks: unknown[]): number {
  return blocks.reduce<number>((total, block) => {
    if (!block || typeof block !== 'object') return total;

    const record = block as Record<string, unknown>;
    const fragments: string[] = [];

    for (const key of ['text', 'body', 'html', 'caption', 'title', 'description']) {
      if (typeof record[key] === 'string') fragments.push(record[key] as string);
    }

    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (item && typeof item === 'object') {
          const itemRecord = item as Record<string, unknown>;
          if (typeof itemRecord.text === 'string') fragments.push(itemRecord.text);
          if (typeof itemRecord.title === 'string') fragments.push(itemRecord.title);
        }
      }
    }

    return total + countWords(stripHtml(fragments.join(' ')));
  }, 0);
}

export function resolveGeneratedPrefillBlocks(
  output: GeneratedOutput | null | undefined,
  fallbackBlocks: BlogFormState['content_blocks'],
): BlogFormState['content_blocks'] {
  const generatedBlocks = Array.isArray(output?.content_blocks)
    ? (output.content_blocks as BlogFormState['content_blocks'])
    : [];
  const generatedHtml = typeof output?.content_html === 'string' ? output.content_html : '';

  const blockWords = estimateBlockWords(generatedBlocks);
  const htmlWords = countWords(stripHtml(generatedHtml));

  if (generatedHtml && (generatedBlocks.length === 0 || htmlWords >= Math.max(160, blockWords + 120))) {
    return htmlToBlocks(generatedHtml);
  }

  if (generatedBlocks.length > 0) {
    return generatedBlocks;
  }

  return fallbackBlocks;
}
