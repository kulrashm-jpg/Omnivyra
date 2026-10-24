import React from 'react';
import Link from 'next/link';
import IntegrationHubNav from '../../components/integrations/IntegrationHubNav';
import {
  buildCapabilityCard,
  type ProviderCapabilityCard,
  type PresentationStatus,
} from '../../backend/services/integrations/providerCapabilityModel';

/**
 * PHASE 3 — Prospect Sources as an operator-facing capability surface.
 *
 * ─── EVERY STATE IS DERIVED. NONE IS WRITTEN HERE. ────────────────────────
 * Each row is a `ProviderCapabilityCard` built by the canonical capability
 * model, so this page cannot claim a capability the model does not declare and
 * cannot drift from it. What stays local is presentation: which rows to show,
 * their wording, and where a link goes.
 *
 * The imported module is a pure constants file with no imports of its own — no
 * I/O, no database, no credential — which is why consuming it here is
 * composition rather than a server/client boundary violation. This page fetches
 * nothing and configures nothing.
 *
 * ─── FIVE STATUSES, NOT ONE "AVAILABLE" FLAG ──────────────────────────────
 * `operational`, `not_operational`, `planned`, `blocked` and `not_implemented`
 * are five different messages to an operator and are rendered as five. Collapsing
 * them is what the retired `available` boolean did.
 *
 * ─── WHY NO CONNECT BUTTON APPEARS ON THIS PAGE AT ALL ────────────────────
 * Not one discovery capability in the model is connectable: no provider can
 * originate a prospect, so a key stored here would buy nothing. `card.action` is
 * `none` for every row below, and that is derived rather than decided here — the
 * page renders whatever action the model permits, which today is none.
 *
 * Apollo is shown under Discovery as PLANNED and links across to Enrichment,
 * where its credential genuinely is useful. One provider, two capabilities, one
 * credential identity.
 *
 * MarketPulse is absent BY DESIGN: it is tenant-market intelligence, never
 * external-company prospect data, and the model has no entry for it.
 */

/** A row: a card from the model, plus this page's presentation. */
interface SourceRow {
  readonly card: ProviderCapabilityCard;
  /** How records arrive. Presentation — the model has no opinion on wording. */
  readonly method: string;
  readonly note: string;
  readonly href?: string;
  readonly hrefLabel?: string;
}

const STATUS_STYLE: Record<PresentationStatus, { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'bg-emerald-100 text-emerald-800' },
  not_operational: { label: 'Not operational', className: 'bg-amber-100 text-amber-800' },
  planned: { label: 'Planned', className: 'bg-gray-100 text-gray-600' },
  blocked: { label: 'Blocked', className: 'bg-amber-100 text-amber-800' },
  not_implemented: { label: 'Not implemented', className: 'bg-gray-100 text-gray-600' },
};

/** `null` is impossible for a pair the model declares; the filter proves it to TypeScript. */
const row = (
  providerId: string,
  capability: 'acquisition' | 'discovery',
  presentation: Omit<SourceRow, 'card'>,
): SourceRow | null => {
  const card = buildCapabilityCard(providerId, capability);
  return card ? { card, ...presentation } : null;
};

const isRow = (r: SourceRow | null): r is SourceRow => r !== null;

/**
 * Operator-supplied sources. Released, operational, and needing no credential.
 *
 * NO UI WORKFLOW EXISTS for any of the three: they are reachable only through
 * their governed ingestion API. Rather than link somewhere that implies an import
 * screen, each row says so — a link to a page that cannot import anything would
 * be the misleading affordance this surface is meant to remove.
 */
const IMPORT_ROWS: readonly SourceRow[] = Object.freeze([
  row('manual', 'acquisition', {
    method: 'Operator-entered',
    note: 'Records entered one at a time. No credential, and no provider is contacted. Reachable through the governed ingestion API; no operator screen exists yet.',
  }),
  row('csv', 'acquisition', {
    method: 'File-imported',
    note: 'Spreadsheet rows parsed in your browser — the file never reaches the server. Reachable through the governed ingestion API; no operator screen exists yet.',
  }),
  row('crm', 'acquisition', {
    method: 'Operator-supplied',
    note: 'A namespace for records you supply, not a connection to a CRM — no provider is contacted. Reachable through the governed ingestion API; no operator screen exists yet.',
  }),
].filter(isRow));

/**
 * Providers that would ORIGINATE prospects. None can today.
 *
 * "Discovery" means a provider returning a person or company Omnivyra does not
 * already hold — a different capability from enrichment, and one no adapter in
 * this repository implements.
 */
const DISCOVERY_ROWS: readonly SourceRow[] = Object.freeze([
  row('apollo', 'discovery', {
    method: 'Provider discovery',
    // PHASE 4 — discovery is implemented and callable. It has never been run
    // against the provider, which is what "Not operational" says.
    note: 'Implemented and callable with your own Apollo key — the SAME key Apollo enrichment uses, because one provider has one credential. Not yet verified against the provider.',
    href: '/integrations/enrichment',
    hrefLabel: 'Configure Apollo key',
  }),
  row('linkedin_sales_navigator', 'discovery', {
    method: 'Provider discovery',
    note: 'Existing LinkedIn support covers publishing and engagement — a different capability, and connecting it socially confers no discovery.',
    href: '/social-platforms',
    hrefLabel: 'Social Platforms',
  }),
  row('zoominfo', 'discovery', {
    method: 'Provider discovery',
    note: 'A credential can technically be stored, but nothing could use it, so no connect action is offered.',
  }),
  row('crunchbase', 'discovery', {
    method: 'Provider discovery',
    note: 'A credential can technically be stored, but nothing could use it, so no connect action is offered.',
  }),
].filter(isRow));

function CapabilityRow({ item }: { item: SourceRow }) {
  const { card } = item;
  const style = STATUS_STYLE[card.status];
  return (
    <li
      data-testid={`source-${card.providerId}-${card.capability}`}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{card.label}</span>
          <span
            data-testid={`status-${card.providerId}-${card.capability}`}
            className={`rounded px-2 py-0.5 text-xs font-medium ${style.className}`}
          >
            {style.label}
          </span>
          <span className="text-xs text-gray-400">{item.method}</span>
        </div>

        <p className="mt-1 text-sm text-gray-500">{item.note}</p>

        {/* The three facts kept apart, because they are three facts. */}
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Capability:</dt>
            <dd>{card.implemented ? 'Implemented' : 'Not implemented'}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Configuration:</dt>
            <dd data-testid={`credential-${card.providerId}-${card.capability}`}>
              {card.credentialState === 'not_applicable' ? 'Not required' : 'Not configured here'}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Runtime:</dt>
            <dd>{card.status === 'operational' ? 'Verified' : 'Not verified'}</dd>
          </div>
        </dl>

        {card.reason && (
          <p data-testid={`reason-${card.providerId}-${card.capability}`} className="mt-2 text-xs text-gray-400">
            {card.reason}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {/*
          Rendered from `card.action`, never from a local decision. No discovery
          capability is connectable, so no row here produces a button — and if one
          ever became connectable this would start offering it without an edit.
        */}
        {card.action === 'configure' ? (
          /*
            One provider holds ONE credential, so a connectable capability points
            at the single credential surface rather than growing a second form.
            The label names what is being configured — a bare "Configure" beside a
            discovery row would read as though discovery had its own key.
          */
          <Link
            href={item.href ?? '/integrations/enrichment'}
            data-testid={`action-${card.providerId}-${card.capability}`}
            className="inline-block rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {item.hrefLabel ?? 'Configure'}
          </Link>
        ) : item.href ? (
          <Link href={item.href} className="text-sm font-medium text-indigo-700 hover:text-indigo-900">
            {item.hrefLabel ?? 'Open'}
          </Link>
        ) : (
          <span data-testid={`noaction-${card.providerId}-${card.capability}`} className="text-xs text-gray-400">
            No action available
          </span>
        )}
      </div>
    </li>
  );
}

export default function ProspectSourcesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Prospect Sources</h1>
          <p className="mt-1 text-sm text-gray-500">
            Where prospect records come from. Each row shows three separate things: whether the
            capability is built, whether it is configured, and whether it has been verified against
            the provider.
          </p>
        </div>

        <IntegrationHubNav active="prospect_sources" />

        <section id="import" className="mb-8">
          <h2 className="mb-1 text-base font-semibold text-gray-900">Import &amp; manual entry</h2>
          <p className="mb-3 text-sm text-gray-500">
            Released and operational for every company. No provider credential is involved.
          </p>
          <ul className="space-y-2">
            {IMPORT_ROWS.map((item) => (
              <CapabilityRow key={`${item.card.providerId}-${item.card.capability}`} item={item} />
            ))}
          </ul>
        </section>

        <section id="discovery" className="mb-8">
          <h2 className="mb-1 text-base font-semibold text-gray-900">Discovery providers</h2>
          <p className="mb-3 text-sm text-gray-500">
            A discovery provider would find prospects you do not already have.{' '}
            <strong className="font-semibold text-gray-700">None is implemented</strong>, so none can
            be connected here. Provider credentials that are useful today are under{' '}
            <Link href="/integrations/enrichment" className="font-medium text-indigo-700 hover:text-indigo-900">
              Enrichment Providers
            </Link>
            .
          </p>
          <ul className="space-y-2">
            {DISCOVERY_ROWS.map((item) => (
              <CapabilityRow key={`${item.card.providerId}-${item.card.capability}`} item={item} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
