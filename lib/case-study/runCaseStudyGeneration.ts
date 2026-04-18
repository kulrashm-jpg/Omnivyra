import {
  runManagedContentGeneration,
  type ManagedGenerationRequest,
  type ManagedGenerationResult,
} from '../content/runManagedContentGeneration';

export type CaseStudyGenerationRequest =
  Omit<ManagedGenerationRequest, 'contentType' | 'formatType'> & {
    contentType?: 'blog';
    formatType?: 'case-study';
  };

export type CaseStudyGenerationResult = ManagedGenerationResult;

export async function runCaseStudyGeneration(
  input: CaseStudyGenerationRequest,
): Promise<CaseStudyGenerationResult> {
  return runManagedContentGeneration(
    {
      ...input,
      contentType: 'blog',
      formatType: 'case-study',
    },
    'blog',
  );
}
