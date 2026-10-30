/**
 * WS-4E — the owned engagement identities of this organization.
 *
 * ─── WHAT THIS PANEL IS ───────────────────────────────────────────────────
 * The minimal company-admin surface over two already-shipped routes:
 *   · `GET  /api/prospect-identity/owned-identity-candidates` — the identities
 *     observed on this tenant's own threads that could be attested;
 *   · `GET/POST/DELETE /api/prospect-identity/owned-identities` — the registry
 *     of the ones that have been.
 * It adds no second API, no new capability and no logic of its own. Every
 * decision the surface shows was made by the server.
 *
 * ─── WHAT AN ATTESTATION IS, AND IS NOT ───────────────────────────────────
 * `attestedIdentityContract.ts` is explicit: an attestation is an authorized
 * administrator stating that one `(platform, platform_user_id)` pair belongs to
 * their own organization — a RECORD, not a proof — and an active one is
 * NEGATIVE EVIDENCE ONLY: "never admit this as a prospect's own statement".
 * So this panel implies no verdict about any person. It does not sort, badge,
 * rank, count up, aggregate or grade a candidate; the order on screen is the
 * order the server returned, and `messageCount` / `threadCount` are reproduced
 * as observation proof because that is what the server calls them.
 *
 * ─── WHY IT LIVES ON THE COMPANY-ADMIN SETTINGS PAGE ──────────────────────
 * `pages/settings/company-admin-access.tsx` is already the company-admin
 * governance page, and this is company-admin governance configuration. The
 * Integration Hub was the alternative and was rejected twice over: its
 * Enrichment tab gates on `requireExternalApiAccess` / `requireManage`, a
 * DIFFERENT authority axis from the `PROSPECT_INGEST` these routes require —
 * two authorities behind one surface misleads whoever reads it — and the hub's
 * canonical section list is asserted key-for-key by
 * `phase1IntegrationHub.dom.test.tsx`, so a seventh area is a contract change,
 * not a mount.
 *
 * The cost of that choice is stated plainly: the settings page is in no
 * navigation menu. `lib/routes/canonicalRegistry.ts` registers its path and two
 * Command Center readiness items link it as help; nothing else does. So this
 * panel is URL-reachable only, which is a real limitation of the mount rather
 * than a defect in it.
 *
 * ─── AUTHORIZATION HONESTY — LOAD-BEARING ─────────────────────────────────
 * `components/CompanyContext.tsx` derives `userRole` from the first entry of a
 * roles map and DEFAULTS AN EMPTY MAP TO `'COMPANY_ADMIN'`. The client role
 * check can therefore read "admin" for a principal the server would refuse. The
 * page's existing gate decides whether this panel RENDERS; it is never evidence
 * that anything is permitted. So no string here claims authorization: every
 * permission sentence the reader sees is produced from a status the SERVER
 * returned (401, 403), and the only authority that matters is the
 * `PROSPECT_INGEST` capability check inside each route.
 *
 * ─── THE CANDIDATE READ IS LAZY ───────────────────────────────────────────
 * `engagement_authors` has no tenant column; the candidate list is an
 * enumeration of third parties this tenant happened to talk to. Its SWR key
 * stays `null` until an administrator opens the picker, so the panel never
 * enumerates people nobody asked about.
 *
 * ─── ABSENCE IS NOT A ZERO, AND A FAILURE IS NEITHER ──────────────────────
 * Both routes fail CLOSED with a 503 rather than an empty 200, because "none
 * are attested" and "we could not read the registry" are different answers.
 * This panel keeps them different: the empty branch is reachable only from a
 * real 200 carrying `entries: []`, and a 503 says we could not look.
 *
 * ─── WHAT IS NEVER SHOWN ──────────────────────────────────────────────────
 * `display_name`, `username`, `profile_url`, `avatar_url`, raw payloads and
 * message content are not in either projection. This panel does not invent
 * them, and it renders `platformUserId` VERBATIM with its case intact, because
 * a profile URL path is case-significant.
 */

import React, { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { AlertCircle, ShieldCheck, Trash2, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';

const REGISTRY = '/api/prospect-identity/owned-identities';
const CANDIDATES = '/api/prospect-identity/owned-identity-candidates';

/** One attested identity, exactly the five fields the registry route projects. */
export interface OwnedIdentityEntryView {
  readonly id: string;
  readonly platform: string;
  /** VERBATIM, case preserved. */
  readonly platformUserId: string;
  readonly attestedAt: string | null;
  readonly attestedByUserId: string | null;
}

export interface OwnedIdentitiesResponse {
  readonly version?: string;
  readonly contract?: string;
  readonly entries?: readonly OwnedIdentityEntryView[];
  readonly state?: string;
}

/** One attestable identity, exactly the seven fields the candidate route projects. */
export interface OwnedIdentityCandidateView {
  readonly authorId: string;
  readonly platform: string;
  readonly platformUserId: string;
  readonly messageCount: number;
  readonly threadCount: number;
  readonly firstObservedAt: string | null;
  readonly lastObservedAt: string | null;
}

export interface OwnedIdentityCandidatesResponse {
  readonly version?: string;
  readonly contract?: string;
  /** The server's own prose for why the list reads as it does. Rendered verbatim. */
  readonly reason?: string | null;
  readonly candidates?: readonly OwnedIdentityCandidateView[];
  readonly excluded?: Readonly<Record<string, number>>;
}

interface FetchFailure { status: number; body: Record<string, unknown> | null }

/**
 * Non-2xx must reach SWR's `error`, never its `data`.
 *
 * A fetcher that only does `.then(r => r.json())` hands a 503 BODY back as
 * though it were a payload, and the panel then renders a failure as content —
 * which for these two routes means rendering "we could not read the registry"
 * as "this organization has attested nobody". That is precisely the confusion
 * the contract forbids, so the status is thrown and carried through.
 */
const readJson = async <T,>(url: string): Promise<T> => {
  const res = await apiFetch(url);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw { status: res.status, body } as FetchFailure;
  return (body ?? {}) as T;
};

/**
 * One sentence for the reader, from a status the SERVER chose.
 *
 * Shaped after `ProblemObservationsPanel.messageForObservations`, and it keeps
 * that function's two rules:
 *  · a 404 says "not available in this workspace", NEVER "no access". The
 *    registry answers an entry in another tenant identically to an absent one,
 *    deliberately, so the API is not a cross-tenant existence oracle; wording it
 *    as a permission problem would rebuild that oracle in the UI.
 *  · a 503 is "we could not look", never "there is nothing".
 * A dead network is also a 503 — `apiFetch` synthesises one — so the two are
 * told apart by the body's `error`, which only the routes themselves set.
 */
export function messageForOwnedIdentities(status: number, body: Record<string, unknown> | null): string {
  const code = typeof body?.error === 'string' ? body.error : null;

  if (status === 401) {
    return 'Your session has expired. Sign in again to administer owned engagement identities.';
  }
  if (status === 403) {
    return 'You do not have permission to administer this company’s owned engagement identities.';
  }
  if (status === 404) return 'That entry is not available in this workspace.';
  if (status === 503) {
    if (code === 'owned_identities_unavailable') {
      return 'The owned-identity registry could not be read. It has not been altered — only unread. Retry in a moment.';
    }
    if (code === 'owned_identity_candidates_unavailable') {
      return 'The identities observed in this workspace could not be read. They have not been altered — only unread. Retry in a moment.';
    }
    return 'Could not reach Omnivyra. Check your connection and retry.';
  }
  if (code === 'server_owned_field') {
    const fields = Array.isArray(body?.fields) ? body.fields.filter((f) => typeof f === 'string') : [];
    return fields.length > 0
      ? `Refused: the request named fields the server owns — ${fields.join(', ')}. Nothing was attested.`
      : 'Refused: the request named a field the server owns. Nothing was attested.';
  }
  if (typeof body?.detail === 'string' && body.detail.trim() !== '') return body.detail;
  if (code) return `The request was refused (${code}).`;
  return 'The request could not be completed. Please try again.';
}

/** An instant, or an em dash. Never a stand-in clock for an unknown time. */
const when = (iso: string | null): string => {
  if (iso === null || iso.trim() === '') return '—';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : iso;
};

/** The exclusion keys, named for a reader. Counts only — never an identity. */
const EXCLUSION_LABEL: Record<string, string> = {
  examined: 'Identities examined',
  identityBlank: 'No identity stored',
  anonymousFallback: 'Anonymous placeholder identity',
  extensionFallback: 'Per-message placeholder identity',
  identityNotAProfileUrl: 'Not a profile URL',
  platformNotAttestable: 'Platform cannot be attested here',
};

const SHELL = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';

export interface OwnedIdentitiesPanelProps {
  readonly companyId: string | null;
}

const OwnedIdentitiesPanel: React.FC<OwnedIdentitiesPanelProps> = ({ companyId }) => {
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState<
    { kind: 'recorded' | 'already' | 'revoked' | 'already-revoked'; text: string }
    | { kind: 'refused'; text: string }
    | null
  >(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const key = companyId ? `${REGISTRY}?companyId=${encodeURIComponent(companyId)}` : null;
  const { data, error, isLoading, mutate } = useSWR<OwnedIdentitiesResponse>(key, readJson);
  const retry = useCallback(() => { void mutate(); }, [mutate]);

  /**
   * LAZY ON PURPOSE — see the header. The key stays null until the picker is
   * opened, so an administrator who only wanted to read the registry never
   * causes an enumeration of the third parties this tenant has talked to.
   */
  const candidatesKey = picking && companyId
    ? `${CANDIDATES}?companyId=${encodeURIComponent(companyId)}`
    : null;
  const candidates = useSWR<OwnedIdentityCandidatesResponse>(candidatesKey, readJson);

  /**
   * A tenant change DISCARDS everything the previous tenant produced.
   *
   * Every string below — an entry, a candidate, a notice, a half-typed
   * statement, an open revoke confirmation — is a statement about ONE
   * organization and must not outlive it. `LeadSourcesPanel` learned this as
   * A7P-C16, where one render showed Company A's badges under Company B's name.
   */
  useEffect(() => {
    setPicking(false);
    setChosen(null);
    setConfirmed(false);
    setStatement('');
    setBusy(null);
    setRowError(null);
    setNotice(null);
    setConfirmRevoke(null);
    setRevokeReason('');
  }, [companyId]);

  /**
   * The attestation. ONE write, and the body is exactly three keys.
   *
   * Nothing about the identity is sent: the server re-resolves the candidate id
   * through the candidate path and reads `(platform, platform_user_id)` off the
   * stored author row. A body-supplied pair would let a session register an
   * arbitrary identity as organization-owned — and because an active
   * attestation suppresses evidence, that would be a way to silence a real
   * person's own words. Every server-owned field is a NAMED 400, so none is
   * sent, not even a `companyId` the query string already carries.
   */
  const attest = useCallback(async () => {
    if (!companyId || !chosen || !confirmed || busy) return;
    const basis = statement.trim();
    if (!basis) {
      // Pre-checked here so a blank basis costs no request at all.
      setRowError({ id: 'attest', message: 'State why this identity is your organization’s own before attesting.' });
      return;
    }
    setBusy('attest');
    setRowError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`${REGISTRY}?companyId=${encodeURIComponent(companyId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateAuthorId: chosen, statement: basis, confirmed: true }),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        // Nothing is announced as done. The server refused, so the panel says so.
        setNotice({ kind: 'refused', text: messageForOwnedIdentities(res.status, body) });
        return;
      }
      const replay = body?.alreadyActive === true;
      setNotice(replay
        ? { kind: 'already', text: 'Already attested — nothing changed.' }
        : { kind: 'recorded', text: 'Recorded. Messages from this identity will no longer be admitted as a prospect’s own statement.' });
      setChosen(null);
      setConfirmed(false);
      setStatement('');
      setPicking(false);
      await mutate();                   // the row comes back from the SERVER
    } catch {
      setNotice({ kind: 'refused', text: 'Nothing was attested — the request could not be sent.' });
    } finally {
      setBusy(null);
    }
  }, [companyId, chosen, confirmed, statement, busy, mutate]);

  /**
   * The revocation. By the registry row's OWN uuid, with a reason, and never by
   * the identity — a profile URL in a query string lands in an access log, a
   * proxy log and a browser history.
   */
  const revoke = useCallback(async (entryId: string) => {
    if (!companyId || busy) return;
    const reason = revokeReason.trim();
    if (!reason) {
      // Pre-checked: the route refuses a blank reason, and so does this panel,
      // before spending a request on it.
      setRowError({ id: entryId, message: 'Give a reason for the revocation — the route refuses a blank one.' });
      return;
    }
    setBusy(entryId);
    setRowError(null);
    setNotice(null);
    try {
      const url = `${REGISTRY}?companyId=${encodeURIComponent(companyId)}`
        + `&id=${encodeURIComponent(entryId)}&reason=${encodeURIComponent(reason)}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setRowError({ id: entryId, message: messageForOwnedIdentities(res.status, body) });
        return;
      }
      // `revoked: false` is a 200: the entry is already not active, which is
      // what was asked for. Reporting it as a failure would be wrong.
      setNotice(body?.revoked === true
        ? { kind: 'revoked', text: 'Revoked. This identity is no longer attested as this organization’s own.' }
        : { kind: 'already-revoked', text: 'Already revoked — nothing changed.' });
      setConfirmRevoke(null);
      setRevokeReason('');
      await mutate();
    } catch {
      setRowError({ id: entryId, message: 'Nothing was revoked — the request could not be sent.' });
    } finally {
      setBusy(null);
    }
  }, [companyId, busy, revokeReason, mutate]);

  const header = (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-900">Owned engagement identities</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Engagement identities an administrator has attested as this organization’s own. An
        attestation is a stated record, not a finding about a person: it stops messages from that
        identity being read as something a prospect said.
      </p>
    </div>
  );

  const noticeBlock = notice ? (
    <p
      role={notice.kind === 'refused' ? 'alert' : 'status'}
      data-testid={`owned-identities-notice-${notice.kind}`}
      className={notice.kind === 'refused'
        ? 'mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700'
        : 'mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800'}
    >
      {notice.text}
    </p>
  ) : null;

  // ── No tenant, no request. `key` and `candidatesKey` are both null here, and
  //    `attest` / `revoke` return early, so a request is structurally
  //    unreachable rather than merely unlikely.
  if (!companyId) {
    return (
      <section className={SHELL} data-testid="owned-identities">
        {header}
        <p data-testid="owned-identities-no-tenant" className="text-xs text-gray-500">
          Select a company to administer its owned engagement identities. An attestation is stored
          against one company only, so Omnivyra will not guess which one you mean.
        </p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className={SHELL} data-testid="owned-identities" aria-busy="true">
        {header}
        <div data-testid="owned-identities-loading" className="space-y-2">
          <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    const f = (error ?? null) as FetchFailure | null;
    const status = f && typeof f.status === 'number' ? f.status : null;

    // Its OWN branch. A 401 or 403 is the one place a permission sentence may
    // be shown, because the SERVER returned it — and retrying will not change
    // it, so no Retry is offered.
    if (status === 401 || status === 403) {
      return (
        <section className={SHELL} data-testid="owned-identities">
          {header}
          <div
            role="alert"
            data-testid="owned-identities-unauthorized"
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{messageForOwnedIdentities(status, f?.body ?? null)}</p>
          </div>
        </section>
      );
    }

    return (
      <section className={SHELL} data-testid="owned-identities">
        {header}
        <div
          role="alert"
          data-testid="owned-identities-error"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{status !== null
              ? messageForOwnedIdentities(status, f?.body ?? null)
              : 'The owned-identity registry could not be read. It has not been altered — only unread.'}</p>
            <button
              type="button"
              data-testid="owned-identities-retry"
              onClick={retry}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-2.5 py-1 font-medium text-red-700 hover:bg-red-100"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  const entries = data.entries ?? [];
  const candidateRows = candidates.data?.candidates ?? [];
  const candidateFailure = (candidates.error ?? null) as FetchFailure | null;
  const attestError = rowError?.id === 'attest' ? rowError.message : null;
  const attesting = busy === 'attest';

  /** The picker. Opened deliberately, and reading it writes nothing. */
  const picker = (
    <div data-testid="owned-identities-attest" className="mb-3 rounded-xl border border-gray-200 p-3">
      {!picking ? (
        <button
          type="button"
          data-testid="owned-identities-attest-open"
          onClick={() => { setPicking(true); setNotice(null); setRowError(null); }}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Attest an identity as this organization’s own
        </button>
      ) : (
        <div>
          <p className="text-xs text-gray-600">
            Choose one identity observed on this workspace’s own threads. Omnivyra reads the
            platform and the identity from the stored record, so there is nothing here to type.
          </p>

          {candidates.isLoading && (
            <p data-testid="owned-identities-candidates-loading" className="mt-2 text-xs text-gray-500" aria-busy="true">
              Reading observed identities…
            </p>
          )}

          {(candidateFailure || (!candidates.isLoading && !candidates.data)) && (
            <p role="alert" data-testid="owned-identities-candidates-error" className="mt-2 text-xs text-red-700">
              {candidateFailure && typeof candidateFailure.status === 'number'
                ? messageForOwnedIdentities(candidateFailure.status, candidateFailure.body)
                : 'The identities observed in this workspace could not be read. They have not been altered — only unread.'}
            </p>
          )}

          {candidates.data && candidateRows.length === 0 && (
            <div data-testid="owned-identities-candidates-none" className="mt-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
              {/* The server's own prose, verbatim. Emptiness here is never mute. */}
              <p data-testid="owned-identities-candidates-reason">{candidates.data.reason ?? ''}</p>
            </div>
          )}

          {candidates.data && candidateRows.length > 0 && (
            <>
              {candidates.data.reason ? (
                <p data-testid="owned-identities-candidates-reason" className="mt-2 text-xs text-gray-500">
                  {candidates.data.reason}
                </p>
              ) : null}
              {/*
                NO SORT, NO BADGE, NO INDEX. The order is the server's. Any
                re-ordering here would be this panel forming an opinion about
                people, which it has no basis to do.
              */}
              <ul data-testid="owned-identities-candidates" className="mt-2 space-y-1">
                {candidateRows.map((c) => (
                  <li key={c.authorId}>
                    <label
                      htmlFor={`owned-identity-candidate-${c.authorId}`}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2 text-xs"
                    >
                      <input
                        type="radio"
                        id={`owned-identity-candidate-${c.authorId}`}
                        name="owned-identity-candidate"
                        data-testid={`owned-identities-candidate-${c.authorId}`}
                        checked={chosen === c.authorId}
                        onChange={() => setChosen(c.authorId)}
                        className="mt-0.5"
                      />
                      <span>
                        {/* VERBATIM, case intact. */}
                        <span className="block font-mono text-gray-900" data-testid={`owned-identities-candidate-identity-${c.authorId}`}>
                          {c.platformUserId}
                        </span>
                        <span className="block text-gray-500">
                          {c.platform} · messages observed {c.messageCount} · threads {c.threadCount}
                        </span>
                        <span className="block text-gray-500">
                          observed {when(c.firstObservedAt)} to {when(c.lastObservedAt)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {candidates.data?.excluded && (
            <dl data-testid="owned-identities-excluded" className="mt-2 grid grid-cols-2 gap-x-3 text-xs text-gray-500">
              {Object.entries(candidates.data.excluded).map(([k, v]) => (
                <div key={k}>
                  <dt className="inline">{EXCLUSION_LABEL[k] ?? k}: </dt>
                  <dd className="inline" data-testid={`owned-identities-excluded-${k}`}>{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-700" htmlFor="owned-identity-statement">
              Why this identity is your organization’s own
            </label>
            <textarea
              id="owned-identity-statement"
              data-testid="owned-identities-statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              placeholder="e.g. this is our support account on this platform"
            />
          </div>

          {/*
            EXPLICIT CONFIRMATION. The route refuses anything but `confirmed:
            true`, and for the same reason this panel will not submit from a
            click that was almost something else: an attestation suppresses
            future evidence about a real person.
          */}
          <div className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              id="owned-identity-confirm"
              data-testid="owned-identities-confirm"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <label className="text-xs text-gray-700" htmlFor="owned-identity-confirm">
              I confirm this identity is this organization’s own, and that messages from it must not
              be admitted as a prospect’s own statement.
            </label>
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="owned-identities-attest-submit"
              disabled={!chosen || !confirmed || attesting}
              onClick={() => { void attest(); }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {attesting ? 'Attesting…' : 'Attest this identity'}
            </button>
            <button
              type="button"
              data-testid="owned-identities-attest-cancel"
              onClick={() => {
                setPicking(false); setChosen(null); setConfirmed(false);
                setStatement(''); setRowError(null);
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600"
            >
              Cancel
            </button>
          </div>

          {attestError && (
            <p role="alert" data-testid="owned-identities-attest-error" className="mt-2 text-xs text-red-700">
              {attestError}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (entries.length === 0) {
    return (
      <section className={SHELL} data-testid="owned-identities">
        {header}
        {noticeBlock}
        {picker}
        {/* Reachable ONLY from a real 200 carrying an empty list. */}
        <p data-testid="owned-identities-empty" className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          No owned engagement identity has been attested in this workspace. That is an absence of
          attestation records, and it says nothing about who this organization engages with.
        </p>
      </section>
    );
  }

  return (
    <section className={SHELL} data-testid="owned-identities">
      {header}
      {noticeBlock}
      {picker}
      <ul data-testid="owned-identities-list" className="space-y-2">
        {entries.map((e) => {
          const err = rowError?.id === e.id ? rowError.message : null;
          const rowBusy = busy === e.id;
          return (
            <li key={e.id} data-testid={`owned-identity-${e.id}`} className="rounded-xl border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* VERBATIM, case intact. */}
                  <p className="font-mono text-xs text-gray-900" data-testid={`owned-identity-identity-${e.id}`}>
                    {e.platformUserId}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    <span data-testid={`owned-identity-platform-${e.id}`}>{e.platform}</span>
                    {' · attested '}
                    <span data-testid={`owned-identity-attested-at-${e.id}`}>{when(e.attestedAt)}</span>
                    {' by '}
                    <span data-testid={`owned-identity-attested-by-${e.id}`}>{e.attestedByUserId ?? '—'}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Attested
                  </span>
                  <button
                    type="button"
                    data-testid={`owned-identity-revoke-${e.id}`}
                    disabled={rowBusy}
                    onClick={() => { setConfirmRevoke(e.id); setRevokeReason(''); setRowError(null); setNotice(null); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Revoke
                  </button>
                </div>
              </div>

              {/*
                INLINE, never a modal — the pattern `LeadSourcesPanel` uses. The
                reason is required here as well as on the route: a revocation
                with no reason is an audit record nobody can act on.
              */}
              {confirmRevoke === e.id && (
                <div
                  data-testid={`owned-identity-revoke-confirm-${e.id}`}
                  className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                >
                  <label className="block text-xs font-medium text-amber-900" htmlFor={`owned-identity-revoke-reason-${e.id}`}>
                    Reason for revoking
                  </label>
                  <input
                    id={`owned-identity-revoke-reason-${e.id}`}
                    data-testid={`owned-identity-revoke-reason-${e.id}`}
                    type="text"
                    value={revokeReason}
                    onChange={(ev) => setRevokeReason(ev.target.value)}
                    className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-1.5 text-xs"
                    placeholder="Why this entry is being revoked"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`owned-identity-revoke-yes-${e.id}`}
                      disabled={rowBusy}
                      onClick={() => { void revoke(e.id); }}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {rowBusy ? 'Revoking…' : 'Yes, revoke'}
                    </button>
                    <button
                      type="button"
                      data-testid={`owned-identity-revoke-cancel-${e.id}`}
                      onClick={() => { setConfirmRevoke(null); setRevokeReason(''); setRowError(null); }}
                      className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}

              {err && (
                <p role="alert" data-testid={`owned-identity-error-${e.id}`} className="mt-2 text-xs text-red-700">
                  {err}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        Each line is a record an administrator stated. Omnivyra does not verify an identity against
        the platform, and an attestation is not an assessment of the person behind it.
      </p>
    </section>
  );
};

export default OwnedIdentitiesPanel;
