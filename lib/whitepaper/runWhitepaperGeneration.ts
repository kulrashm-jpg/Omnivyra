import {
  runManagedContentGeneration,
  type ManagedGenerationRequest,
  type ManagedGenerationResult,
} from '../content/runManagedContentGeneration';

export type WhitepaperGenerationRequest =
  Omit<ManagedGenerationRequest, 'contentType'> & {
    contentType?: 'whitepaper';
  };

export type WhitepaperGenerationResult = ManagedGenerationResult;

export async function runWhitepaperGeneration(
  input: WhitepaperGenerationRequest,
): Promise<WhitepaperGenerationResult> {
  return runManagedContentGeneration(input, 'whitepaper');
}
