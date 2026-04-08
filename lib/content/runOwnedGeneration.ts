import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';
import { runNewsletterGeneration } from '../newsletter/runNewsletterGeneration';
import { runArticleGeneration } from '../article/runArticleGeneration';
import { runGuideGeneration } from '../guide/runGuideGeneration';
import { runStoryGeneration } from '../story/runStoryGeneration';
import { runWhitepaperGeneration } from '../whitepaper/runWhitepaperGeneration';
import { isOwnedLongformContentType, type OwnedLongformContentType } from './contentTypeOwnership';

export async function runOwnedGeneration(
  input: BlogGenerationRequest & { contentType?: string },
): Promise<BlogGenerationResult> {
  const contentType = typeof input.contentType === 'string' ? input.contentType : 'blog';

  if (!isOwnedLongformContentType(contentType)) {
    return runBlogGeneration({
      ...input,
      contentType: 'blog',
    });
  }

  switch (contentType as OwnedLongformContentType) {
    case 'newsletter':
      return runNewsletterGeneration(input);
    case 'article':
      return runArticleGeneration(input);
    case 'guide':
      return runGuideGeneration(input);
    case 'story':
      return runStoryGeneration(input);
    case 'whitepaper':
      return runWhitepaperGeneration(input);
    case 'blog':
    default:
      return runBlogGeneration({
        ...input,
        contentType: 'blog',
      });
  }
}
