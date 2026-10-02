/**
 * WP-9 / PO-3 — the React presentation of publicly observed advertising.
 *
 * ─── WHAT THIS IS AND IS NOT ──────────────────────────────────────────────
 * This is a RENDERER. Every decision about what may be claimed was made upstream: the composer
 * partitioned advertisers into `companyAdvertisers` / `otherAdvertisers` behind a single ownership
 * gate, and `publicAdvertisingView.ts` translated the resolver's internal states into customer
 * language. Nothing here re-derives ownership, and nothing here reads a raw resolution state.
 *
 * The wording and the guards are taken from the HTML export
 * (`backend/services/intelligence/exportRendererReport1.ts` -> `renderPublicAdvertising`), which
 * is the authority on both. Two guarantees it makes and this component must keep:
 *
 *   1. An unread public surface is never rendered as "the company does not advertise". The
 *      unavailable state says so explicitly.
 *   2. Internal state names never reach the page. The view model maps them; this file only ever
 *      prints the mapped label.
 *
 * It also renders NO performance figures — spend, CTR, ROAS, CAC, impressions do not exist in the
 * public transparency record and are not invented here. The only quantities shown are the
 * provider's own rounded labels and the number of advertiser accounts examined.
 */

import React from 'react';
import type { ReportViewAdvertising } from '@/pages/api/reports/reportViewPayloadTypes';
import {
  buildPublicAdvertisingView,
  type AdvertiserView,
  type PublicAdvertisingView,
} from './publicAdvertisingView';

const EVIDENCE_TONE_CLASS: Record<string, string> = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  probable: 'border-amber-200 bg-amber-50 text-amber-800',
  neutral: 'border-slate-300 bg-slate-100 text-slate-700',
  muted: 'border-slate-200 bg-slate-50 text-slate-500',
};

const FRESHNESS_TONE_CLASS: Record<string, string> = {
  fresh: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  recent: 'border-sky-200 bg-sky-50 text-sky-800',
  ageing: 'border-amber-200 bg-amber-50 text-amber-800',
  unknown: 'border-slate-200 bg-slate-50 text-slate-500',
};

const ADVERTISER_IDENTITY_LABEL: Record<string, string> = {
  provider_verified: 'Provider-verified identity',
  unverified: 'Identity not provider-verified',
  ambiguous: 'Provider flags similarly named accounts',
};

function Chip(props: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  attrs?: Record<string, string>;
}) {
  return (
    <span
      data-testid={props.testId}
      {...(props.attrs ?? {})}
      className={
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ' +
        (props.className ?? 'border-slate-200 bg-slate-50 text-slate-600')
      }
    >
      {props.children}
    </span>
  );
}

function AdvertiserCard(props: { advertiser: AdvertiserView }) {
  const a = props.advertiser;
  return (
    <div
      data-testid="advertising-advertiser"
      data-evidence-state={a.evidence.state}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{a.displayName}</p>
        <Chip
          testId="advertising-evidence-chip"
          attrs={{ 'data-evidence-state': a.evidence.state, 'data-tone': a.evidence.tone }}
          className={EVIDENCE_TONE_CLASS[a.evidence.tone]}
        >
          {a.evidence.label}
        </Chip>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip
          testId="advertising-advertiser-identity"
          attrs={{ 'data-identity-state': a.identityState }}
          className={
            a.identityState === 'provider_verified'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : a.identityState === 'ambiguous'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
          }
        >
          {ADVERTISER_IDENTITY_LABEL[a.identityState]}
        </Chip>
        {a.basedIn ? (
          <Chip testId="advertising-advertiser-location">Stated location: {a.basedIn}</Chip>
        ) : null}
      </div>

      {/* Rendered only for advertisers resolved to the company — the view model refuses to carry
          it for anyone else, so an ad count can never sit beside an unattributed advertiser. */}
      {a.adCountLabel ? (
        <p data-testid="advertising-advertiser-ad-count" className="mt-2 text-sm text-slate-800">
          {a.adCountLabel} observed for this advertiser.
        </p>
      ) : null}

      {a.evidence.meaning ? (
        <p className="mt-2 text-sm text-slate-600">{a.evidence.meaning}</p>
      ) : null}
      {a.basis ? <p className="mt-1 text-sm text-slate-600">{a.basis}</p> : null}

      <p className="mt-2 text-xs text-slate-500">
        {a.advertiserId}
        {a.creativeCount > 0
          ? ' · ' + String(a.creativeCount) + ' creatives observed on the first page'
          : ''}
      </p>
      {a.profileUrl ? (
        <a
          href={a.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs font-medium text-blue-600 underline"
        >
          View the public advertiser profile
        </a>
      ) : null}
    </div>
  );
}

function OwnershipStatement(props: { view: PublicAdvertisingView }) {
  const { ownership, geography, freshness } = props.view;

  if (ownership.kind === 'company_advertisers_found') return null;

  if (ownership.kind === 'ownership_not_establishable') {
    return (
      <p
        data-testid="advertising-ownership"
        data-ownership="ownership_not_establishable"
        className="mt-3 text-sm leading-relaxed text-slate-800"
      >
        Ownership could not be established: your website does not publish a legal name
        (<code className="rounded bg-slate-100 px-1">Organization.legalName</code>), so an
        advertiser could not be confirmed as yours even where one exists. Publishing it would let
        this check resolve.
      </p>
    );
  }

  const where = geography.searchVantage ? ', searched from ' + geography.searchVantage : '';
  const when = freshness.observedOnLabel ? ' on ' + freshness.observedOnLabel : '';

  return (
    <p
      data-testid="advertising-ownership"
      data-ownership="none_found_with_declared_name"
      className="mt-3 text-sm leading-relaxed text-slate-800"
    >
      No advertiser matching{' '}
      <strong className="font-semibold">{ownership.subjectLegalName}</strong> was found in the
      public ad record{where}
      {when} in a signed-out view. Some ad types are withheld from signed-out viewers, so this is
      what the public record shows rather than a complete account of your advertising.
    </p>
  );
}

export type PublicAdvertisingSectionProps = {
  advertising: ReportViewAdvertising | null | undefined;
  /** Injectable clock so the observation-age state is deterministic under test. */
  now?: Date;
  id?: string;
  className?: string;
};

export default function PublicAdvertisingSection(props: PublicAdvertisingSectionProps) {
  const view = buildPublicAdvertisingView(props.advertising, props.now ?? new Date());

  // No observation ⇒ render NOTHING. An empty section would itself assert that we looked.
  if (!view) return null;

  const header = (
    <header className="border-b border-slate-200 pb-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Evidence</p>
      <h2 className="mt-1 text-2xl font-bold text-slate-900">Public Advertising</h2>
      <p className="mt-1 text-sm text-slate-600">
        What does the public ad record show, and whose advertising is it?
      </p>
    </header>
  );

  if (view.sectionState === 'unavailable') {
    return (
      <section
        id={props.id ?? 'public-advertising'}
        data-testid="advertising-section"
        data-section-state="unavailable"
        className={
          props.className ??
          'print-section mb-12 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
        }
      >
        {header}
        <div
          data-testid="advertising-unavailable"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">
            The public ad record could not be read for this report
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">{view.unavailableReason}</p>
          {/* The guard sentence. It is not decoration: without it, a reader completes the
              sentence themselves and completes it wrongly. */}
          <p data-testid="advertising-not-an-absence-claim" className="mt-2 text-sm font-medium text-amber-900">
            This is not a finding that the company does not advertise.
          </p>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Source: {view.surface.sourceLabel}
          {view.freshness.observedOnLabel ? ' · attempted ' + view.freshness.observedOnLabel : ''}
          {view.geography.searchVantage ? ' · from ' + view.geography.searchVantage : ''}
        </p>
      </section>
    );
  }

  const hasCompany = view.companyAdvertisers.length > 0;
  const hasOthers = view.otherAdvertisers.length > 0;

  return (
    <section
      id={props.id ?? 'public-advertising'}
      data-testid="advertising-section"
      data-section-state="observed"
      className={
        props.className ??
        'print-section mb-12 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
      }
    >
      {header}

      {/* The observation's own conditions, each a distinct state a reader can act on. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip testId="advertising-surface" attrs={{ 'data-surface': 'ads_transparency' }}>
          {view.surface.sourceLabel}
        </Chip>
        <Chip
          testId="advertising-freshness"
          attrs={{ 'data-tone': view.freshness.tone }}
          className={FRESHNESS_TONE_CLASS[view.freshness.tone]}
        >
          {view.freshness.ageLabel}
          {view.freshness.observedOnLabel ? ' · ' + view.freshness.observedOnLabel : ''}
        </Chip>
        {view.geography.searchVantage ? (
          <Chip testId="advertising-vantage">Searched from {view.geography.searchVantage}</Chip>
        ) : null}
        <Chip
          testId="advertising-identity"
          attrs={{ 'data-identity-state': view.identityState }}
          className={
            view.identityState === 'legal_name_declared'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }
        >
          {view.identityState === 'legal_name_declared'
            ? 'Your legal name is published, so ownership is decidable'
            : 'Your website publishes no legal name, so ownership is not decidable'}
        </Chip>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-700">
        Observed by searching the public ad transparency record by advertiser name. An advertiser is
        reported as yours only where its provider-verified legal name matches the legal name your
        own website declares — ads merely pointing at your domain are not evidence that you placed
        them.
      </p>

      <OwnershipStatement view={view} />

      {hasCompany ? (
        <div data-testid="advertising-company-group" className="mt-6">
          <p className="text-sm font-semibold text-slate-900">Your advertising</p>
          <p className="mt-1 text-sm text-slate-600">
            Advertiser identity matched your publicly declared legal name against the provider&rsquo;s
            verified identity.
          </p>
          <div className="mt-3 grid gap-3">
            {view.companyAdvertisers.map((a) => (
              <AdvertiserCard key={a.key} advertiser={a} />
            ))}
          </div>
        </div>
      ) : null}

      {hasOthers ? (
        <div data-testid="advertising-other-group" className="mt-6">
          <p className="text-sm font-semibold text-slate-900">
            Other advertisers pointing at your domain
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Separate verified entities, or advertisers whose relationship to you could not be
            established
            {view.domainAdCountLabel
              ? ' — the public record shows ' +
                view.domainAdCountLabel +
                ' pointing at this domain in total, across all advertisers'
              : ''}
            . This is typically affiliate, reseller or partner activity, and it is not your
            advertising.
          </p>
          <div className="mt-3 grid gap-3">
            {view.otherAdvertisers.map((a) => (
              <AdvertiserCard key={a.key} advertiser={a} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Honest abstention, driven by the seam flags: these disappear on their own once the
          contract carries per-ad platform and delivery geography. */}
      {!view.surface.platformsAvailable || !view.geography.campaignScopeAvailable ? (
        <p data-testid="advertising-scope-limits" className="mt-5 text-xs leading-relaxed text-slate-500">
          {!view.surface.platformsAvailable && !view.geography.campaignScopeAvailable
            ? 'The ad platform behind each account and the geographic areas ads were delivered to are not part of the public record this report reads, so they are not stated here.'
            : !view.surface.platformsAvailable
              ? 'The ad platform behind each account is not part of the public record this report reads, so it is not stated here.'
              : 'The geographic areas ads were delivered to are not part of the public record this report reads, so they are not stated here.'}
          {view.geography.advertiserLocations.length > 0
            ? ' Locations shown are the advertisers’ own provider-stated home jurisdictions, not where their ads ran.'
            : ''}
        </p>
      ) : null}

      <p data-testid="advertising-provenance" className="mt-3 text-xs text-slate-500">
        Source: {view.surface.sourceLabel}
        {view.freshness.observedOnLabel ? ' · observed ' + view.freshness.observedOnLabel : ''}
        {view.geography.searchVantage ? ' · from ' + view.geography.searchVantage : ''}
        {' · signed-out public view · '}
        {String(view.advertiserAccountsDiscovered)} advertiser account
        {view.advertiserAccountsDiscovered === 1 ? '' : 's'} examined
      </p>
    </section>
  );
}
