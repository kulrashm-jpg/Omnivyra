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
      return runNewsletterGeneration({ ...input, contentType: 'newsletter' } as any);
    case 'article':
      return runArticleGeneration({ ...input, contentType: 'article' } as any);
    case 'guide':
      return runGuideGeneration({ ...input, contentType: 'guide' } as any);
    case 'story':
      return runStoryGeneration({ ...input, contentType: 'story' } as any);
    case 'whitepaper':
      return runWhitepaperGeneration({ ...input, contentType: 'whitepaper' } as any);
    case 'blog':
    default:
      return runBlogGeneration({
        ...input,
        contentType: 'blog',
      });
  }
}
