import type { ContentBlock } from '../../lib/blog/blockTypes';
import { assertContentType, type ContentType } from './contentRegistry';
import { z } from 'zod';

export type ContentState = 'draft' | 'validated' | 'published' | 'archived';

export interface ValidatedContent {
  type: ContentType;
  blocks: ContentBlock[];
  state: ContentState;
}

const baseBlockSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  __sanitized: z.literal(true).optional(),
  __hash: z.string().min(1).optional(),
  hint: z.string().optional(),
  format: z.unknown().optional(),
});

const listItemSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().min(1),
  text: z.string(),
  children: z.array(listItemSchema).optional(),
}));

const contentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() => z.discriminatedUnion('type', [
  baseBlockSchema.extend({ type: z.literal('paragraph'), html: z.string() }),
  baseBlockSchema.extend({ type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text: z.string(), anchor: z.string() }),
  baseBlockSchema.extend({ type: z.literal('key_insights'), title: z.string().optional(), items: z.array(z.string()) }),
  baseBlockSchema.extend({ type: z.literal('callout'), variant: z.enum(['insight', 'note', 'warning']), title: z.string().optional(), body: z.string() }),
  baseBlockSchema.extend({ type: z.literal('quote'), text: z.string(), author: z.string().optional(), source: z.string().optional() }),
  baseBlockSchema.extend({ type: z.literal('image'), url: z.string(), alt: z.string(), caption: z.string().optional(), attribution: z.string().optional(), attributionUrl: z.string().optional() }),
  baseBlockSchema.extend({ type: z.literal('media'), mediaType: z.enum(['youtube', 'spotify_track', 'spotify_podcast', 'external_link']), url: z.string(), title: z.string().optional(), description: z.string().optional() }),
  baseBlockSchema.extend({ type: z.literal('divider'), variant: z.enum(['subtle', 'section_break']) }),
  baseBlockSchema.extend({ type: z.literal('list'), listType: z.enum(['bullet', 'numbered']), items: z.array(listItemSchema) }),
  baseBlockSchema.extend({ type: z.literal('references'), items: z.array(z.object({ id: z.string().min(1), title: z.string(), url: z.string() })) }),
  baseBlockSchema.extend({ type: z.literal('internal_link'), slug: z.string(), title: z.string().optional(), excerpt: z.string().optional() }),
  baseBlockSchema.extend({ type: z.literal('summary'), body: z.string() }),
  baseBlockSchema.extend({
    type: z.literal('columns'),
    columnCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    columns: z.array(z.object({
      id: z.string().min(1),
      blocks: z.array(contentBlockSchema),
    })),
  }),
]) as unknown as z.ZodType<ContentBlock>);

export const contentBlocksSchema = z.array(contentBlockSchema);

export function validateBlocks(blocks: unknown): ContentBlock[] {
  const parsed = contentBlocksSchema.safeParse(blocks);
  if (!parsed.success) {
    throw new Error(`Invalid content block schema: ${parsed.error.issues[0]?.message || 'unknown error'}`);
  }

  for (const block of parsed.data) {
    const serialized = JSON.stringify(block);
    if (/<script|javascript:|onerror\s*=|onclick\s*=|onload\s*=/i.test(serialized)) {
      throw new Error(`Unsafe content detected in block ${block.id}.`);
    }
  }

  return parsed.data;
}

export const validateBlockSchema = validateBlocks;

export function validateContent(input: {
  type: unknown;
  blocks: unknown;
  state?: unknown;
}): ValidatedContent {
  assertContentType(input.type);
  const state = input.state === 'published' || input.state === 'validated' || input.state === 'archived'
    ? input.state
    : 'draft';
  return {
    type: input.type,
    blocks: validateBlocks(input.blocks),
    state,
  };
}

export function validateContentOrThrow(content: unknown): ValidatedContent {
  if (!content || typeof content !== 'object') {
    throw new Error('Invalid content payload: expected object.');
  }
  const value = content as Record<string, unknown>;
  return validateContent({
    type: value.type ?? value.content_type ?? value.contentType,
    blocks: value.blocks ?? value.content_blocks ?? value.contentBlocks,
    state: value.state ?? value.status,
  });
}

const ALLOWED_TRANSITIONS: Record<ContentState, ContentState[]> = {
  draft: ['validated', 'archived'],
  validated: ['published', 'draft', 'archived'],
  published: ['archived'],
  archived: [],
};

export function assertValidContentTransition(from: ContentState, to: ContentState): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid publish state transition: ${from} -> ${to}`);
  }
}

export const assertValidStateTransition = assertValidContentTransition;

export function isContentState(value: unknown): value is ContentState {
  return value === 'draft' || value === 'validated' || value === 'published' || value === 'archived';
}

export function isValidated(content: Pick<ValidatedContent, 'state'>): boolean {
  return content.state === 'validated';
}
