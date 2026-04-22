import type { NextRouter } from 'next/router';
import type { ContentBlock, HeadingBlock, ImageBlock, ParagraphBlock, SummaryBlock, KeyInsightsBlock, ListBlock } from '../blog/blockTypes';
import { generateAnchor, newId } from '../blog/blockUtils';

type CreatorAssetPayload = {
  media_bundle?: {
    url?: string;
    files?: string[];
  };
  slides?: Array<Record<string, unknown>>;
  caption_blueprint?: {
    hook?: string;
    body?: string;
    cta?: string;
  };
  visual_descriptor?: {
    headline?: string;
    visual_description?: string;
  };
};

type CreatorOutput = {
  asset_type: string;
  asset_payload: CreatorAssetPayload;
  packaging: {
    caption: string;
    hashtags: string[];
    cta: string;
    meta_description: string;
  };
};

type CreatorBlogPrefillPayload = {
  output: {
    title: string;
    excerpt: string;
    category: string;
    tags: string[];
    content_blocks: ContentBlock[];
    content_markdown: string;
    seo_meta_title: string;
    seo_meta_description: string;
  };
  source: 'creator_content';
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.isArray(tags)
    ? tags
        .map((tag) => String(tag || '').trim().replace(/^#+/, ''))
        .filter(Boolean)
        .slice(0, 8)
    : [];
}

export function getCreatorMediaUrls(output: CreatorOutput): string[] {
  const mediaBundle = output.asset_payload.media_bundle || {};
  const single = typeof mediaBundle.url === 'string' && mediaBundle.url.trim() ? [mediaBundle.url.trim()] : [];
  const multi = Array.isArray(mediaBundle.files)
    ? mediaBundle.files.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return [...single, ...multi];
}

function paragraph(text: string): ParagraphBlock {
  return {
    id: newId(),
    type: 'paragraph',
    html: `<p>${escapeHtml(text)}</p>`,
  };
}

function heading(text: string): HeadingBlock {
  return {
    id: newId(),
    type: 'heading',
    level: 2,
    text,
    anchor: generateAnchor(text),
  };
}

function image(url: string, alt: string, caption?: string): ImageBlock {
  return {
    id: newId(),
    type: 'image',
    url,
    alt,
    caption: caption || undefined,
  };
}

function summary(body: string): SummaryBlock {
  return {
    id: newId(),
    type: 'summary',
    body,
  };
}

function keyInsights(items: string[]): KeyInsightsBlock {
  return {
    id: newId(),
    type: 'key_insights',
    title: 'Key Insights',
    items,
  };
}

function bulletList(items: string[]): ListBlock {
  return {
    id: newId(),
    type: 'list',
    listType: 'bullet',
    items: items.map((text) => ({ id: newId(), text })),
  };
}

export function buildCreatorContentBlocks(title: string, output: CreatorOutput): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const safeTitle = String(title || 'Creator Asset').trim();
  const mediaUrls = getCreatorMediaUrls(output);
  const slideRecords = Array.isArray(output.asset_payload.slides) ? output.asset_payload.slides : [];
  const captionBlueprint = output.asset_payload.caption_blueprint || {};
  const visualDescriptor = output.asset_payload.visual_descriptor || {};
  const cleanCaption = String(output.packaging.caption || '').trim();
  const cleanMeta = String(output.packaging.meta_description || '').trim();

  blocks.push(heading(safeTitle));

  if (cleanMeta) {
    blocks.push(summary(cleanMeta));
  }

  if (captionBlueprint.hook || captionBlueprint.body || captionBlueprint.cta) {
    const insightItems = [captionBlueprint.hook, captionBlueprint.body, captionBlueprint.cta]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (insightItems.length > 0) {
      blocks.push(keyInsights(insightItems));
    }
  } else if (cleanCaption) {
    blocks.push(paragraph(cleanCaption));
  }

  if (visualDescriptor.headline || visualDescriptor.visual_description) {
    const visualSummary = [visualDescriptor.headline, visualDescriptor.visual_description]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' — ');
    if (visualSummary) {
      blocks.push(paragraph(visualSummary));
    }
  }

  if (slideRecords.length > 0) {
    const slideOutline = slideRecords
      .map((slide, index) => {
        const role = String(slide.role || `slide ${index + 1}`).trim();
        const headlineText = String(slide.headline || '').trim();
        const bodyText = String(slide.body_text || '').trim();
        return [role, headlineText, bodyText].filter(Boolean).join(': ');
      })
      .filter(Boolean);

    if (slideOutline.length > 0) {
      blocks.push(heading('Asset Structure'));
      blocks.push(bulletList(slideOutline));
    }
  }

  mediaUrls.forEach((url, index) => {
    const relatedSlide = slideRecords[index] || null;
    const alt = String(
      relatedSlide?.headline ||
      visualDescriptor.headline ||
      safeTitle,
    ).trim();
    const caption = String(relatedSlide?.body_text || cleanMeta || cleanCaption).trim();
    blocks.push(image(url, alt || safeTitle, caption || undefined));
  });

  return blocks;
}

export function buildCreatorMarkdown(title: string, output: CreatorOutput): string {
  const lines: string[] = [`# ${String(title || 'Creator Asset').trim()}`];

  if (output.packaging.meta_description) {
    lines.push('', output.packaging.meta_description.trim());
  }

  if (output.packaging.caption) {
    lines.push('', output.packaging.caption.trim());
  }

  const slides = Array.isArray(output.asset_payload.slides) ? output.asset_payload.slides : [];
  if (slides.length > 0) {
    lines.push('', '## Asset Structure');
    slides.forEach((slide, index) => {
      const headlineText = String(slide.headline || `Slide ${index + 1}`).trim();
      const bodyText = String(slide.body_text || '').trim();
      lines.push('', `### ${headlineText}`);
      if (bodyText) lines.push('', bodyText);
    });
  }

  return lines.join('\n').trim();
}

export function persistCreatorBlogPrefill(payload: CreatorBlogPrefillPayload): string | null {
  if (typeof window === 'undefined') return null;
  const token = `creator_blog_prefill_${Date.now()}`;
  window.sessionStorage.setItem(token, JSON.stringify(payload));
  return token;
}

export function launchBlogFromCreator({
  router,
  title,
  output,
}: {
  router: NextRouter;
  title: string;
  output: CreatorOutput;
}): void {
  const blocks = buildCreatorContentBlocks(title, output);
  const markdown = buildCreatorMarkdown(title, output);
  const payload: CreatorBlogPrefillPayload = {
    output: {
      title: String(title || 'Creator Asset').trim(),
      excerpt: output.packaging.meta_description || output.packaging.caption || '',
      category: 'creator-content',
      tags: normalizeTags(output.packaging.hashtags),
      content_blocks: blocks,
      content_markdown: markdown,
      seo_meta_title: String(title || 'Creator Asset').trim(),
      seo_meta_description: output.packaging.meta_description || output.packaging.caption || '',
    },
    source: 'creator_content',
  };
  const token = persistCreatorBlogPrefill(payload);
  void router.push({
    pathname: '/blogs/new',
    query: token ? { prefill: token } : undefined,
  });
}
