/**
 * PI R1: the tenant chooses which information Apollo fills.
 *
 * Contact data is listed but cannot be chosen until it is available (the
 * owner has not yet recorded a lawful basis), and phone is planned for later;
 * both say so rather than disappearing. Saving refuses unknown or unavailable
 * groups server-side as well.
 */
import React, { useEffect, useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { useCompanyContext } from '@/components/CompanyContext';

interface Group { id: string; label: string; subject: 'person' | 'account'; contact: boolean; available: boolean; unavailableReason?: string }
interface Payload { groups: Group[]; selected: string[] }

export default function ApolloFieldGroupsPanel() {
  const { selectedCompanyId: companyId } = useCompanyContext();
  const key = companyId ? `/api/prospect-sources/apollo-field-groups?companyId=${encodeURIComponent(companyId)}` : null;
  const { data, error, mutate } = useSWR<Payload>(key, (u: string) => apiFetch(u).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }));
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data?.selected) setChosen(data.selected); }, [data?.selected]);

  if (!companyId) return null;
  if (error) return <p className="text-sm text-rose-600">Apollo data choices could not be read. Nothing has been changed.</p>;
  if (!data || !chosen) return null;

  const toggle = (id: string) => setChosen((c) => (c!.includes(id) ? c!.filter((x) => x !== id) : [...c!, id]));
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const res = await apiFetch(key!, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: chosen }),
      });
      setMessage(res.ok ? 'Saved. Future Apollo enrichment fills only these.' : 'Not saved. Choose at least one available group.');
      if (res.ok) await mutate();
    } finally { setSaving(false); }
  };

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="apollo-groups-heading" data-testid="apollo-field-groups">
      <h2 id="apollo-groups-heading" className="text-base font-semibold text-gray-900">What Apollo fills</h2>
      <p className="mt-1 text-sm text-gray-500">
        Choose which information Apollo adds to your prospects. Only the chosen groups are requested.
      </p>
      <ul className="mt-3 space-y-2">
        {data.groups.map((g) => (
          <li key={g.id}>
            <label className={`flex items-start gap-2 text-sm ${g.available ? 'text-gray-800' : 'text-gray-400'}`}>
              <input
                type="checkbox"
                disabled={!g.available}
                checked={g.available && chosen.includes(g.id)}
                onChange={() => toggle(g.id)}
                className="mt-0.5"
              />
              <span>
                {g.label}{g.contact ? ' (contact data, charged at a higher rate)' : ''}
                {!g.available && g.unavailableReason ? <span className="block text-xs">{g.unavailableReason}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button" onClick={save} disabled={saving || chosen.length === 0}
        className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Save
      </button>
      {message ? <p className="mt-2 text-sm text-gray-700" role="status">{message}</p> : null}
    </section>
  );
}
