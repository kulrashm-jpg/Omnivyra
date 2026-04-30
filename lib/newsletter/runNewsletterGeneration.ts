import type {
  SharedGenerationRequest,
  SharedGenerationResult,
} from '../content/sharedGenerationRunner';
import { runUnifiedLongFormGeneration } from '../content/unifiedLongFormEngine';

export type NewsletterGenerationRequest =
  Omit<SharedGenerationRequest, 'contentType'> & {
    contentType?: 'newsletter';
  };

export type NewsletterGenerationResult = SharedGenerationResult;

export async function runNewsletterGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  // Dedicated newsletter runners are deprecated as generation engines. The
  // dispatcher remains as the owned module boundary, but all newsletter drafts
  // now enter the single long-form engine; templates are structure/render specs.
  return runUnifiedLongFormGeneration({
    ...input,
    contentType: 'newsletter',
    formatType: typeof input.formatType === 'string' ? input.formatType : undefined,
    templateBlocks: input.template_blocks,
    targetWordCount: input.answers?.target_word_count
      ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
      : input.target_words,
  });
}
