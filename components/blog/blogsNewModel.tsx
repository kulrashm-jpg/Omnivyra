/** Part 1/2 of new.tsx — verbatim split (barrel preserved; importers unchanged). */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BlogEditorForm, type BlogFormState } from '../../components/blog/BlogEditorForm';
import { ContentQualityPanel, type ImproveArea, type PostBlogStatus } from '../../components/content/ContentQualityPanel';
import EditorShareActions from '../../components/content/EditorShareActions';
import { createDefaultBlogTemplate } from '../../lib/blog/blogTemplate';
import { checkDuplication, type DuplicationResult, type ExistingPostMeta } from '../../lib/blog/topicDetection';
import { AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import type { BlogGenerationOutput } from '../../lib/blog/blogGenerationEngine';
import type { BlogFormatType } from '../../lib/blog/blogStructureTemplates';
import { realizeGeneratedBlocks } from '../../lib/content/realizeGeneratedDocument';
import PromotePlatformModal, { type PromotablePlatform } from '../../components/content/PromotePlatformModal';
import PromotionWorkspace, { type WorkspacePlatformSeed } from '../../components/content/PromotionWorkspace';
import { resolveCanonicalContentUrl, loadPromotionDrafts, deletePromotionDraft } from '../../lib/content/promotionDraft';
import { useCompanyIdentity } from '../../hooks/useCompanyIdentity';
import type { CreatorFlowContext } from '../../lib/content/creatorFlowContext';


export const DEFAULT_TEMPLATE = createDefaultBlogTemplate();
export const CMS_INTEGRATION_TYPES = new Set([
  'wordpress',
  'custom_blog_api',
  'ghost',
  'drupal',
  'joomla',
  'webflow',
  'shopify',
  'hubspot',
  'wix',
  'squarespace',
]);

export const CMS_LABELS: Record<string, string> = {
  wordpress: 'WordPress',
  joomla: 'Joomla',
  drupal: 'Drupal',
  ghost: 'Ghost',
  custom_blog_api: 'Other CMS',
  webflow: 'Other CMS',
  shopify: 'Other CMS',
  hubspot: 'Other CMS',
  wix: 'Other CMS',
  squarespace: 'Other CMS',
};

export type PrefillPayload = {
  output?: (BlogGenerationOutput & { content_blocks?: unknown[]; content_markdown?: string }) | null;
  source?: string;
  target_word_count?: number;
  format_type?: BlogFormatType;
  creator_context?: CreatorFlowContext;
};

export type CmsIntegrationOption = {
  id: string;
  type: string;
  name: string;
};

export type ConnectedSocialAccount = {
  platform_key: string;
  platform_label: string;
  connected: boolean;
  category: string;
  social_account_id?: string | null;
};

export function safeFileStem(value: string): string {
  return (value || 'blog-post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'blog-post';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readUrlCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => readUrlCandidates(item, depth + 1));
  if (!isRecord(value)) return [];

  const directKeys = [
    'url', 'src', 'href', 'file_url', 'fileUrl', 'storage_url', 'storageUrl',
    'public_url', 'publicUrl', 'preview_url', 'previewUrl', 'thumbnail_url',
    'thumbnailUrl', 'image_url', 'imageUrl', 'asset_url', 'assetUrl',
  ];
  const nestedKeys = [
    'files', 'images', 'media', 'media_bundle', 'mediaBundle', 'asset_payload',
    'assetPayload', 'creator_asset', 'creatorAsset', 'variants', 'selectedVariant',
    'rendered_asset', 'renderedAsset', 'output',
  ];

  return [
    ...directKeys.flatMap((key) => readUrlCandidates(value[key], depth + 1)),
    ...nestedKeys.flatMap((key) => readUrlCandidates(value[key], depth + 1)),
  ];
}

function uniqueUrls(urls: string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean).filter((url, index, all) => all.indexOf(url) === index);
}

function blockText(block: unknown): string {
  if (!isRecord(block)) return '';
  const type = readString(block, 'type');
  if (type === 'heading') return `${readString(block, 'text')}\n`;
  if (type === 'paragraph' || type === 'text') return stripHtml(readString(block, 'html') || readString(block, 'text'));
  if (type === 'summary' || type === 'callout') return [readString(block, 'title'), readString(block, 'body')].filter(Boolean).join('\n');
  if (type === 'quote') return readString(block, 'text') ? `"${readString(block, 'text')}"` : '';
  if (type === 'key_insights') {
    const items = Array.isArray(block.items) ? block.items.map(String).filter(Boolean) : [];
    return items.map((item) => `- ${item}`).join('\n');
  }
  if (type === 'list') {
    const items = Array.isArray(block.items) ? block.items : [];
    return items
      .filter(isRecord)
      .map((item) => `- ${readString(item, 'text')}`)
      .filter((line) => line !== '- ')
      .join('\n');
  }
  if (type === 'image' || type === 'media' || type === 'creator_asset') {
    const title = readString(block, 'title') || readString(block, 'alt') || 'Asset';
    const urls = uniqueUrls(readUrlCandidates(block));
    return urls.length ? [`${title}:`, ...urls.map((url) => `- ${url}`)].join('\n') : '';
  }
  return '';
}

export function blockHtml(block: unknown): string {
  if (!isRecord(block)) return '';
  const type = readString(block, 'type');
  if (type === 'heading') return `<h2>${escapeHtml(readString(block, 'text'))}</h2>`;
  if (type === 'paragraph' || type === 'text') return readString(block, 'html') || `<p>${escapeHtml(readString(block, 'text'))}</p>`;
  if (type === 'summary' || type === 'callout') {
    return `<aside>${readString(block, 'title') ? `<h3>${escapeHtml(readString(block, 'title'))}</h3>` : ''}<p>${escapeHtml(readString(block, 'body'))}</p></aside>`;
  }
  if (type === 'key_insights') {
    const items = Array.isArray(block.items) ? block.items.map(String).filter(Boolean) : [];
    return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  }
  if (type === 'list') {
    const items = Array.isArray(block.items) ? block.items.filter(isRecord) : [];
    return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(readString(item, 'text'))}</li>`).join('')}</ul>` : '';
  }
  if (type === 'image' || type === 'media' || type === 'creator_asset') {
    const title = readString(block, 'title') || readString(block, 'alt') || 'Asset';
    const caption = readString(block, 'caption') || readString(block, 'description');
    const figures = uniqueUrls(readUrlCandidates(block)).map((url) =>
      `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`,
    );
    return figures.join('\n');
  }
  return '';
}

export function buildTextDownload(state: BlogFormState | null): string {
  if (!state) return '';
  const body = state.content_blocks.map(blockText).filter(Boolean).join('\n\n');
  const assets = uniqueUrls(readUrlCandidates(state.content_blocks));
  return [
    state.title,
    state.excerpt,
    body,
    assets.length ? `Assets\n${assets.map((url) => `- ${url}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

