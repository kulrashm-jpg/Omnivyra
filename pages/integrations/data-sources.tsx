import type { GetServerSideProps } from 'next';

/**
 * PHASE 1 — the retired Data Sources URL.
 *
 * ─── WHY THIS IS A REDIRECT AND NOT A PAGE ────────────────────────────────
 * "Data Sources" is retired as a product term; the canonical term is PROSPECT
 * SOURCE. The URL is NOT retired — it is linked from outside the codebase and
 * possibly bookmarked, so it keeps working and sends the operator to the
 * canonical surface.
 *
 * ─── WHAT THIS DELIBERATELY REMOVES ───────────────────────────────────────
 * The previous page read its tenant from `?company_id=` in the query string and
 * showed "No company selected. Open this page from the integrations hub." when
 * it was absent — which it always was, because the hub nav linked here without
 * one and nothing else in the repository linked here at all. The page was
 * therefore unreachable in a working state.
 *
 * The fix is not to start passing the parameter. `?company_id=` is NOT the
 * tenant-selection architecture: `CompanyContext` is, it is membership-
 * validating, and every other surface already uses it. Carrying a tenant id in
 * a URL would have made a second mechanism canonical by accident — so the query
 * behaviour is removed rather than repaired.
 *
 * ─── THE API IS UNTOUCHED ─────────────────────────────────────────────────
 * `GET /api/integrations/data-sources` still exists, is still read-only, still
 * takes a membership-verified `company_id`, and still serves the catalogue view.
 * Phase 2 owns whether and how that data is rendered under the new capability
 * model. Phase 1 changes the destination, not the data.
 *
 * A server-side redirect, matching `pages/settings/integrations.tsx` — the shape
 * this repository already uses for a moved surface.
 */
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/integrations/prospect-sources',
    // Temporary on purpose. A 308 is cached by browsers and would outlive a
    // later decision to give this URL its own meaning again.
    permanent: false,
  },
});

/** Never rendered — `getServerSideProps` always redirects. */
export default function DataSourcesRedirect() {
  return null;
}
