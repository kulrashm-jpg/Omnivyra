/**
 * Hardcoded Unsplash images for the About page. Use server-side only (getStaticProps, API route).
 * No API key required.
 */

export type AboutImage = {
  url: string;
  credit: string;
  userUrl: string;
  photoUrl: string;
};

const ARCHITECTURAL_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1280&q=80',
  credit: 'Denys Nevozhai',
  userUrl: 'https://unsplash.com/@dnevozhai',
  photoUrl: 'https://unsplash.com/photos/592deb58ef4e',
};

const SYSTEMS_IMAGE: AboutImage = {
  url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1280&q=80',
  credit: 'Luke Chesser',
  userUrl: 'https://unsplash.com/@lukechesser',
  photoUrl: 'https://unsplash.com/photos/black-and-gray-dashboard-displaying-graphs-and-charts-bebda4e38f71',
};

export async function getAboutImages(): Promise<{
  architectural: AboutImage | null;
  systems: AboutImage | null;
}> {
  return {
    architectural: ARCHITECTURAL_IMAGE,
    systems: SYSTEMS_IMAGE,
  };
}
