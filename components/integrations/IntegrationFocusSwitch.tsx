import React from 'react';
import Link from 'next/link';

/**
 * Sub-navigation inside the "Website & Analytics" hub section (/integrations).
 *
 * The page has two views selected by `?focus=`: `website` (website registry, CMS
 * publishing, lead webhooks) and `data` (CRM, Google Analytics, Search Console,
 * imports). Before this switch the `data` view had no link anywhere in the app's
 * navigation; it was reachable only from report call-to-actions or by URL.
 * Pure link list: no state, no fetching.
 */
export const INTEGRATION_FOCUS_VIEWS = Object.freeze([
  { focus: 'website', label: 'Website & publishing', href: '/integrations?focus=website' },
  { focus: 'data', label: 'Analytics & data', href: '/integrations?focus=data' },
] as const);

export type IntegrationFocus = (typeof INTEGRATION_FOCUS_VIEWS)[number]['focus'];

export default function IntegrationFocusSwitch({ focus }: { focus: IntegrationFocus }) {
  return (
    <nav aria-label="Website and analytics views" className="mb-5 inline-flex rounded-lg border border-gray-200 bg-white p-1">
      {INTEGRATION_FOCUS_VIEWS.map((view) => {
        const active = view.focus === focus;
        return (
          <Link
            key={view.focus}
            href={view.href}
            aria-current={active ? 'true' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
