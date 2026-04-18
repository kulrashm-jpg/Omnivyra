import {
  runManagedContentGeneration,
  type ManagedGenerationRequest,
  type ManagedGenerationResult,
} from '../content/runManagedContentGeneration';

export type StoryGenerationRequest =
  Omit<ManagedGenerationRequest, 'contentType'> & {
    contentType?: 'story';
  };

export type StoryGenerationResult = ManagedGenerationResult;

export async function runStoryGeneration(
  input: StoryGenerationRequest,
): Promise<StoryGenerationResult> {
  return runManagedContentGeneration(input, 'story');
}
