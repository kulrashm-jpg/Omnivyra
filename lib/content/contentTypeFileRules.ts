export type OwnedLongformContentType =
  | 'blog'
  | 'newsletter'
  | 'article'
  | 'guide'
  | 'story'
  | 'whitepaper';

export type PlannedContentType =
  | OwnedLongformContentType
  | 'post'
  | 'video_script'
  | 'carousel';

export type ContentTypeImplementationStatus = 'implemented' | 'planned';

export type ContentTypeFileRule = {
  namespace: string;
  createFile: string;
  manageFile: string;
  improveFile: string;
  status: ContentTypeImplementationStatus;
};

export const CONTENT_TYPE_FILE_RULES: Record<PlannedContentType, ContentTypeFileRule> = {
  blog: {
    namespace: 'lib/blog/*',
    createFile: 'lib/blog/runBlogGeneration.ts',
    manageFile: 'lib/blog/defaultBlogTemplates.ts',
    improveFile: 'lib/blog/blogImprovementEngine.ts',
    status: 'implemented',
  },
  newsletter: {
    namespace: 'lib/newsletter/*',
    createFile: 'lib/newsletter/runNewsletterGeneration.ts',
    manageFile: 'lib/newsletter/defaultNewsletterTemplates.ts',
    improveFile: 'lib/newsletter/newsletterImprovementEngine.ts',
    status: 'implemented',
  },
  article: {
    namespace: 'lib/article/*',
    createFile: 'lib/article/runArticleGeneration.ts',
    manageFile: 'lib/article/defaultArticleTemplates.ts',
    improveFile: 'lib/article/articleImprovementEngine.ts',
    status: 'implemented',
  },
  guide: {
    namespace: 'lib/guide/*',
    createFile: 'lib/guide/runGuideGeneration.ts',
    manageFile: 'lib/guide/defaultGuideTemplates.ts',
    improveFile: 'lib/guide/guideImprovementEngine.ts',
    status: 'implemented',
  },
  story: {
    namespace: 'lib/story/*',
    createFile: 'lib/story/runStoryGeneration.ts',
    manageFile: 'lib/story/defaultStoryTemplates.ts',
    improveFile: 'lib/story/storyImprovementEngine.ts',
    status: 'implemented',
  },
  whitepaper: {
    namespace: 'lib/whitepaper/*',
    createFile: 'lib/whitepaper/runWhitepaperGeneration.ts',
    manageFile: 'lib/whitepaper/defaultWhitepaperTemplates.ts',
    improveFile: 'lib/whitepaper/whitepaperImprovementEngine.ts',
    status: 'implemented',
  },
  post: {
    namespace: 'lib/post/*',
    createFile: 'lib/post/runPostGeneration.ts',
    manageFile: 'lib/post/defaultPostTemplates.ts',
    improveFile: 'lib/post/postImprovementEngine.ts',
    status: 'planned',
  },
  video_script: {
    namespace: 'lib/video-script/*',
    createFile: 'lib/video-script/runVideoScriptGeneration.ts',
    manageFile: 'lib/video-script/defaultVideoScriptTemplates.ts',
    improveFile: 'lib/video-script/videoScriptImprovementEngine.ts',
    status: 'planned',
  },
  carousel: {
    namespace: 'lib/carousel/*',
    createFile: 'lib/carousel/runCarouselGeneration.ts',
    manageFile: 'lib/carousel/defaultCarouselTemplates.ts',
    improveFile: 'lib/carousel/carouselImprovementEngine.ts',
    status: 'planned',
  },
};

export function isOwnedLongformContentType(value: string): value is OwnedLongformContentType {
  return value === 'blog'
    || value === 'newsletter'
    || value === 'article'
    || value === 'guide'
    || value === 'story'
    || value === 'whitepaper';
}

export function isPlannedContentType(value: string): value is PlannedContentType {
  return value in CONTENT_TYPE_FILE_RULES;
}

export function getContentTypeFileRule(contentType: PlannedContentType): ContentTypeFileRule {
  return CONTENT_TYPE_FILE_RULES[contentType];
}

