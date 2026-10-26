import type { GetServerSideProps } from 'next';
import { SITEMAP_PATHS } from '../lib/seo/sitemapPaths';

const BASE_URL = 'https://www.omnivyra.com';

const URLS = SITEMAP_PATHS;

function buildSitemapXml() {
  const lastModified = new Date().toISOString();

  const urls = URLS.map((path) => {
    const loc = `${BASE_URL}${path}`;
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastModified}</lastmod>`,
      '  </url>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ].join('\n');
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'application/xml');
  res.write(buildSitemapXml());
  res.end();

  return {
    props: {},
  };
};

export default function SitemapXml() {
  return null;
}
