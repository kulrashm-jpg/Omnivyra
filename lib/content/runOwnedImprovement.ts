import type {
  ImproveContentDraftInput,
  ImproveContentDraftOutput,
} from './contentImprovementEngine';
import { improveContentDraft } from './contentImprovementEngine';
import { improveBlogContent } from '../blog/blogImprovementEngine';
import { improveNewsletterDraft } from '../newsletter/newsletterImprovementEngine';
import { improveArticleDraft } from '../article/articleImprovementEngine';
import { improveGuideDraft } from '../guide/guideImprovementEngine';
import { improveStoryDraft } from '../story/storyImprovementEngine';
import { improveWhitepaperDraft } from '../whitepaper/whitepaperImprovementEngine';
import { isOwnedLongformContentType, type OwnedLongformContentType } from './contentTypeFileRules';

export async function runOwnedImprovement(
  input: ImproveContentDraftInput,
): Promise<ImproveContentDraftOutput> {
  const contentType = typeof input.context?.contentType === 'string' ? input.context.contentType : 'blog';

  if (!isOwnedLongformContentType(contentType)) {
    return improveContentDraft(input);
  }

  switch (contentType as OwnedLongformContentType) {
    case 'newsletter':
      return improveNewsletterDraft(input);
    case 'article':
      return improveArticleDraft(input);
    case 'guide':
      return improveGuideDraft(input);
    case 'story':
      return improveStoryDraft(input);
    case 'whitepaper':
      return improveWhitepaperDraft(input);
    case 'blog':
    default:
      return improveBlogContent(input);
  }
}
