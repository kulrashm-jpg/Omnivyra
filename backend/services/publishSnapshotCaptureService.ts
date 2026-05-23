// Publish Snapshot Capture Service
//
// Captures an immutable publish snapshot at a finalization/scheduling boundary
// and persists it via the snapshot persistence layer. Non-executing: it does
// NOT publish, call a CMS, or touch a queue/scheduler.
//
// `captureBlogPublishSnapshotSafely` is best-effort and NEVER throws — it is
// the safe entry point for wiring into live lifecycle code.

import {
  buildPublishCaptureBundle,
  extractCaptureReferences,
  type PublishCaptureInput,
  type PublishCaptureReferences,
} from '../../lib/publishing/publishSnapshotCapture';
import type {
  PublishCaptureLifecyclePhase,
} from '../../lib/publishing/publishSnapshotCaptureEligibility';
import type { BlogContentSource } from '../../lib/publishing/publishSnapshotMapper';
import type { PublishTargetType } from '../../lib/publishing/universalPublishingContract';
import { createPersistedSnapshot } from './publishSnapshotPersistence';

export interface CapturePublishSnapshotResult {
  captured: boolean;
  persisted: boolean;
  eligible: boolean;
  integrityValid: boolean;
  reasons: readonly string[];
  references: PublishCaptureReferences | null;
}

// Capture + persist. Persists only when the bundle is eligible AND integrity
// verification passes. An ineligible or integrity-failed capture returns an
// advisory result; it does not persist and does not throw a gating error.
export async function capturePublishSnapshot(
  input: PublishCaptureInput,
  blogId: string | null,
): Promise<CapturePublishSnapshotResult> {
  const bundle = buildPublishCaptureBundle(input);
  const references = extractCaptureReferences(bundle);

  if (!bundle.eligibility.eligible) {
    return {
      captured: false,
      persisted: false,
      eligible: false,
      integrityValid: bundle.integrity.valid,
      reasons: bundle.eligibility.reasons,
      references,
    };
  }
  if (!bundle.integrity.valid) {
    return {
      captured: true,
      persisted: false,
      eligible: true,
      integrityValid: false,
      reasons: bundle.integrity.reasons,
      references,
    };
  }

  await createPersistedSnapshot({
    snapshot: bundle.snapshot,
    contract: bundle.contract,
    audit: bundle.audit,
    blogId,
  });

  return {
    captured: true,
    persisted: true,
    eligible: true,
    integrityValid: true,
    reasons: [],
    references,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toBlogContentSource(blog: Record<string, unknown>): BlogContentSource {
  return {
    id: String(blog.id ?? ''),
    company_id: String(blog.company_id ?? ''),
    title: String(blog.title ?? ''),
    slug: String(blog.slug ?? ''),
    excerpt: str(blog.excerpt),
    content: str(blog.content),
    content_blocks: Array.isArray(blog.content_blocks) ? blog.content_blocks : null,
    featured_image_url: str(blog.featured_image_url),
    category: str(blog.category),
    tags: Array.isArray(blog.tags) ? blog.tags.map((tag) => String(tag)) : null,
    seo_meta_title: str(blog.seo_meta_title),
    seo_meta_description: str(blog.seo_meta_description),
    website_id: str(blog.website_id),
    integration_id: str(blog.integration_id),
    external_id: str(blog.external_id),
    scheduled_publish_at: str(blog.scheduled_publish_at),
  };
}

function mapIntegrationTypeToPublishTarget(type: string | null): PublishTargetType {
  switch ((type || '').toLowerCase()) {
    case 'wordpress': return 'wordpress';
    case 'ghost': return 'ghost';
    case 'webflow': return 'webflow';
    case 'shopify': return 'shopify';
    case 'hubspot': return 'hubspot';
    case 'custom_api':
    case 'custom_blog_api': return 'custom_api';
    case 'headless_cms': return 'headless_cms';
    default: return 'generic_website';
  }
}

export interface BlogPublishSnapshotCaptureOptions {
  blog: Record<string, unknown>;
  renderedHtml: string;
  integrationType: string | null;
  contentType?: string;
  lifecyclePhase?: PublishCaptureLifecyclePhase;
  captureSource?: string;
}

// Best-effort capture from the blog publish lifecycle. NEVER throws — any
// error is swallowed into an advisory result so the live publish path is
// completely unaffected.
export async function captureBlogPublishSnapshotSafely(
  options: BlogPublishSnapshotCaptureOptions,
): Promise<CapturePublishSnapshotResult> {
  try {
    const blog = toBlogContentSource(options.blog);
    return await capturePublishSnapshot(
      {
        blog,
        renderedHtml: options.renderedHtml,
        contentType: options.contentType ?? 'blog',
        publishTargetType: mapIntegrationTypeToPublishTarget(options.integrationType),
        canonicalUrl: '',
        focusKeyword: '',
        author: { authorId: '', authorName: '' },
        generationMetadata: {},
        captureSource: options.captureSource ?? 'blog_publish_lifecycle',
        lifecyclePhase: options.lifecyclePhase ?? 'finalization',
        blogStatus: String(options.blog.status ?? ''),
      },
      blog.id || null,
    );
  } catch (error) {
    return {
      captured: false,
      persisted: false,
      eligible: false,
      integrityValid: false,
      reasons: [`capture failed: ${error instanceof Error ? error.message : 'unknown error'}`],
      references: null,
    };
  }
}
