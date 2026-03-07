'use client';

import React, { useCallback, useState } from 'react';
import {
  Facebook,
  Twitter,
  Linkedin,
  Link2,
  MessageCircle,
  Check,
  Share2,
  Mail,
} from 'lucide-react';

type SharePlatform = 'twitter' | 'facebook' | 'linkedin' | 'whatsapp' | 'pinterest' | 'reddit' | 'email' | 'copy';

const shareUrls: Record<
  SharePlatform,
  (url: string, title?: string, text?: string) => string
> = {
  twitter: (url, title) =>
    `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  facebook: (url) =>
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  linkedin: (url, title, text) =>
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}${text ? `&summary=${encodeURIComponent(text)}` : ''}`,
  whatsapp: (url, title) =>
    `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  pinterest: (url, title) =>
    `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}`,
  reddit: (url, title) =>
    `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
  email: (url, title) =>
    `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`Check out this article: ${url}`)}`,
  copy: () => '',
};

type BlogShareButtonsProps = {
  url: string;
  title: string;
  excerpt?: string | null;
  className?: string;
};

export function BlogShareButtons({
  url,
  title,
  excerpt,
  className = '',
}: BlogShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(
    (platform: SharePlatform) => {
      if (platform === 'email') {
        window.location.href = shareUrls.email(url, title);
        return;
      }
      if (platform === 'copy') {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
        return;
      }
      const href = shareUrls[platform](url, title, excerpt || undefined);
      window.open(href, '_blank', 'noopener,noreferrer,width=600,height=400');
    },
    [url, title, excerpt]
  );

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="mr-2 text-sm font-medium text-gray-600">Share:</span>
      <a
        href={shareUrls.twitter(url, title)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleShare('twitter');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1DA1F2] text-white transition hover:opacity-90"
        aria-label="Share on X (Twitter)"
      >
        <Twitter className="h-4 w-4" />
      </a>
      <a
        href={shareUrls.facebook(url)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleShare('facebook');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1877F2] text-white transition hover:opacity-90"
        aria-label="Share on Facebook"
      >
        <Facebook className="h-4 w-4" />
      </a>
      <a
        href={shareUrls.linkedin(url, title, excerpt || undefined)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleShare('linkedin');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#0A66C2] text-white transition hover:opacity-90"
        aria-label="Share on LinkedIn"
      >
        <Linkedin className="h-4 w-4" />
      </a>
      <a
        href={shareUrls.whatsapp(url, title)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleShare('whatsapp');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white transition hover:opacity-90"
        aria-label="Share on WhatsApp"
      >
        <MessageCircle className="h-4 w-4" />
      </a>
      <a
        href={shareUrls.pinterest(url, title)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleShare('pinterest');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#E60023] text-white transition hover:opacity-90"
        aria-label="Share on Pinterest"
      >
        <Share2 className="h-4 w-4" />
      </a>
      <a
        href={shareUrls.reddit(url, title)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleShare('reddit');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#FF4500] text-white transition hover:opacity-90"
        aria-label="Share on Reddit"
      >
        <span className="text-[10px] font-bold">r</span>
      </a>
      <a
        href={shareUrls.email(url, title)}
        onClick={(e) => {
          e.preventDefault();
          handleShare('email');
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
        aria-label="Share via Email"
      >
        <Mail className="h-4 w-4" />
      </a>
      <button
        type="button"
        onClick={() => handleShare('copy')}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
        aria-label="Copy link"
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
