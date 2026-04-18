import {
  runManagedContentGeneration,
  type ManagedGenerationRequest,
  type ManagedGenerationResult,
} from '../content/runManagedContentGeneration';

export type ArticleGenerationRequest =
  Omit<ManagedGenerationRequest, 'contentType'> & {
    contentType?: 'article';
  };

export type ArticleGenerationResult = ManagedGenerationResult;

export async function runArticleGeneration(
  input: ArticleGenerationRequest,
): Promise<ArticleGenerationResult> {
  return runManagedContentGeneration(input, 'article');
}
