import type { GetServerSideProps } from 'next';

/**
 * RETIRED 2026-11-13: the old "AI Content Generator" page.
 *
 * The page called no AI. "Generate Topics" and "Generate content" waited on a
 * setTimeout (2–3 s) and returned canned output. It had no navigation link and
 * showed a "DrishiQ" example in its placeholder (Omnivyra and Drishiq must never
 * mix in product UI). Coordinator ruling (e9): hide it before launch.
 *
 * The URL is kept as a redirect to the real content creation hub rather than
 * deleted, so an old bookmark lands somewhere useful. This matches the
 * repository's shape for a moved surface (pages/integrations/data-sources.tsx).
 */
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/command-center/content',
    // Temporary on purpose: a permanent redirect is cached by browsers and would
    // outlive a later decision to give this URL its own meaning again.
    permanent: false,
  },
});

/** Never rendered: `getServerSideProps` always redirects. */
export default function AiContentGeneratorRedirect() {
  return null;
}
