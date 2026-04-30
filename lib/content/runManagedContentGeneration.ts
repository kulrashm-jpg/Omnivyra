import type { BlogGenerationRequest, BlogGenerationResult } from '../blog/runBlogGeneration';
import type { ManagedContentType } from './contentTemplateRegistry';
import { runUnifiedLongFormGeneration } from './unifiedLongFormEngine';

export type ManagedGenerationRequest = BlogGenerationRequest;
export type ManagedGenerationResult = BlogGenerationResult;

export async function runManagedContentGeneration(
  input: ManagedGenerationRequest,
  contentType: Extract<ManagedContentType, 'blog' | 'article' | 'guide' | 'story' | 'whitepaper'>,
): Promise<ManagedGenerationResult> {
  return runUnifiedLongFormGeneration({
    ...input,
    contentType,
    formatType: typeof input.formatType === 'string' ? input.formatType : undefined,
    templateBlocks: input.template_blocks,
    targetWordCount: input.answers?.target_word_count
      ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
      : input.target_words,
  });
}
