import type { BlogGenerationRequest, BlogGenerationResult } from '../blog/runBlogGeneration';
import { runUnifiedLongFormGeneration } from './unifiedLongFormEngine';

export type SharedGenerationRequest = BlogGenerationRequest;
export type SharedGenerationResult = BlogGenerationResult;

export async function runSharedGeneration(
  input: SharedGenerationRequest,
): Promise<SharedGenerationResult> {
  return runUnifiedLongFormGeneration({
    ...input,
    contentType: (input.contentType || 'blog') as any,
    formatType: typeof input.formatType === 'string' ? input.formatType : undefined,
    templateBlocks: input.template_blocks,
    targetWordCount: input.answers?.target_word_count
      ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
      : input.target_words,
  });
}
