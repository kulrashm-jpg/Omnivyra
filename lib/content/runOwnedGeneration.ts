import type { BlogGenerationRequest, BlogGenerationResult } from '../blog/runBlogGeneration';
import { runNewsletterGeneration } from '../newsletter/runNewsletterGeneration';
import { runArticleGeneration } from '../article/runArticleGeneration';
import { runGuideGeneration } from '../guide/runGuideGeneration';
import { runStoryGeneration } from '../story/runStoryGeneration';
import { runWhitepaperGeneration } from '../whitepaper/runWhitepaperGeneration';
import { isOwnedLongformContentType, type OwnedLongformContentType } from './contentTypeOwnership';
import { runUnifiedLongFormGeneration } from './unifiedLongFormEngine';

export async function runOwnedGeneration(
  input: BlogGenerationRequest & { contentType?: string },
): Promise<BlogGenerationResult> {
  const contentType = typeof input.contentType === 'string' ? input.contentType : 'blog';

  if (!isOwnedLongformContentType(contentType)) {
    return runUnifiedLongFormGeneration({
      ...input,
      contentType: 'blog',
      formatType: typeof input.formatType === 'string' ? input.formatType : undefined,
      templateBlocks: input.template_blocks,
      targetWordCount: input.answers?.target_word_count
        ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
        : input.target_words,
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
      return runUnifiedLongFormGeneration({
        ...input,
        contentType: 'blog',
        formatType: typeof input.formatType === 'string' ? input.formatType : undefined,
        templateBlocks: input.template_blocks,
        targetWordCount: input.answers?.target_word_count
          ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
          : input.target_words,
      });
  }
}
