import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';

export type StoryGenerationRequest =
  Omit<BlogGenerationRequest, 'contentType'> & {
    contentType?: 'story';
  };

export type StoryGenerationResult = BlogGenerationResult;

export async function runStoryGeneration(
  input: StoryGenerationRequest,
): Promise<StoryGenerationResult> {
  return runBlogGeneration({
    ...input,
    contentType: 'story',
  });
}
