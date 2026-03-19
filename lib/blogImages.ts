/**
 * Curated marketing-relevant Unsplash images for blog thumbnails.
 *
 * Selection criteria:
 *  - Directly relevant to the article topic (not just "marketing in general")
 *  - Abstract / conceptual — no generic stock smiles
 *  - Each article gets a unique image; no recycling across articles
 *  - Consistent with Omnivyra's dark blue palette when overlaid
 */

export type BlogImage = {
  url: string;
  credit: string;
  photoUrl: string;
};

// ── Per-category fallback images ──────────────────────────────────────────────
// Used when an article has no specific image (real DB articles without featured_image_url)

const CATEGORY_IMAGES: Record<string, BlogImage> = {
  // Campaigns: conversion funnel / performance analytics
  campaigns: {
    url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&q=80',
    credit: 'Carlos Muza',
    photoUrl: 'https://unsplash.com/photos/hpjSkU2UYSU',
  },
  // Content: writing / editorial creation
  content: {
    url: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=900&q=80',
    credit: 'Jess Bailey',
    photoUrl: 'https://unsplash.com/photos/q10VITrVYUM',
  },
  // SEO: laptop + search / website discoverability
  seo: {
    url: 'https://images.unsplash.com/photo-1591696205602-2f950c417cb9?w=900&q=80',
    credit: 'Myriam Jessier',
    photoUrl: 'https://unsplash.com/photos/eveI7MOcSmw',
  },
  // Growth: KPI dashboard / performance metrics
  growth: {
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900&q=80',
    credit: 'Luke Chesser',
    photoUrl: 'https://unsplash.com/photos/JKUTrJ4vK00',
  },
  // Insights: data signals / market intelligence
  insights: {
    url: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=900&q=80',
    credit: 'Stephen Dawson',
    photoUrl: 'https://unsplash.com/photos/qwtCeJ5cLYs',
  },
};

// ── Default fallback ──────────────────────────────────────────────────────────

const DEFAULT_IMAGE: BlogImage = {
  url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&q=80',
  credit: 'Carlos Muza',
  photoUrl: 'https://unsplash.com/photos/hpjSkU2UYSU',
};

// ── Per-article images ────────────────────────────────────────────────────────
// Each image is chosen for the specific article topic, not just its category.

export const ARTICLE_IMAGES: Record<number | string, BlogImage> = {

  // Article 1: "Why your campaigns don't convert (and how to fix it)"
  // → Conversion analytics dashboard — shows performance data + where campaigns fail
  1: {
    url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&q=80',
    credit: 'Carlos Muza',
    photoUrl: 'https://unsplash.com/photos/hpjSkU2UYSU',
  },

  // Article 2: "Before you run ads, check this"
  // → Professional reviewing strategy/checklist before committing — pre-launch mindset
  2: {
    url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=900&q=80',
    credit: 'Amy Hirschi',
    photoUrl: 'https://unsplash.com/photos/JaoVGh5aJ3E',
  },

  // Article 3: "Content without direction is wasted effort"
  // → Pen on paper / purposeful writing — content that starts with intent, not output
  3: {
    url: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=900&q=80',
    credit: 'Jess Bailey',
    photoUrl: 'https://unsplash.com/photos/q10VITrVYUM',
  },

  // Article 4: "How to know if your marketing is actually working"
  // → KPI dashboard with multiple metrics — the measurement question made visual
  4: {
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900&q=80',
    credit: 'Luke Chesser',
    photoUrl: 'https://unsplash.com/photos/JKUTrJ4vK00',
  },

  // Article 5: "Your website ranks for the wrong things"
  // → SEO analytics / search console on laptop — website + search intent mismatch
  5: {
    url: 'https://images.unsplash.com/photo-1591696205602-2f950c417cb9?w=900&q=80',
    credit: 'Myriam Jessier',
    photoUrl: 'https://unsplash.com/photos/eveI7MOcSmw',
  },

  // Article 6: "Structuring a campaign before you brief the team"
  // → Team in a planning/briefing session — campaign structure before execution starts
  6: {
    url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=900&q=80',
    credit: 'Jason Goodman',
    photoUrl: 'https://unsplash.com/photos/Oalh2MojUuk',
  },

  // Article 7: "The gap between marketing activity and marketing results"
  // → Performance chart showing activity vs flat results — the effort/output gap
  7: {
    url: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=900&q=80',
    credit: 'Stephen Dawson',
    photoUrl: 'https://unsplash.com/photos/qwtCeJ5cLYs',
  },

  // Article 8: "Why your content calendar isn't a content strategy"
  // → Open notebook/planner — the calendar tool vs the strategic thinking behind it
  8: {
    url: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=900&q=80',
    credit: 'Estée Janssens',
    photoUrl: 'https://unsplash.com/photos/zni0zgb3bkQ',
  },

  // Article 9: "The channels that actually move the needle for your stage"
  // → Multi-channel digital marketing setup — choosing the right channel mix
  9: {
    url: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=900&q=80',
    credit: 'Adem AY',
    photoUrl: 'https://unsplash.com/photos/Tk9m_HP4rgQ',
  },
};

// ── Public helpers ────────────────────────────────────────────────────────────

/** Return a category-appropriate image, falling back to the default. */
export function getBlogCategoryImage(category: string | null | undefined): BlogImage {
  if (!category) return DEFAULT_IMAGE;
  return CATEGORY_IMAGES[category.toLowerCase()] ?? DEFAULT_IMAGE;
}

/** Return the image URL string for an editorial article by id, or a category fallback. */
export function getArticleImageUrl(
  id: number,
  category?: string | null,
): string {
  return ARTICLE_IMAGES[id]?.url ?? getBlogCategoryImage(category).url;
}
