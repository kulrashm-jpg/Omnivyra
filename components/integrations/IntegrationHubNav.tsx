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
    key: 'data_sources',
    label: 'Data Sources',
    href: '/integrations/data-sources',
    ready: true,
    description: 'Prospect discovery and import sources',
  },
  {
    key: 'enrichment',
    label: 'Enrichment Providers',
    href: '/integrations/data-sources#enrichment',
    ready: false,
    description: 'Attribute enrichment — planned',
  },
  {
    key: 'outreach',
    label: 'Outreach Connections',
    href: '#',
    ready: false,
    description: 'Email, SMS and social delivery — planned',
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
