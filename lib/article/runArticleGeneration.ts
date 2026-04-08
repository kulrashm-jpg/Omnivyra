import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';

export type ArticleGenerationRequest =
  Omit<BlogGenerationRequest, 'contentType'> & {
    contentType?: 'article';
  };

export type ArticleGenerationResult = BlogGenerationResult;

export async function runArticleGeneration(
  input: ArticleGenerationRequest,
): Promise<ArticleGenerationResult> {
  return runBlogGeneration({
    ...input,
    contentType: 'article',
  });
}
