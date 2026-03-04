/**
 * Fetches Unsplash images for the About page. Use server-side only (getStaticProps, API route).
 * Set UNSPLASH_ACCESS_KEY in .env.local. Get key: https://unsplash.com/developers
 */

type UnsplashPhoto = {
  id: string;
  urls: { regular: string; full: string };
  user: { name: string; username: string; links: { html: string } };
  links: { html: string };
};

type UnsplashSearchResult = {
  results: UnsplashPhoto[];
};

export type AboutImage = {
  url: string;
  credit: string;
  userUrl: string;
  photoUrl: string;
};

async function fetchOne(
  query: string,
  orientation: 'landscape' = 'landscape'
): Promise<AboutImage | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=${orientation}&client_id=${key}`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const data: UnsplashSearchResult = await res.json();
    const photo = data.results?.[0];
    if (!photo?.urls?.regular) return null;
    return {
      url: photo.urls.regular,
      credit: photo.user?.name || 'Unsplash',
      userUrl: photo.user?.links?.html || 'https://unsplash.com',
      photoUrl: photo.links?.html || 'https://unsplash.com',
    };
  } catch {
    return null;
  }
}

export async function getAboutImages(): Promise<{
  architectural: AboutImage | null;
  systems: AboutImage | null;
}> {
  const [architectural, systems] = await Promise.all([
    fetchOne('architecture blueprint abstract minimal'),
    fetchOne('network data structure systems abstract'),
  ]);
  return { architectural: architectural || null, systems: systems || null };
}
