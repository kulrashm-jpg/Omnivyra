// Real-System Mapper Layer
//
// Deterministic, pure, non-executing transform of real system entities
// (blog / long-form content rows + website/integration context) into a
// UniversalPublishSnapshotInput. Platform-agnostic — it produces the governed
// input shape only; it does not create snapshots, publish, or mutate anything.

import type {
  PublishIntent,
  UniversalPublishSnapshotInput,
} from './universalPublishSnapshot';

// Minimal projection of a `blogs` (or long-form content) row.
export interface BlogContentSource {
  id: string;
  company_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  content_blocks: readonly unknown[] | null;
  featured_image_url: string | null;
  category: string | null;
  tags: readonly string[] | null;
  seo_meta_title: string | null;
  seo_meta_description: string | null;
  website_id: string | null;
  integration_id: string | null;
  external_id: string | null;
  scheduled_publish_at: string | null;
}

export interface PublishSnapshotMappingContext {
  renderedHtml: string;
  contentType: string;
  publishIntent: PublishIntent;
  publishTargetType: string;
  canonicalUrl: string;
  focusKeyword: string;
  author: { authorId: string; authorName: string };
  generationMetadata: Record<string, unknown>;
}

function str(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

function list<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

// Deterministic: identical (blog, context) always yields an identical input.
export function mapBlogToPublishSnapshotInput(
  blog: BlogContentSource,
  context: PublishSnapshotMappingContext,
): UniversalPublishSnapshotInput {
  const featuredImageUrl = str(blog.featured_image_url);
  return {
    renderedHtml: context.renderedHtml,
    contentBlocks: list(blog.content_blocks),
    seoMetadata: {
      metaTitle: str(blog.seo_meta_title) || str(blog.title),
      metaDescription: str(blog.seo_meta_description) || str(blog.excerpt),
      focusKeyword: str(context.focusKeyword),
    },
    slug: str(blog.slug),
    canonicalFields: {
      canonicalUrl: str(context.canonicalUrl),
      slugLocked: true,
    },
    mediaReferences: {
      featuredImageUrl,
      media: featuredImageUrl
        ? [{ ref: featuredImageUrl, role: 'featured', alt: str(blog.title) }]
        : [],
    },
    taxonomy: {
      category: str(blog.category),
      tags: list(blog.tags).map((tag) => String(tag)),
    },
    authorAttribution: {
      authorId: str(context.author.authorId),
      authorName: str(context.author.authorName),
    },
    companyContext: {
      companyId: str(blog.company_id),
      websiteId: str(blog.website_id),
      integrationId: str(blog.integration_id),
    },
    contentType: str(context.contentType),
    generationMetadata: { ...context.generationMetadata, sourceBlogId: str(blog.id) },
    publishTargetMetadata: {
      publishTargetType: str(context.publishTargetType),
      externalId: str(blog.external_id),
    },
    scheduledTimestamp: blog.scheduled_publish_at ?? null,
    publishIntent: context.publishIntent,
  };
}
