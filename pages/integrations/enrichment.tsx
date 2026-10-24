import React from 'react';
import Link from 'next/link';
import IntegrationHubNav from '../../components/integrations/IntegrationHubNav';
import LeadSourcesSection from '../../components/prospects/LeadSourcesSection';
import {
  buildCapabilityCards,
  credentialFormProviderIds,
  type ProviderCapabilityCard,
  type PresentationStatus,
} from '../../backend/services/integrations/providerCapabilityModel';

/**
 * PHASE 3 — Enrichment Providers: the existing capability, exposed truthfully.
 *
 * ─── THIS SURFACE IS A MIRROR, NOT A MOVE ─────────────────────────────────
 * The credential capability already existed; it was only reachable as the "Lead
 * Sources" tab of `/social-platforms`, a page advertised everywhere as SOCIAL
 * connection. Owner decision O-1 keeps that tab indefinitely as a
 * backward-compatible entry point, so this page is a second door to one room — it
 * does not build a second room.
 *
 * Everything load-bearing is reused unchanged:
 *   `LeadSourcesSection`  owns tenant selection, membership validation and the
 *                         remount-on-tenant-change behaviour. It is the reason an
 *                         Apollo key cannot be stored against the wrong company,
 *                         and that logic is NOT reimplemented here.
 *   `LeadSourcesPanel`    remains the only rendering and configuration component
 *                         for a provider credential.
 *   the A3P credential API remains the only write path.
 *   `ACQUISITION_SOURCES` remains the only provider vocabulary.
 *
 * This file contains no fetch, no tenant resolution, no provider list and no
 * credential handling. If it did, there would be two of each.
 *
 * ─── THE TWO HALVES OF THIS PAGE, AND WHY THEY ARE SEPARATE ───────────────
 * CONFIGURABLE providers get the real credential panel. PLANNED ones get a
 * read-only card with no action at all. Both halves are derived from the
 * capability model, so neither is a list someone must remember to update:
 *   • the panel's allowlist is `credentialFormProviderIds()`
 *   • the planned cards are every enrichment capability that is not connectable
 *
 * Owner decision O-2 lives in the model, once: the platform must accept a
 * credential AND something must be able to use it. ZoomInfo, Crunchbase and
 * RapidAPI satisfy the first and fail the second, so they appear below as
 * planned and receive no Connect, Execute, Test or Enrich affordance.
 *
 * ─── CONFIGURED IS NOT OPERATIONAL, AND NOTHING HERE BLURS IT ─────────────
 * `LeadSourcesPanel` renders `configured` and `operational` as separate facts
 * taken verbatim from the server, and the server reports `operational: false` for
 * every provider. Phase 3 makes NOTHING operational: no provider is called, no
 * adapter is touched, and no execution success is claimed. Apollo and Clearbit are
 * `implemented` and `executable` and **not operationally verified**, and the page
 * says exactly that rather than rounding it to "unavailable".
 */

/** Providers whose connect form may be offered — DERIVED, never listed. */
const ENRICHMENT_PROVIDER_IDS: readonly string[] = Object.freeze(credentialFormProviderIds());

/** Every enrichment capability the model declares, as cards. */
const ENRICHMENT_CARDS: readonly ProviderCapabilityCard[] = Object.freeze(
  buildCapabilityCards('enrichment'),
);

/** The implemented ones — described here, configured in the panel below. */
const CONFIGURABLE_CARDS = ENRICHMENT_CARDS.filter((c) => c.connectable);
/** The rest. Visible, truthful, and deliberately actionless. */
const PLANNED_CARDS = ENRICHMENT_CARDS.filter((c) => !c.connectable);

const STATUS_STYLE: Record<PresentationStatus, { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'bg-emerald-100 text-emerald-800' },
  not_operational: { label: 'Not operational', className: 'bg-amber-100 text-amber-800' },
  planned: { label: 'Planned', className: 'bg-gray-100 text-gray-600' },
  blocked: { label: 'Blocked', className: 'bg-amber-100 text-amber-800' },
  not_implemented: { label: 'Not implemented', className: 'bg-gray-100 text-gray-600' },
};

function CapabilityCard({ card }: { card: ProviderCapabilityCard }) {
  const style = STATUS_STYLE[card.status];
  return (
    <li
      data-testid={`enrichment-${card.providerId}`}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{card.label}</span>
        <span
          data-testid={`status-${card.providerId}-enrichment`}
          className={`rounded px-2 py-0.5 text-xs font-medium ${style.className}`}
        >
          {style.label}
        </span>
        <span className="text-xs text-gray-400">Enrichment</span>
      </div>

      {/* Three facts, never averaged into one word. */}
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">Capability:</dt>
          <dd>{card.implemented ? 'Implemented' : 'Not implemented'}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">Callable:</dt>
          <dd>{card.executable ? 'Yes' : 'No'}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">Runtime:</dt>
          <dd>{card.status === 'operational' ? 'Verified' : 'Not verified'}</dd>
        </div>
      </dl>

      {card.reason && (
        <p data-testid={`reason-${card.providerId}-enrichment`} className="mt-2 text-xs text-gray-400">
          {card.reason}
        </p>
      )}

      {card.action === 'none' && (
        <p data-testid={`noaction-${card.providerId}-enrichment`} className="mt-2 text-xs font-medium text-gray-400">
          No action available
        </p>
      )}
    </li>
  );
}

export default function EnrichmentProvidersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Enrichment Providers</h1>
          <p className="mt-1 text-sm text-gray-500">
            Providers that add attributes to companies and people you already have. You supply your
            own subscription and your own key; the provider invoices you directly.
          </p>
        </div>

        <IntegrationHubNav active="enrichment" />

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>
            <strong className="font-semibold text-gray-900">Saving a key does not switch a
            provider on.</strong>{' '}
            Each provider below reports three separate things — whether the capability is built,
            whether you have configured it, and whether it has been verified against the provider. No
            enrichment provider is verified yet, so a stored key is preparation, not activation.
          </p>
          <p className="mt-2">
            Looking for where prospects come from?{' '}
            <Link
              href="/integrations/prospect-sources"
              className="font-medium text-indigo-700 hover:text-indigo-900"
            >
              Prospect Sources
            </Link>
            . Enrichment adds detail to records you already hold; it never finds new ones.
          </p>
        </div>

        {CONFIGURABLE_CARDS.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-1 text-base font-semibold text-gray-900">Available to configure</h2>
            <p className="mb-3 text-sm text-gray-500">
              These have a working adapter, so your key would actually be used.
            </p>
            <ul className="mb-4 space-y-2">
              {CONFIGURABLE_CARDS.map((card) => <CapabilityCard key={card.providerId} card={card} />)}
            </ul>

            {/*
              The existing tenant gate. It refuses to render the credential panel
              until a company has been chosen, and names the company it is
              configuring — which is the whole reason it exists.
            */}
            <LeadSourcesSection providerIds={ENRICHMENT_PROVIDER_IDS} />
          </section>
        )}

        {PLANNED_CARDS.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-1 text-base font-semibold text-gray-900">Declared, not yet built</h2>
            <p className="mb-3 text-sm text-gray-500">
              A credential can technically be stored for these, and nothing could use it — so no
              connect action is offered. They are listed so the roadmap is visible, not so they look
              connectable.
            </p>
            <ul className="space-y-2">
              {PLANNED_CARDS.map((card) => <CapabilityCard key={card.providerId} card={card} />)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
