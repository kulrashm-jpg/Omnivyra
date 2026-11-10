/**
 * PI R3: the tenant's import review list. Leads a discovery found that LOOK
 * like someone already here (same name, a shared mailbox, or a shared phone)
 * were NOT imported. A team member decides: import, or skip. Items expire after
 * 30 days as "not imported" and can be found again by a later search.
 *
 * Nothing on this screen merges two people. IMPORT adds the lead the normal
 * way; SKIP discards the held copy.
 *
 * HOMOGRAPH-SAFE: the reviewer's eyes are the authority here, so a profile
 * link is shown in its ASCII-escaped form, with a visible warning when a slug
 * mixes scripts (the API already renders it that way; this only displays it).
 */
import React, { useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';

interface CandidateView {
  name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  profile: { shown: string; mixedScript: boolean; form: 'vanity' | 'opaque' } | null;
  matchedOn: string;
}
interface ReviewItem {
  source: string;
  providerRecordId: string;
  reason: 'name_match' | 'role_contact' | 'shared_phone';
  matchedPersonIds: string[];
  createdAt: string;
  expiresAt: string;
  candidate: CandidateView;
}
interface ReviewList { items: ReviewItem[]; queue: { pendingRows: number; oldestCreatedAt: string | null } }

const ENDPOINT = '/api/prospect-sources/review-items';

const REASON_LABEL: Record<ReviewItem['reason'], string> = {
  name_match: 'Same name',
  role_contact: 'Shared mailbox',
  shared_phone: 'Shared phone',
};

const daysLeft = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  const d = Math.max(0, Math.ceil(ms / 86_400_000));
  return d === 1 ? '1 day left' : `${d} days left`;
};

export default function ImportReviewPanel({ companyId }: { companyId: string }) {
  const key = `${ENDPOINT}?companyId=${encodeURIComponent(companyId)}`;
  const { data, error, isLoading, mutate } = useSWR<ReviewList>(key, (u: string) => apiFetch(u).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decide = async (item: ReviewItem, decision: 'import' | 'skip') => {
    setBusy(item.providerRecordId);
    setMessage(null);
    try {
      const res = await apiFetch(key, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: item.source, providerRecordIds: [item.providerRecordId], decision }),
      });
      const body = await res.json().catch(() => ({}));
      const outcome = Array.isArray(body?.outcomes) ? body.outcomes[0] : null;
      if (!res.ok || !outcome) {
        setMessage('The decision could not be saved. Nothing was changed.');
      } else if (outcome.status === 'imported') {
        setMessage('Imported as a new prospect.');
      } else if (outcome.status === 'skipped') {
        setMessage('Skipped. It was not imported.');
      } else if (outcome.status === 'not_pending') {
        setMessage('Someone already decided this one, or it expired.');
      } else {
        setMessage('The decision could not be completed. The lead is still waiting for review.');
      }
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return null;
  if (error || !data || !Array.isArray(data.items)) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-rose-600">The duplicate review list could not be read. Nothing has been altered.</p>
      </section>
    );
  }
  if (data.items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm" aria-labelledby="import-review-heading">
      <h2 id="import-review-heading" className="text-base font-semibold text-gray-900">
        Possible duplicates waiting for review ({data.items.length})
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        A search found these leads, but each looks like someone you already have, so they were not imported.
        Import adds the lead as a new prospect; it never merges two people. Skip discards it.
        Undecided leads expire after 30 days and can be found again by a later search.
      </p>
      {message ? <p className="mt-3 text-sm text-gray-800" role="status">{message}</p> : null}
      <ul className="mt-4 divide-y divide-gray-100">
        {data.items.map((item) => (
          <li key={`${item.source}:${item.providerRecordId}`} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{item.candidate.name ?? 'Name not provided'}</p>
                <p className="text-sm text-gray-600">
                  {[item.candidate.title, item.candidate.company, item.candidate.location].filter(Boolean).join(' · ') || '—'}
                </p>
                {item.candidate.profile ? (
                  <p className="mt-0.5 break-all text-xs text-gray-500">
                    {item.candidate.profile.shown}
                    {item.candidate.profile.mixedScript ? (
                      <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">
                        Mixed scripts: check this link carefully
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-gray-500">
                  <span className="font-semibold text-amber-700">{REASON_LABEL[item.reason]}</span>
                  {' · '}{item.candidate.matchedOn}
                  {' · '}Matches {item.matchedPersonIds.length} existing {item.matchedPersonIds.length === 1 ? 'person' : 'people'}
                  {' · '}{daysLeft(item.expiresAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(item, 'import')}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  Import
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(item, 'skip')}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Skip
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
