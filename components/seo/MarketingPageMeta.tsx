/**
 * MarketingPageMeta — the canonical <Head> block for public marketing pages (OPT-006).
 *
 * One component owns the full SEO tag set so no marketing page can ship a
 * partial one again: title, description, canonical, og:*, twitter:*, optional
 * robots noindex and optional JSON-LD. URLs are built from lib/siteUrl.ts
 * (build-time constant — never window.location.origin; see DISC-004).
 *
 * `path` is the page's own route; `canonicalPath` overrides the canonical
 * target when the page canonicalizes elsewhere (e.g. /landing → '/').
 */

import Head from 'next/head';
import { SITE_URL } from '../../lib/siteUrl';

export interface MarketingPageMetaProps {
  title: string;
  description: string;
  /** Route path of this page, e.g. '/pricing'. */
  path: string;
  /** Canonical override when this page is a duplicate of another URL. */
  canonicalPath?: string;
  /** Absolute URL; defaults to the site logo (same as the homepage / OPT-014). */
  ogImage?: string;
  /** Thin/utility pages (thank-you, sample report) that must not be indexed. */
  noindex?: boolean;
  /** Optional structured data, emitted as application/ld+json. */
  jsonLd?: Record<string, unknown>;
}

/** Pure builder — unit-testable without rendering next/head. */
export function buildMarketingMeta(props: MarketingPageMetaProps): {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  robots: string | null;
  jsonLdText: string | null;
} {
  return {
    title: props.title,
    description: props.description,
    canonical: `${SITE_URL}${props.canonicalPath ?? props.path}`,
    ogImage: props.ogImage ?? `${SITE_URL}/logo.png`,
    robots: props.noindex ? 'noindex, nofollow' : null,
    jsonLdText: props.jsonLd ? JSON.stringify(props.jsonLd) : null,
  };
}

/** Build a schema.org FAQPage object from plain-text Q/A pairs. */
export function faqPageJsonLd(faqs: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export default function MarketingPageMeta(props: MarketingPageMetaProps) {
  const meta = buildMarketingMeta(props);
  return (
    <Head>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={meta.canonical} />
      {meta.robots && <meta name="robots" content={meta.robots} />}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Omnivyra" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={meta.canonical} />
      <meta property="og:image" content={meta.ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
      <meta name="twitter:image" content={meta.ogImage} />
      {meta.jsonLdText && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: meta.jsonLdText }} />
      )}
    </Head>
  );
}
