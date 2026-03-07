/**
 * Reusable platform icon component.
 * Renders brand icon + optional label; uses icon libraries (no image URLs).
 */

import React from 'react';
import { getPlatformIcon, getPlatformLabel, normalizePlatform } from '@/utils/platformIcons';

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: '#0A66C2',
  facebook: '#1877F2',
  instagram: '#E4405F',
  youtube: '#FF0000',
  twitter: '#000000',
  tiktok: '#000000',
  pinterest: '#BD081C',
  reddit: '#FF4500',
  threads: '#000000',
};

export interface PlatformIconProps {
  /** Platform key (e.g. linkedin, x, instagram) */
  platform: string;
  /** Icon size in px; default 16. Keep small when used with execution-mode borders. */
  size?: number;
  /** Show platform label next to icon */
  showLabel?: boolean;
  /** Optional className for the wrapper span */
  className?: string;
  /** Use brand color for icon; default true */
  useBrandColor?: boolean;
}

export default function PlatformIcon({
  platform,
  size = 16,
  showLabel = false,
  className = '',
  useBrandColor = true,
}: PlatformIconProps) {
  const key = normalizePlatform(platform);
  const Icon = getPlatformIcon(platform);
  const label = getPlatformLabel(platform);
  const color = useBrandColor && key ? PLATFORM_COLORS[key] : undefined;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} role="img" aria-label={label || platform || 'Platform'}>
      <Icon size={size} color={color} aria-hidden />
      {showLabel && <span>{label || platform}</span>}
    </span>
  );
}
