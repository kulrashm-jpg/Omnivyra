/**
 * ONBOARD-001 §3/§7 — website metadata extractor (pure).
 */
import {
  extractWebsiteMetadata,
  hasDiscoveredSignal,
} from '../../services/companyProfile/websiteMetadataExtractor';

const BASE = 'https://acme.com';

describe('ONBOARD-001 §3 — extractWebsiteMetadata', () => {
  test('extracts OG, description, favicon, logo, lang, country, brand colour, keywords', () => {
    const html = `
      <html lang="en-US">
        <head>
          <title>Acme Inc — Widgets</title>
          <meta name="description" content="We make the best widgets.">
          <meta property="og:site_name" content="Acme Inc">
          <meta property="og:description" content="OG desc">
          <meta property="og:image" content="/brand/logo.png">
          <meta property="og:locale" content="en_US">
          <meta name="theme-color" content="#0A66C2">
          <meta name="keywords" content="widgets, gadgets, tools">
          <link rel="icon" href="/favicon.png">
          <link rel="apple-touch-icon" href="/touch.png">
        </head>
      </html>`;
    const meta = extractWebsiteMetadata(html, BASE);

    expect(meta.title).toBe('Acme Inc — Widgets');
    expect(meta.description).toBe('We make the best widgets.'); // meta description wins (first)
    expect(meta.siteName).toBe('Acme Inc');
    expect(meta.logoUrl).toBe('https://acme.com/brand/logo.png');   // og:image absolutized
    expect(meta.faviconUrl).toBe('https://acme.com/favicon.png');
    expect(meta.language).toBe('en');
    expect(meta.country).toBe('US');
    expect(meta.brandColor).toBe('#0A66C2');
    expect(meta.keywords).toEqual(['widgets', 'gadgets', 'tools']);
    expect(meta.openGraph.site_name).toBe('Acme Inc');
    expect(hasDiscoveredSignal(meta)).toBe(true);
  });

  test('favicon falls back to /favicon.ico; logo falls back to apple-touch-icon', () => {
    const meta = extractWebsiteMetadata('<html><head><link rel="apple-touch-icon" href="/t.png"></head></html>', BASE);
    expect(meta.faviconUrl).toBe('https://acme.com/favicon.ico');
    expect(meta.logoUrl).toBe('https://acme.com/t.png');
  });

  test('derives country from html lang region when no og:locale', () => {
    const meta = extractWebsiteMetadata('<html lang="fr-FR"></html>', BASE);
    expect(meta.language).toBe('fr');
    expect(meta.country).toBe('FR');
  });

  test('empty / malformed HTML never throws and reports no signal (favicon fallback aside)', () => {
    const empty = extractWebsiteMetadata('', BASE);
    expect(empty.title).toBeNull();
    expect(hasDiscoveredSignal(empty)).toBe(false);
    expect(() => extractWebsiteMetadata('<meta content=', BASE)).not.toThrow();
  });
});
