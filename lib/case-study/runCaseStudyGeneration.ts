import type {
  ManagedGenerationRequest,
  ManagedGenerationResult,
} from '../content/runManagedContentGeneration';
import { runUnifiedLongFormGeneration } from '../content/unifiedLongFormEngine';

export type CaseStudyGenerationRequest =
  Omit<ManagedGenerationRequest, 'contentType' | 'formatType'> & {
    contentType?: 'blog';
    formatType?: 'case-study';
  };

export type CaseStudyGenerationResult = ManagedGenerationResult;

export async function runCaseStudyGeneration(
  input: CaseStudyGenerationRequest,
): Promise<CaseStudyGenerationResult> {
  return runUnifiedLongFormGeneration({
    ...input,
    contentType: 'case-study',
    formatType: 'case-study',
    templateBlocks: input.template_blocks,
    targetWordCount: input.answers?.target_word_count
      ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
      : input.target_words,
  });
}
