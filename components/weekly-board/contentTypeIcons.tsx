/**
 * Content type icon mapping for weekly activity cards.
 * Uses Lucide icons per Phase 3 spec.
 */

import React from 'react';
import {
  FileText,
  Newspaper,
  Layers,
  Video,
  Smartphone,
  Mic,
  List,
  type LucideIcon,
} from 'lucide-react';

const CONTENT_TYPE_ICONS: Record<string, LucideIcon> = {
  post: FileText,
  document: FileText,
  article: FileText,
  blog: Newspaper,
  carousel: Layers,
  video: Video,
  reel: Video,
  short: Smartphone,
  'short video': Smartphone,
  shorts: Smartphone,
  podcast: Mic,
  thread: List,
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  post: 'Post',
  document: 'Post',
  article: 'Article',
  blog: 'Blog',
  carousel: 'Carousel',
  video: 'Video',
  reel: 'Reel',
  short: 'Short Video',
  'short video': 'Short Video',
  shorts: 'Short Video',
  podcast: 'Podcast',
  thread: 'Thread',
};

export function normalizeContentTypeKey(v: string): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getContentTypeIcon(contentType: string): LucideIcon {
  const key = normalizeContentTypeKey(contentType);
  return CONTENT_TYPE_ICONS[key] ?? FileText;
}

export function getContentTypeLabel(contentType: string): string {
  const key = normalizeContentTypeKey(contentType);
  return CONTENT_TYPE_LABELS[key] ?? (contentType || 'Post');
}

export interface ContentTypeIconProps {
  contentType: string;
  size?: number;
  className?: string;
  showLabel?: boolean;
}

export function ContentTypeIcon({
  contentType,
  size = 16,
  className = '',
  showLabel = false,
}: ContentTypeIconProps) {
  const Icon = getContentTypeIcon(contentType);
  const label = getContentTypeLabel(contentType);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} aria-label={label}>
      <Icon size={size} aria-hidden />
      {showLabel && <span>{label}</span>}
    </span>
  );
}
