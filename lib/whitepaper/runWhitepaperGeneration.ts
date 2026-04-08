import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';

export type WhitepaperGenerationRequest =
  Omit<BlogGenerationRequest, 'contentType'> & {
    contentType?: 'whitepaper';
  };

export type WhitepaperGenerationResult = BlogGenerationResult;

export async function runWhitepaperGeneration(
  input: WhitepaperGenerationRequest,
): Promise<WhitepaperGenerationResult> {
  return runBlogGeneration({
    ...input,
    contentType: 'whitepaper',
  });
}
