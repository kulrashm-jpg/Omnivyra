import {
  runManagedContentGeneration,
  type ManagedGenerationRequest,
  type ManagedGenerationResult,
} from '../content/runManagedContentGeneration';

export type GuideGenerationRequest =
  Omit<ManagedGenerationRequest, 'contentType'> & {
    contentType?: 'guide';
  };

export type GuideGenerationResult = ManagedGenerationResult;

export async function runGuideGeneration(
  input: GuideGenerationRequest,
): Promise<GuideGenerationResult> {
  return runManagedContentGeneration(input, 'guide');
}
