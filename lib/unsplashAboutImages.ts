/**
 * Hardcoded Unsplash images for the About page. Use server-side only (getStaticProps, API route).
 * No API key required — these are publicly accessible direct image URLs.
 */

export type AboutImage = {
  url: string;
  credit: string;
  userUrl: string;
  photoUrl: string;
};

// Abstract light / clarity / blue tones — Hero
const HERO_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1400&q=85&fm=jpg',
  credit: 'Campaign Creators',
  userUrl: 'https://unsplash.com/@campaign_creators',
  photoUrl: 'https://unsplash.com/photos/669a67965ba0',
};

// Marketing analytics / multi-channel overwhelm — Section 2 "The Reality"
const CHAOS_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1400&q=85&fm=jpg',
  credit: 'Carlos Muza',
  userUrl: 'https://unsplash.com/@carlosmuza',
  photoUrl: 'https://unsplash.com/photos/hpjSkU2UYSU',
};

// Performance / gap in results — Section 3 "The Gap"
const DISCONNECTED_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=1400&q=85&fm=jpg',
  credit: 'Stephen Dawson',
  userUrl: 'https://unsplash.com/@srd844',
  photoUrl: 'https://unsplash.com/photos/qwtCeJ5cLYs',
};

// Unified marketing platform / team building strategy — Section 5 "So we built something different"
const CONNECTED_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1400&q=85&fm=jpg',
  credit: 'Austin Distel',
  userUrl: 'https://unsplash.com/@austindistel',
  photoUrl: 'https://unsplash.com/photos/wD1LRb9OeEo',
};

// Marketing system / structured planning workspace — Section 7 "Marketing works like a system"
const BLUEPRINT_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=1400&q=85&fm=jpg',
  credit: 'Marvin Meyer',
  userUrl: 'https://unsplash.com/@marvelous',
  photoUrl: 'https://unsplash.com/photos/SYTO3xs06fU',
};

export type AboutImages = {
  hero: AboutImage;
  chaos: AboutImage;
  disconnected: AboutImage;
  connected: AboutImage;
  blueprint: AboutImage;
};

export async function getAboutImages(): Promise<AboutImages> {
  return {
    hero: HERO_IMAGE,
    chaos: CHAOS_IMAGE,
    disconnected: DISCONNECTED_IMAGE,
    connected: CONNECTED_IMAGE,
    blueprint: BLUEPRINT_IMAGE,
  };
}
