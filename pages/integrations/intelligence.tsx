import React from 'react';
import Link from 'next/link';
import IntegrationHubNav from '../../components/integrations/IntegrationHubNav';

/**
 * PHASE 1 — Intelligence, and it is READ-ONLY to tenants by design.
 *
 * ─── WHY A TENANT MAY LOOK BUT NOT TOUCH ──────────────────────────────────
 * The providers behind Omnivyra's intelligence are PLATFORM-OWNED: Omnivyra
 * holds the subscriptions, pays the invoices and governs the spend, quota and
 * retry behaviour centrally. A tenant has no credential to supply and no cost to
 * authorise, so there is nothing here to configure — and exposing an editable
 * field would imply otherwise. This page therefore explains the model and
 * renders no form, no key field and no connect action.
 *
 * ─── IT NEEDS NO TENANT, AND THAT IS NOT A LOOPHOLE ───────────────────────
 * This is the one case the frozen record allows a hub page to render without a
 * selected company: genuinely platform-owned, read-only content. No tenant-owned
 * configuration appears, so there is nothing to fail closed about. Every page
 * that DOES touch tenant configuration goes through `LeadSourcesSection`.
 *
 * ─── NO PROVIDER LIST IS RESTATED HERE ────────────────────────────────────
 * `PROVIDER_CATALOG` is the authority on which intelligence providers exist and
 * what governs them. Copying its 15 entries into a page would create a second
 * list to keep in step, and the first drift would be invisible. Phase 2 owns the
 * capability model that will let this page render that authority properly;
 * Phase 1 states the MODEL and points at the existing surface rather than
 * duplicating data it cannot yet render truthfully.
 *
 * ─── MARKETPULSE STAYS WHERE IT BELONGS ───────────────────────────────────
 * MarketPulse is intelligence about YOUR market. It is not a prospect source and
 * not an enrichment provider: the backend types it as tenant-market intelligence
 * and it is structurally incapable of reaching company attributes, with a test
 * pinning that no account attribute can be sourced from it. It is named here so
 * the boundary is visible in the product, not only in the code.
 */

export default function IntelligenceProvidersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Intelligence</h1>
          <p className="mt-1 text-sm text-gray-500">
            The data and model providers behind Omnivyra&apos;s intelligence. These are run by
            Omnivyra, not configured by you.
          </p>
        </div>

        <IntegrationHubNav active="intelligence" />

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>
            <strong className="font-semibold text-gray-900">Read only.</strong>{' '}
            Omnivyra holds these subscriptions and governs their usage, quota and cost centrally.
            There is no credential for you to supply and nothing for you to switch on, which is why
            this page has no connect action.
          </p>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Platform-owned providers</h2>
          <ul className="space-y-2">
            <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">Language models, search, backlink,
                  analytics and reputation providers</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  Platform-owned
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Governed centrally for spend, quota, timeout and retry. Most are disabled by default
                and are enabled per capability rather than per company. Platform administrators
                manage these under{' '}
                <Link href="/external-apis" className="font-medium text-indigo-700 hover:text-indigo-900">
                  API Integrations
                </Link>
                .
              </p>
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Your market intelligence</h2>
          <ul className="space-y-2">
            <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">MarketPulse</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  Available
                </span>
                <span className="text-xs text-gray-400">Tenant-market intelligence</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Intelligence about <strong className="font-semibold text-gray-700">your own
                market</strong> — not about individual companies you might sell to. It is not a
                prospect source and not an enrichment provider, and it needs no configuration.
              </p>
              <Link
                href="/market-pulse"
                className="mt-2 inline-block text-sm font-medium text-indigo-700 hover:text-indigo-900"
              >
                Open Market Pulse
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
