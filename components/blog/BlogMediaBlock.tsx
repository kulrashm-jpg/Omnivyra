'use client';

import React, { useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';

export type MediaBlockItem = {
  type: 'youtube' | 'spotify_track' | 'spotify_podcast' | 'external_link';
  url: string;
};

function getYoutubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v') || (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null);
    return v ? `https://www.youtube.com/embed/${v}` : null;
  } catch {
    return null;
  }
}

function getSpotifyEmbedUrl(url: string, type: 'track' | 'episode'): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const match = path.match(/\/(track|episode)\/([a-zA-Z0-9]+)/);
    if (!match) return null;
    const id = match[2];
    return type === 'track'
      ? `https://open.spotify.com/embed/track/${id}`
      : `https://open.spotify.com/embed/episode/${id}`;
  } catch {
    return null;
  }
}

function getYoutubeThumbnail(url: string): string | null {
  const embed = getYoutubeEmbedUrl(url);
  if (!embed) return null;
  const v = new URL(embed).pathname.split('/').pop();
  return v ? `https://img.youtube.com/vi/${v}/maxresdefault.jpg` : null;
}

export function BlogMediaBlock({ block }: { block: MediaBlockItem }) {
  const [youtubePlay, setYoutubePlay] = useState(false);

  if (block.type === 'youtube') {
    const embedUrl = getYoutubeEmbedUrl(block.url);
    const thumb = getYoutubeThumbnail(block.url);
    if (!embedUrl) {
      return (
        <a href={block.url} target="_blank" rel="noopener noreferrer" className="blog-media-link">
          Watch on YouTube
        </a>
      );
    }
    if (!youtubePlay) {
      return (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-900">
          {thumb && (
            <img
              src={thumb}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
          <button
            type="button"
            onClick={() => setYoutubePlay(true)}
            className="absolute inset-0 flex items-center justify-center bg-black/40 transition hover:bg-black/50"
            aria-label="Play video"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
              <Play className="h-8 w-8 ml-1" fill="currentColor" />
            </span>
          </button>
        </div>
      );
    }
    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl">
        <iframe
          src={embedUrl}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }

  if (block.type === 'spotify_track') {
    const embedUrl = getSpotifyEmbedUrl(block.url, 'track');
    if (!embedUrl) {
      return (
        <a href={block.url} target="_blank" rel="noopener noreferrer" className="blog-media-link">
          Listen on Spotify
        </a>
      );
    }
    return (
      <div className="w-full overflow-hidden rounded-xl">
        <iframe
          src={embedUrl}
          width="100%"
          height="152"
          frameBorder="0"
          allowFullScreen
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          title="Spotify track"
        />
      </div>
    );
  }

  if (block.type === 'spotify_podcast') {
    const embedUrl = getSpotifyEmbedUrl(block.url, 'episode');
    if (!embedUrl) {
      return (
        <a href={block.url} target="_blank" rel="noopener noreferrer" className="blog-media-link">
          Listen on Spotify
        </a>
      );
    }
    return (
      <div className="w-full overflow-hidden rounded-xl">
        <iframe
          src={embedUrl}
          width="100%"
          height="232"
          frameBorder="0"
          allowFullScreen
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          title="Spotify podcast"
        />
      </div>
    );
  }

  if (block.type === 'external_link') {
    return (
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="blog-media-link inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-700 hover:bg-gray-100"
      >
        <ExternalLink className="h-4 w-4" />
        {block.url}
      </a>
    );
  }

  return null;
}

export function BlogMediaBlocks({ blocks }: { blocks: MediaBlockItem[] | null | undefined }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return (
    <div className="space-y-6">
      {blocks.map((block, i) => (
        <BlogMediaBlock key={i} block={block} />
      ))}
    </div>
  );
}
