import React from 'react';
import Link from 'next/link';

/**
 * PHASE-1A — the Company Admin integration hub navigation.
 *
 * One nav shared by every integration area, so the hub has a single spine
 * instead of each area being its own island. It is deliberately a link list and
 * nothing else: it holds no state, fetches nothing, and knows nothing about
 * credentials.
 *
 * ─── AREAS ARE MARKED HONESTLY ────────────────────────────────────────────
 * `ready: false` renders a disabled item labelled "Planned" rather than a link
 * to an empty page. A nav that offers a destination which cannot do anything is
 * worse than one that says the work has not been done — the operator clicks,
 * finds nothing, and stops trusting the rest of the hub.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PHASE 1 — THIS IS NOW THE CANONICAL NAVIGATION SPINE
 * ══════════════════════════════════════════════════════════════════════════
 * The frozen decision record names five sections beside the pre-existing API
 * area. Each is a real destination that states its own true state, which is why
 * they are `ready: true` even where the capability behind them is not
 * operational: the page tells the operator what is and is not possible, and that
 * is a destination worth reaching. `ready: false` stays reserved for an area
 * with no page at all.
 *
 * ─── "DATA SOURCES" IS GONE AS A PRODUCT TERM ─────────────────────────────
 * The canonical term is PROSPECT SOURCE. The old label is removed here; the old
 * URL is NOT. `/integrations/data-sources` remains valid and redirects to
 * `/integrations/prospect-sources`, because retiring a word must not break a
 * bookmark.
 *
 * ─── ENRICHMENT IS A REAL DESTINATION NOW ─────────────────────────────────
 * It was a disabled "Planned" label pointing at `#enrichment`, which was honest
 * when no enrichment surface existed. The tenant provider-credential surface
 * does exist — it was only reachable as a tab on `/social-platforms` — so the
 * nav now links to it rather than denying it.
 *
 * ─── SOCIAL PLATFORMS IS LINKED, NOT ABSORBED ─────────────────────────────
 * `/social-platforms` keeps its route, its OAuth/token architecture and its
 * tabs. The hub points at it rather than re-hosting it: nothing about that
 * surface is improved by moving it, and much could break.
 */

export interface IntegrationHubArea {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly ready: boolean;
  readonly description: string;
}

export const INTEGRATION_HUB_AREAS: readonly IntegrationHubArea[] = Object.freeze([
  {
    key: 'api',
    label: 'API Integrations',
    href: '/external-apis',
    ready: true,
    description: 'Publishing, website and API connections',
  },
  {
    key: 'prospect_sources',
    label: 'Prospect Sources',
    href: '/integrations/prospect-sources',
    ready: true,
    description: 'Where prospect records come from — import and discovery',
  },
  {
    key: 'enrichment',
    label: 'Enrichment Providers',
    href: '/integrations/enrichment',
    ready: true,
    description: 'Attribute enrichment — your own provider subscriptions',
  },
  {
    key: 'social',
    label: 'Social Platforms',
    href: '/social-platforms',
    ready: true,
    description: 'Publishing and engagement networks',
  },
  {
    key: 'outreach',
    label: 'Engagement & Outreach',
    href: '/integrations/outreach',
    ready: true,
    description: 'Delivery channels and their current state',
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    href: '/integrations/intelligence',
    ready: true,
    description: 'Platform-owned intelligence providers — read only',
  },
]);

export default function IntegrationHubNav({ active }: { active: string }) {
  return (
    <nav aria-label="Integration areas" className="mb-6 border-b border-gray-200">
      <ul className="flex flex-wrap gap-1">
        {INTEGRATION_HUB_AREAS.map((area) => {
          const isActive = area.key === active;
          const base = 'inline-block rounded-t-lg px-4 py-2 text-sm font-medium transition-colors';

          if (!area.ready) {
            return (
              <li key={area.key}>
                <span
                  aria-disabled="true"
                  title={area.description}
                  className={`${base} cursor-not-allowed text-gray-400`}
                >
                  {area.label}
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                    Planned
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={area.key}>
              <Link
                href={area.href}
                title={area.description}
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? `${base} border-b-2 border-indigo-600 text-indigo-700`
                    : `${base} text-gray-600 hover:text-gray-900`
                }
              >
                {area.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
