import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Plus, Sparkles, Star, Search as SearchIcon, Copy, Layers } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import type { TemplateCollection } from '../../../lib/creator-templates/collection';

const FAV_KEY = 'creator_collection_favorites';
function readFavs(): string[] { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; } }
function writeFavs(ids: string[]) { try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch { /* ignore */ } }

/**
 * Collections (Design Systems) gallery — lives BESIDE the Templates gallery.
 * Search / categories / favorites / create (empty · AI · duplicate). Collections
 * reference existing templates; nothing is duplicated.
 */
export default function CollectionsPage() {
  const router = useRouter();
  const { selectedCompanyId, isLoading } = useCompanyContext();
  const [collections, setCollections] = React.useState<TemplateCollection[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [favs, setFavs] = React.useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { setFavs(readFavs()); }, []);
  const load = React.useCallback(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/creator-templates/collections?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.collections)) setCollections(d.collections); })
      .catch(() => { /* best-effort */ })
      .finally(() => setLoaded(true));
  }, [selectedCompanyId]);
  React.useEffect(() => { load(); }, [load]);

  const categories = Array.from(new Set(collections.map((c) => c.category))).filter(Boolean);
  const filtered = collections.filter((c) => {
    if (category && c.category !== category) return false;
    if (q && !(`${c.name} ${c.description} ${c.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  const recommended = [...filtered].sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0) || b.templateIds.length - a.templateIds.length);

  function toggleFav(id: string) {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next); writeFavs(next);
  }
  async function createEmpty() {
    if (!selectedCompanyId || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/creator-templates/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, name: 'New collection' }) });
      const d = await res.json();
      if (res.ok && d?.collection?.id) router.push(`/command-center/creator-content/collections-editor?id=${encodeURIComponent(d.collection.id)}`);
      else setBusy(false);
    } catch { setBusy(false); }
  }
  async function createAi() {
    if (!selectedCompanyId || !aiPrompt.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/creator-templates/collections/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, prompt: aiPrompt.trim() }) });
      const d = await res.json();
      if (res.ok && d?.collection?.id) router.push(`/command-center/creator-content/collections-editor?id=${encodeURIComponent(d.collection.id)}`);
      else setBusy(false);
    } catch { setBusy(false); }
  }
  async function duplicate(id: string) {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch('/api/creator-templates/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, duplicate_of: id }) });
      if (res.ok) load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  if (isLoading) return <PageLoader />;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 28, color: '#e5e7eb' }}>
      <button type="button" onClick={() => router.push('/command-center/creator-content/create')} style={linkBtn}><ArrowLeft size={15} /> Creator</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Layers size={22} color="#60a5fa" />
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Collections</h1>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>Reusable visual systems grouping your templates</span>
      </div>

      {/* Create row */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={createEmpty} disabled={busy} style={primaryBtn}><Plus size={15} /> New collection</button>
        <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 280 }}>
          <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Describe a design system, e.g. Product launch collection"
            style={{ flex: 1, background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '9px 11px', color: '#f8fafc', fontSize: 13 }} />
          <button type="button" onClick={createAi} disabled={busy || !aiPrompt.trim()} style={{ ...primaryBtn, background: busy || !aiPrompt.trim() ? '#1e293b' : '#7c3aed' }}><Sparkles size={15} /> {busy ? 'Working…' : 'AI collection'}</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <SearchIcon size={15} color="#64748b" style={{ position: 'absolute', left: 10, top: 10 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search collections" style={{ width: '100%', background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px 8px 32px', color: '#f8fafc', fontSize: 13 }} />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: category ? '#f8fafc' : '#64748b', fontSize: 13 }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loaded && !collections.length ? (
        <div style={{ marginTop: 28, color: '#64748b', fontSize: 14, textAlign: 'center' }}>No collections yet. Create one above.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
          {recommended.map((c) => (
            <div key={c.id} style={{ border: '1px solid #1f2937', borderRadius: 14, overflow: 'hidden', background: '#0b1220' }}>
              <div style={{ height: 130, background: '#020617', position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => router.push(`/command-center/creator-content/collections-editor?id=${encodeURIComponent(c.id)}`)}>
                {c.preview.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.preview.coverUrl} alt={`${c.name} cover`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                ) : (
                  <Layers size={34} color="#1e3a8a" />
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); toggleFav(c.id); }} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(2,6,23,0.6)', border: 'none', borderRadius: 999, padding: 6, cursor: 'pointer' }}>
                  <Star size={15} color={favs.includes(c.id) ? '#fbbf24' : '#94a3b8'} fill={favs.includes(c.id) ? '#fbbf24' : 'none'} />
                </button>
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: '#f8fafc', fontSize: 14.5 }}>{c.name}</strong>
                  <span style={{ fontSize: 11, color: '#93c5fd', border: '1px solid #1e3a8a', borderRadius: 6, padding: '2px 6px' }}>{c.category}</span>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 5, minHeight: 32 }}>{c.description || '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>{c.templateIds.length} template{c.templateIds.length === 1 ? '' : 's'} · {c.brandStyle}</span>
                  <button type="button" onClick={() => duplicate(c.id)} title="Duplicate" style={{ ...linkBtn, color: '#94a3b8' }}><Copy size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#93c5fd', fontSize: 13, cursor: 'pointer', padding: 0 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
