import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';

export type GuideGenerationRequest =
  Omit<BlogGenerationRequest, 'contentType'> & {
    contentType?: 'guide';
  };

export type GuideGenerationResult = BlogGenerationResult;

export async function runGuideGeneration(
  input: GuideGenerationRequest,
): Promise<GuideGenerationResult> {
  return runBlogGeneration({
    ...input,
    contentType: 'guide',
  });
}
