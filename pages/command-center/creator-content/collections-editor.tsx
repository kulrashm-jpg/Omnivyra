import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Trash2, ArrowUp, ArrowDown, Image as ImageIcon, Star, Plus, AlertTriangle } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import { listCanonicalTemplatesForFamily, type CreatorTemplate, type TemplateAssetFamily } from '../../../lib/creator-templates';
import { recommendTemplateForFamily, type TemplateCollection, type CollectionValidation } from '../../../lib/creator-templates/collection';

interface EvoRec { id: string; type: string; title: string; evidence: string[]; impactedMetrics: string[]; expectedBenefit: string; confidence: { level: string; value: number }; action?: { op: string; templateId: string; replacementTemplateId?: string } }
interface EvoAnalysis { collectionId: string; strengths: string[]; weaknesses: string[]; recommendations: EvoRec[] }

const FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

/**
 * Collection editor — manage members (order / add / remove / cover), rename,
 * description, brand style, tags. The "Open in Creator" buttons demonstrate the
 * collection recommendation: pick a family → that collection's template opens.
 */
export default function CollectionEditorPage() {
  const router = useRouter();
  const { selectedCompanyId, isLoading } = useCompanyContext();
  const [collection, setCollection] = React.useState<TemplateCollection | null>(null);
  const [templates, setTemplates] = React.useState<CreatorTemplate[]>([]);
  const [validation, setValidation] = React.useState<CollectionValidation | null>(null);
  const [userTemplates, setUserTemplates] = React.useState<CreatorTemplate[]>([]);
  const [evo, setEvo] = React.useState<EvoAnalysis | null>(null);
  const [hidden, setHidden] = React.useState<Record<string, 'dismissed' | 'postponed'>>({});
  const [busy, setBusy] = React.useState(false);
  const id = typeof router.query.id === 'string' ? router.query.id : '';

  const load = React.useCallback(() => {
    if (!id) return;
    fetch(`/api/creator-templates/collections/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.collection) { setCollection(d.collection); setTemplates(d.templates ?? []); setValidation(d.validation ?? null); } })
      .catch(() => { /* ignore */ });
  }, [id]);
  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/creator-templates/user?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.templates)) setUserTemplates(d.templates); })
      .catch(() => { /* best-effort */ });
  }, [selectedCompanyId]);

  // Evolution recommendations (deterministic, read-only) for this collection.
  React.useEffect(() => {
    if (!id || !selectedCompanyId) return;
    fetch(`/api/creator-templates/collection-evolution/${encodeURIComponent(id)}?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.analysis) setEvo(d.analysis); })
      .catch(() => { /* best-effort */ });
  }, [id, selectedCompanyId]);

  async function acceptRec(rec: EvoRec) {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/creator-templates/collection-evolution/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, recommendation: rec }),
      });
      const d = await res.json();
      if (d?.applied) { load(); setEvo(null); }                         // new version created
      else setHidden((h) => ({ ...h, [rec.id]: 'dismissed' }));        // guidance-only → acknowledge
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>) {
    if (!id || busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/creator-templates/collections/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  function move(idx: number, dir: -1 | 1) {
    if (!collection) return;
    const ids = [...collection.templateIds];
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    patch({ op: 'reorder', ordered_ids: ids });
  }

  const byId = new Map(templates.map((t) => [t.id, t]));
  // PHASE-1: pick members from the CANONICAL pool — the same taxonomy the
  // gallery, the API and recommendation expose, so a collection can never be
  // built out of a template the rest of the product has deduplicated away.
  const candidates = [...FAMILIES.flatMap((f) => listCanonicalTemplatesForFamily(f)), ...userTemplates]
    .filter((t) => !collection?.templateIds.includes(t.id));

  function openFamily(family: TemplateAssetFamily) {
    if (!collection) return;
    const resolve = (tid: string) => byId.get(tid) ?? null;
    const rec = recommendTemplateForFamily(collection, family, resolve);
    if (!rec) return;
    router.push(`/command-center/creator-content/${family === 'image' ? 'image' : family}/templates?template_id=${encodeURIComponent(rec.id)}`);
  }

  if (isLoading) return <PageLoader />;
  if (!collection) return <div style={{ padding: 28, color: '#94a3b8' }}>Loading collection…</div>;

  const coveredFamilies = FAMILIES.filter((f) => templates.some((t) => t.assetFamily === f));

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 28, color: '#e5e7eb' }}>
      <button type="button" onClick={() => router.push('/command-center/creator-content/collections')} style={linkBtn}><ArrowLeft size={15} /> Collections</button>

      {/* Header / meta edits */}
      <input value={collection.name} onChange={(e) => setCollection({ ...collection, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })}
        style={{ display: 'block', width: '100%', marginTop: 14, background: 'transparent', border: 'none', borderBottom: '1px solid #1f2937', color: '#f8fafc', fontSize: 22, fontWeight: 800, padding: '4px 0' }} />
      <textarea value={collection.description} onChange={(e) => setCollection({ ...collection, description: e.target.value })} onBlur={(e) => patch({ description: e.target.value })} placeholder="Description"
        rows={2} style={{ width: '100%', marginTop: 10, background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: 10, color: '#cbd5e1', fontSize: 13, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>Category <input value={collection.category} onChange={(e) => setCollection({ ...collection, category: e.target.value })} onBlur={(e) => patch({ category: e.target.value })} style={miniInput} /></label>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>Brand style <input value={collection.brandStyle} onChange={(e) => setCollection({ ...collection, brandStyle: e.target.value })} onBlur={(e) => patch({ brand_style: e.target.value })} style={miniInput} /></label>
        <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>v{collection.version} · {collection.status}</span>
      </div>

      {/* Validation */}
      {validation && !validation.ok ? (
        <div style={{ marginTop: 14, border: '1px solid #7f1d1d', background: '#7f1d1d22', borderRadius: 8, padding: 10, color: '#fca5a5', fontSize: 12.5 }}>
          <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {validation.errors.join(' ')}
        </div>
      ) : null}

      {/* Family quick-launch (collection recommendation) */}
      {coveredFamilies.length ? (
        <div style={{ marginTop: 18 }}>
          <div style={sectionLabel}>Open in Creator</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {coveredFamilies.map((f) => (
              <button key={f} type="button" onClick={() => openFamily(f)} style={{ ...primaryBtn, background: '#0f766e' }}>{f[0]!.toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Evolution recommendations — Accept (new version) / Dismiss / Postpone */}
      {evo && evo.recommendations.some((r) => !hidden[r.id]) ? (
        <div style={{ marginTop: 22 }}>
          <div style={sectionLabel}>Evolution recommendations</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {evo.recommendations.filter((r) => !hidden[r.id]).map((r) => (
              <div key={r.id} style={{ border: '1px solid #1e3a8a', borderRadius: 10, padding: 11, background: '#0b1220' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#f8fafc' }}>{r.title}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: r.confidence.level === 'high' ? '#86efac' : r.confidence.level === 'medium' ? '#fbbf24' : '#94a3b8' }}>{r.confidence.level} confidence</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>{r.evidence.join(' · ')}</div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>Expected: {r.expectedBenefit}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button type="button" onClick={() => acceptRec(r)} disabled={busy} style={{ ...primaryBtn, padding: '6px 12px' }}>{r.action ? 'Accept (new version)' : 'Acknowledge'}</button>
                  <button type="button" onClick={() => setHidden((h) => ({ ...h, [r.id]: 'dismissed' }))} style={iconBtnText}>Dismiss</button>
                  <button type="button" onClick={() => setHidden((h) => ({ ...h, [r.id]: 'postponed' }))} style={iconBtnText}>Postpone</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Accepting a membership change creates a NEW collection version — existing versions are never modified.</div>
        </div>
      ) : null}

      {/* Members */}
      <div style={{ ...sectionLabel, marginTop: 22 }}>Templates ({collection.templateIds.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {collection.templateIds.map((tid, idx) => {
          const t = byId.get(tid);
          const isCover = collection.preview.coverTemplateId === tid;
          return (
            <div key={tid} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${isCover ? '#2563eb' : '#1f2937'}`, borderRadius: 10, padding: 10, background: '#0b1220' }}>
              <ImageIcon size={16} color="#64748b" />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#f8fafc', fontSize: 13.5, fontWeight: 600 }}>{t ? t.name : <span style={{ color: '#fca5a5' }}>Missing template ({tid.slice(0, 8)}…)</span>}</div>
                <div style={{ fontSize: 11.5, color: '#64748b' }}>{t ? `${t.assetFamily} · ${t.category}` : 'reference no longer resolves'}</div>
              </div>
              <button type="button" title="Set as cover" onClick={() => patch({ cover_template_id: tid })} style={iconBtn}><Star size={14} color={isCover ? '#fbbf24' : '#64748b'} fill={isCover ? '#fbbf24' : 'none'} /></button>
              <button type="button" title="Move up" onClick={() => move(idx, -1)} style={iconBtn}><ArrowUp size={14} /></button>
              <button type="button" title="Move down" onClick={() => move(idx, 1)} style={iconBtn}><ArrowDown size={14} /></button>
              <button type="button" title="Remove" onClick={() => patch({ op: 'remove', template_id: tid })} style={iconBtn}><Trash2 size={14} color="#fca5a5" /></button>
            </div>
          );
        })}
        {!collection.templateIds.length ? <div style={{ color: '#64748b', fontSize: 13 }}>No templates yet — add one below.</div> : null}
      </div>

      {/* Add */}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Plus size={15} color="#64748b" />
        <select disabled={busy} onChange={(e) => { if (e.target.value) { patch({ op: 'add', template_id: e.target.value }); e.target.value = ''; } }}
          style={{ flex: 1, background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '9px 10px', color: '#cbd5e1', fontSize: 13 }} defaultValue="">
          <option value="">Add a template to this collection…</option>
          {candidates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.assetFamily}{t.ownership === 'user' ? ' (mine)' : ''}</option>)}
        </select>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#93c5fd', fontSize: 13, cursor: 'pointer', padding: 0 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const iconBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #1f2937', borderRadius: 7, padding: 6, cursor: 'pointer', color: '#cbd5e1' };
const iconBtnText: React.CSSProperties = { background: 'transparent', border: '1px solid #1f2937', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', color: '#94a3b8', fontSize: 12.5 };
const miniInput: React.CSSProperties = { marginLeft: 6, background: '#020617', border: '1px solid #334155', borderRadius: 6, padding: '4px 8px', color: '#f8fafc', fontSize: 12.5, width: 130 };
const sectionLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 };
