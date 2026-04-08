import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';

export type SharedGenerationRequest = BlogGenerationRequest;
export type SharedGenerationResult = BlogGenerationResult;

export async function runSharedGeneration(
  input: SharedGenerationRequest,
): Promise<SharedGenerationResult> {
  return runBlogGeneration(input);
}
