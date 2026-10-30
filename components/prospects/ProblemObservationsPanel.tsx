/**
 * Observed problems — what this prospect has been recorded as saying.
 *
 * ─── WHAT THIS PANEL IS ───────────────────────────────────────────────────
 * A read of `GET /api/prospects/[id]/problems`. Each row is a HISTORICAL,
 * source-grounded statement: something the prospect said, with the source it
 * can be re-read from and the time the SOURCE reported. Several statements over
 * time are normal and all of them are true; this panel therefore lists them and
 * picks no winner. There is no "current problem", no recency arbitration and no
 * most-recent-wins.
 *
 * ─── WHAT IT IS NOT ───────────────────────────────────────────────────────
 * Not Problem Fit. Fit is a separate relation that assesses how a tenant
 * offering matches a stated problem, and it remains UNSCORED and NON-SCORABLE
 * until its representation and weight are decided. Nothing here scores, ranks,
 * weights or prioritises a statement; rendering what someone said is not an
 * assessment of it. The panel contains no number except a source-reported
 * confidence, which is reproduced only when the source supplied one.
 *
 * ─── CAPTURE IS A CHOICE AMONG VERIFIED MESSAGES, NOT A FORM ──────────
 * An earlier revision of this panel read only, because the capture contract
 * requires `origin.store` and `origin.recordId` — where the words can be
 * re-read — and the server validates neither against any registry. A form with
 * free-text source fields would have produced a citation nobody could follow.
 * That reasoning still holds, and it is why there are no source text boxes here
 * and never should be.
 *
 * What changed is the server. `GET …/eligible-messages` returns only messages
 * the capture path would actually accept: tenant-scoped, positively authored by
 * this prospect, carrying a source-reported time and some text. The operator
 * picks one and nothing else; `POST …/problems` then takes `{ subjectType,
 * source: { messageId } }` and the server DERIVES the statement from the
 * message's own `content`, the time from its `platform_created_at`, and the
 * origin from the verified message id. The route refuses a body that supplies
 * any of them, so this panel cannot submit a statement even by accident.
 *
 * The admission gate still refuses `engagement_messages` as a store for
 * everyone else; one audited, row-specific exception admits a message the
 * server has verified, and only when it carries the server-set attestation.
 * Choosing a message is a read — only the explicit submit writes.
 *
 * ─── ABSENCE IS NOT A ZERO ────────────────────────────────────────────────
 * "No statements recorded" and "we could not read the store" are different
 * answers and are rendered differently. The route says so itself: an empty
 * tenant is a 200 with an empty list, while an unreadable relation is a 503. The
 * migration that creates the table is NOT applied, so today every call returns
 * that 503 — which this panel reports as unread, never as "this prospect has
 * stated no problems".
 */

import React, { useCallback, useState } from 'react';
import useSWR from 'swr';
import { AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';

/** One stored statement, exactly as the route returns it. */
export interface ObservationView {
  readonly id: string;
  readonly subjectType: 'person' | 'account';
  readonly subjectId: string;
  readonly statement: string;
  readonly statementLanguage: string | null;
  readonly originStore: string;
  readonly originRecordId: string;
  readonly originKind: 'provider' | 'human';
  readonly recordedByUserId: string | null;
  readonly sourceRecordId: string | null;
  readonly confidence: number | null;
  /** The SOURCE's clock. Null when the source reported none. */
  readonly observedAt: string | null;
  /** OUR clock. Never shown as when the prospect spoke. */
  readonly recordedAt: string;
}

export interface ProblemObservationsResponse {
  readonly version?: string;
  readonly contract?: string;
  readonly subjectType?: 'person' | 'account';
  readonly subjectId?: string;
  readonly state?: 'available';
  readonly observations?: readonly ObservationView[];
}

interface FetchFailure { status: number; body: Record<string, unknown> | null }

/**
 * Non-2xx must reach SWR's `error`, not its `data`.
 *
 * A fetcher that only does `.then(r => r.json())` hands an error BODY back as
 * though it were a payload, and a panel then renders a failure as content. The
 * status is carried through so the message can distinguish "could not look" from
 * "not available here".
 */
const readObservations = async (url: string): Promise<ProblemObservationsResponse> => {
  const res = await apiFetch(url);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw { status: res.status, body } as FetchFailure;
  return (body ?? {}) as ProblemObservationsResponse;
};

/** Same contract as `readObservations`: a non-2xx must reach SWR's `error`. */
const readEligible = async (url: string): Promise<EligibleMessagesResponse> => {
  const res = await apiFetch(url);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw { status: res.status, body } as FetchFailure;
  return (body ?? {}) as EligibleMessagesResponse;
};

/**
 * One sentence for the reader, from a status the server chose.
 *
 * Shaped after `LeadSourcesPanel.messageFor`, with this route's own vocabulary
 * added. Two rules it must not break:
 *  · a 404 here means the prospect is not available in THIS workspace, and the
 *    route answers it identically whether the prospect is absent or belongs to
 *    another tenant — deliberately, so that the API is not a cross-tenant
 *    existence oracle. Saying "you do not have access" would rebuild that oracle
 *    in the UI, so the wording stays "not available in this workspace".
 *  · a 503 is "we could not look", never "there is nothing".
 */
export function messageForObservations(status: number, body: Record<string, unknown> | null): string {
  const code = typeof body?.error === 'string' ? body.error : null;
  if (status === 401) return 'Your session has expired. Sign in again to read recorded statements.';
  if (status === 403) return 'You do not have permission to read recorded statements for this workspace.';
  if (status === 404) return 'This prospect is not available in this workspace.';
  if (status === 503) {
    return code === 'problem_observations_unavailable'
      ? 'Recorded statements could not be read. They have not been altered — only unread. Retry in a moment.'
      : 'Could not reach Omnivyra. Check your connection and retry.';
  }
  if (typeof body?.detail === 'string' && body.detail.trim() !== '') return body.detail;
  if (code) return `Recorded statements could not be read (${code}).`;
  return 'Recorded statements could not be read.';
}

/** An instant, or an em dash. Never "now" standing in for an unknown time. */
const when = (iso: string | null): string => {
  if (iso === null || iso.trim() === '') return '—';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : iso;
};

/**
 * A source-reported confidence, or an explicit absence.
 *
 * `null` renders as "not stated" rather than 0%, because a confidence nobody
 * recorded is unknown, and 0% is a statement the source never made.
 */
const confidenceLabel = (c: number | null): string =>
  typeof c === 'number' && Number.isFinite(c) ? `${Math.round(c * 100)}% (source-reported)` : 'not stated';

const SHELL = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';

/** One message the SERVER has already judged capturable. */
export interface EligibleMessageView {
  readonly messageId: string;
  readonly threadId: string;
  readonly channel: string | null;
  /** A capped excerpt. NOT the statement — the server derives that itself. */
  readonly preview: string;
  readonly truncated: boolean;
  readonly observedAt: string;
}

export interface EligibleMessagesResponse {
  readonly messages?: readonly EligibleMessageView[];
  readonly reason?: string | null;
  readonly ineligible?: Readonly<Record<string, number>>;
}

export interface ProblemObservationsPanelProps {
  readonly companyId: string;
  readonly prospectId: string;
}

const ProblemObservationsPanel: React.FC<ProblemObservationsPanelProps> = ({ companyId, prospectId }) => {
  const [subjectType, setSubjectType] = useState<'person' | 'account'>('person');
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<
    { kind: 'recorded' | 'already'; text: string } | { kind: 'refused'; text: string } | null
  >(null);

  const key = companyId && prospectId
    ? `/api/prospects/${encodeURIComponent(prospectId)}/problems`
      + `?companyId=${encodeURIComponent(companyId)}&subjectType=${subjectType}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<ProblemObservationsResponse>(key, readObservations);
  const retry = useCallback(() => { void mutate(); }, [mutate]);

  /**
   * LAZY ON PURPOSE. The key stays null until the operator opens the picker,
   * and never opens on the account leg. Two reasons, both load-bearing: a
   * second eager read would make this panel fetch something nobody asked for,
   * and the existing suite asserts both that an unselected workspace fetches
   * NOTHING and that the first request is the observations read — an eager
   * second key would reorder that and break an assertion for the wrong reason.
   */
  const eligibleKey = choosing && subjectType === 'person' && companyId && prospectId
    ? `/api/prospects/${encodeURIComponent(prospectId)}/eligible-messages`
      + `?companyId=${encodeURIComponent(companyId)}&subjectType=person`
    : null;
  const eligible = useSWR<EligibleMessagesResponse>(eligibleKey, readEligible);

  /**
   * The ONLY write this panel makes, and it names one message.
   *
   * The body is two keys. It carries no statement, no time and no origin: the
   * route refuses all of those on this shape, and the server derives them from
   * the message it verified. Nothing is reported as recorded until the server
   * says so — there is no optimistic row, because an optimistic row is an
   * unverified statement rendered as stored.
   */
  const submit = useCallback(async () => {
    if (!chosen || submitting) return;
    setSubmitting(true);
    setOutcome(null);
    try {
      const res = await apiFetch(
        `/api/prospects/${encodeURIComponent(prospectId)}/problems`
        + `?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjectType: 'person', source: { messageId: chosen } }),
        },
      );
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setOutcome({ kind: 'refused', text: messageForObservations(res.status, body) });
        return;                                  // no mutate: nothing was stored
      }
      const replay = body?.duplicate === true;
      setOutcome(replay
        ? { kind: 'already', text: 'That message was already recorded as a stated problem. Nothing was added.' }
        : { kind: 'recorded', text: 'Recorded from the selected message.' });
      setChosen(null);
      setChoosing(false);
      await mutate();                            // the row comes back from the server
    } catch {
      setOutcome({ kind: 'refused', text: 'Nothing was recorded — the request could not be sent.' });
    } finally {
      setSubmitting(false);
    }
  }, [chosen, submitting, prospectId, companyId, mutate]);

  const capture = subjectType === 'account'
    ? (
      <p data-testid="problems-capture-account" className="mb-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        Recording a stated problem against an account is not available here. A stored message is
        attributable to one person, and one person speaking is not the company speaking.
      </p>
    )
    : (
      <div data-testid="problems-capture" className="mb-3 rounded-xl border border-gray-200 p-3">
        {!choosing ? (
          <button
            type="button"
            data-testid="problems-capture-open"
            onClick={() => { setChoosing(true); setOutcome(null); }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            Record a stated problem from a message
          </button>
        ) : (
          <div>
            <p className="text-xs text-gray-600">
              Choose one message this person sent. Omnivyra takes the wording from the message
              itself, so there is nothing here to type.
            </p>
            {eligible.isLoading && (
              <p data-testid="problems-capture-loading" className="mt-2 text-xs text-gray-500">
                Reading messages…
              </p>
            )}
            {(eligible.error || (!eligible.isLoading && !eligible.data)) && (
              <p role="alert" data-testid="problems-capture-error" className="mt-2 text-xs text-red-700">
                Messages could not be read, so there is nothing to choose from yet. They have not
                been altered — only unread.
              </p>
            )}
            {eligible.data && (eligible.data.messages ?? []).length === 0 && (
              <p data-testid="problems-capture-none" className="mt-2 text-xs text-gray-600">
                No message from this person can be cited yet. A message is citable when this
                workspace stored who sent it, when they sent it, and what they wrote.
              </p>
            )}
            {eligible.data && (eligible.data.messages ?? []).length > 0 && (
              <ul data-testid="problems-capture-options" className="mt-2 space-y-1">
                {(eligible.data.messages ?? []).map((m) => (
                  <li key={m.messageId}>
                    <label
                      htmlFor={`stated-problem-source-${m.messageId}`}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2 text-xs"
                    >
                      <input
                        type="radio"
                        id={`stated-problem-source-${m.messageId}`}
                        name="stated-problem-source"
                        data-testid={`problems-capture-option-${m.messageId}`}
                        checked={chosen === m.messageId}
                        onChange={() => setChosen(m.messageId)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="text-gray-900">{m.preview}</span>
                        {m.truncated && <span className="text-gray-500"> … (excerpt)</span>}
                        <span className="block text-gray-500">
                          {m.channel ?? 'message'} · sent {when(m.observedAt)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                data-testid="problems-capture-submit"
                disabled={!chosen || submitting}
                onClick={() => { void submit(); }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {submitting ? 'Recording…' : 'Record this message'}
              </button>
              <button
                type="button"
                data-testid="problems-capture-cancel"
                onClick={() => { setChoosing(false); setChosen(null); }}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600"
              >
                Cancel
              </button>
            </div>
            {eligible.data?.ineligible && (
              <p data-testid="problems-capture-hidden" className="mt-2 text-xs text-gray-500">
                Some messages are not offered because this workspace did not store who sent them,
                when they were sent, or any wording.
              </p>
            )}
          </div>
        )}
        {outcome && (
          <p
            role={outcome.kind === 'refused' ? 'alert' : undefined}
            data-testid={`problems-capture-${outcome.kind}`}
            className={outcome.kind === 'refused' ? 'mt-2 text-xs text-red-700' : 'mt-2 text-xs text-gray-700'}
          >
            {outcome.text}
          </p>
        )}
      </div>
    );

  const header = (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Observed problems</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Problems this prospect has been recorded as stating, newest first. Every statement is kept;
          none supersedes another.
        </p>
      </div>
      <div className="flex shrink-0 gap-1" role="group" aria-label="Subject">
        {(['person', 'account'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`problems-subject-${t}`}
            aria-pressed={subjectType === t}
            onClick={() => setSubjectType(t)}
            className={subjectType === t
              ? 'rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white'
              : 'rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50'}
          >
            {t === 'person' ? 'Person' : 'Account'}
          </button>
        ))}
      </div>
    </div>
  );

  if (!companyId) {
    return (
      <section className={SHELL} data-testid="problem-observations">
        {header}
        <p data-testid="problems-no-tenant" className="text-xs text-gray-500">
          Select a company to read recorded statements.
        </p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className={SHELL} data-testid="problem-observations" aria-busy="true">
        {header}
        <div data-testid="problems-loading" className="space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    const f = (error ?? null) as FetchFailure | null;
    return (
      <section className={SHELL} data-testid="problem-observations">
        {header}
        <div
          role="alert"
          data-testid="problems-error"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{f && typeof f.status === 'number'
              ? messageForObservations(f.status, f.body)
              : 'Recorded statements could not be read.'}</p>
            <button
              type="button"
              data-testid="problems-retry"
              onClick={retry}
              className="mt-2 rounded-lg border border-red-300 px-2.5 py-1 font-medium text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  const observations = data.observations ?? [];

  if (observations.length === 0) {
    return (
      <section className={SHELL} data-testid="problem-observations">
        {header}
        {capture}
        <p data-testid="problems-empty" className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          No problem statements have been recorded for this {subjectType}. That is an absence of
          records, not a finding about the prospect.
        </p>
      </section>
    );
  }

  return (
    <section className={SHELL} data-testid="problem-observations">
      {header}
      {capture}
      <ul data-testid="problems-list" className="space-y-3">
        {observations.map((o) => (
          <li key={o.id} data-testid={`problem-${o.id}`} className="rounded-xl border border-gray-200 p-3">
            {/* The prospect's own words, reproduced and not summarised. */}
            <p data-testid={`problem-statement-${o.id}`} className="text-sm text-gray-900">
              {o.statement}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
              <div>
                <dt className="inline text-gray-500">Source: </dt>
                <dd className="inline" data-testid={`problem-origin-${o.id}`}>
                  {o.originStore} · {o.originRecordId}
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Recorded by: </dt>
                <dd className="inline">{o.originKind === 'human' ? 'a person in this workspace' : 'a provider record'}</dd>
              </div>
              {/* The two clocks are labelled apart. Our recording time is never
                  presented as when the prospect spoke. */}
              <div>
                <dt className="inline text-gray-500">Stated (per source): </dt>
                <dd className="inline" data-testid={`problem-observed-${o.id}`}>{when(o.observedAt)}</dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Recorded by Omnivyra: </dt>
                <dd className="inline" data-testid={`problem-recorded-${o.id}`}>{when(o.recordedAt)}</dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Source confidence: </dt>
                <dd className="inline" data-testid={`problem-confidence-${o.id}`}>{confidenceLabel(o.confidence)}</dd>
              </div>
              {o.statementLanguage !== null && (
                <div>
                  <dt className="inline text-gray-500">Language: </dt>
                  <dd className="inline">{o.statementLanguage}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        These are records of what was said. Whether any of them matches what this workspace offers is a
        separate assessment that Omnivyra does not yet make.
      </p>
    </section>
  );
};

export default ProblemObservationsPanel;
