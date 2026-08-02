#!/usr/bin/env node
/**
 * OPT-006 — build-artifact metadata verification (OPT-014 style).
 *
 * Reads the prerendered HTML in .next/server/pages and asserts, per marketing
 * route, that the crawlable HTML actually contains the canonical/OG/Twitter
 * set (and robots/JSON-LD where declared). Run AFTER `next build`.
 *
 *   node scripts/verify-marketing-metadata.js
 */
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com';
const PAGES_DIR = path.join(process.cwd(), '.next', 'server', 'pages');

/** route file (without .html) → expectations */
const ROUTES = [
  { file: 'pricing', canonical: '/pricing', jsonLd: 'FAQPage', marker: 'Full platform access' },
  { file: 'about', canonical: '/about', marker: 'Omnivyra' },
  { file: 'features', canonical: '/features', marker: 'Omnivyra' },
  { file: 'help', canonical: '/help', jsonLd: 'FAQPage', marker: 'Help Center' },
  { file: 'solutions', canonical: '/solutions', marker: 'Solutions' },
  { file: 'privacy', canonical: '/privacy', marker: '2 August 2026' },
  { file: 'terms', canonical: '/terms', marker: '2 August 2026' },
  { file: 'data-deletion', canonical: '/data-deletion', marker: '2 August 2026' },
  { file: 'marketing-performance-analytics', canonical: '/marketing-performance-analytics' },
  { file: 'funnel-and-conversion-analysis', canonical: '/funnel-and-conversion-analysis' },
  { file: 'audit/website-growth-check', canonical: '/audit/website-growth-check' },
  { file: 'audit/lead-generation-check', canonical: '/audit/lead-generation-check' },
  { file: 'audit/campaign-conversion-check', canonical: '/audit/campaign-conversion-check' },
  { file: 'free-audit/start', canonical: '/free-audit/start' },
  { file: 'free-audit/report', canonical: '/free-audit/report', robots: 'noindex, nofollow' },
  { file: 'request-demo', canonical: '/request-demo' },
  { file: 'contact-sales', canonical: '/contact-sales' },
  { file: 'book-consultation', canonical: '/book-consultation' },
  { file: 'talk-to-expert', canonical: '/talk-to-expert' },
  { file: 'thank-you', canonical: '/thank-you', robots: 'noindex, nofollow' },
  { file: 'get-free-credits', canonical: '/get-free-credits' },
  // /landing canonicalizes to the homepage (duplicate-content fix)
  { file: 'landing', canonical: '/', jsonLd: 'FAQPage' },
  // Phase B — blog ISR: real post links and metadata in the crawlable HTML
  { file: 'blog', canonical: '/blog', markerAny: ['/blog/', 'No public intelligence notes'] },
];

let failures = 0;
let checks = 0;

function assert(route, cond, label) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`  FAIL  [${route}] ${label}`);
  }
}

for (const r of ROUTES) {
  const file = path.join(PAGES_DIR, `${r.file}.html`);
  if (!fs.existsSync(file)) {
    failures += 1;
    console.error(`  FAIL  [${r.file}] prerendered HTML missing at ${file}`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  // Next 16 emits <title data-next-head=""> — allow attributes.
  assert(r.file, /<title[^>]*>[^<]+<\/title>/.test(html), 'title present');
  assert(r.file, html.includes('name="description"'), 'meta description present');
  assert(r.file, html.includes(`rel="canonical" href="${SITE_URL}${r.canonical}"`), `canonical ${SITE_URL}${r.canonical}`);
  assert(r.file, html.includes(`property="og:url" content="${SITE_URL}${r.canonical}"`), 'og:url matches canonical');
  assert(r.file, html.includes('property="og:title"'), 'og:title present');
  assert(r.file, html.includes('property="og:image"'), 'og:image present');
  assert(r.file, html.includes('name="twitter:card" content="summary_large_image"'), 'twitter:card present');
  assert(r.file, !/content="public[^"]*s-maxage/.test(html), 'no stray cache directives');
  if (r.robots) {
    assert(r.file, html.includes(`name="robots" content="${r.robots}"`), `robots ${r.robots}`);
  } else {
    assert(r.file, !html.includes('name="robots" content="noindex'), 'not accidentally noindexed');
  }
  if (r.jsonLd) {
    assert(r.file, html.includes('application/ld+json') && html.includes(r.jsonLd), `JSON-LD ${r.jsonLd}`);
  }
  if (r.marker) assert(r.file, html.includes(r.marker), `content marker "${r.marker}"`);
  if (r.markerAny) assert(r.file, r.markerAny.some((m) => html.includes(m)), `one of markers ${r.markerAny.join(' | ')}`);
}

// Blog article pages: verify at least one prebuilt slug page carries Article JSON-LD.
const blogDir = path.join(PAGES_DIR, 'blog');
if (fs.existsSync(blogDir)) {
  const slugPages = fs.readdirSync(blogDir).filter((f) => f.endsWith('.html'));
  if (slugPages.length > 0) {
    const sample = fs.readFileSync(path.join(blogDir, slugPages[0]), 'utf8');
    assert(`blog/${slugPages[0]}`, sample.includes('application/ld+json') && sample.includes('"Article"'), 'Article JSON-LD in crawlable HTML');
    assert(`blog/${slugPages[0]}`, sample.includes('rel="canonical"'), 'canonical in crawlable HTML');
    assert(`blog/${slugPages[0]}`, /<h1[^>]*>/.test(sample), 'article <h1> in crawlable HTML');
    console.log(`  info  blog: ${slugPages.length} article page(s) prebuilt; sampled ${slugPages[0]}`);
  } else {
    console.log('  info  blog: no article pages prebuilt (no published posts at build time) — fallback:blocking covers runtime');
  }
}

console.log(`\nverify-marketing-metadata: ${checks} checks, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
