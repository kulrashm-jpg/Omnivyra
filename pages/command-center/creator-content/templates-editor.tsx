import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Save, Upload, Archive, History, RotateCcw } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import CreatorQualityInspector from '../../../components/creator/CreatorQualityInspector';
import type { CreatorTemplate } from '../../../lib/creator-templates';
import { previewStatusOf, canPublishWithPreview, type PreviewStatus } from '../../../lib/creator-templates/userTemplatePreview';

/**
 * User Template Editor — create / edit / save (versioned) / restore / publish /
 * archive. Edits only the whitelisted, supported properties (the backend
 * rejects rendering-contract edits). Publish is gated on the existing
 * deterministic diagnostic and surfaced via the existing Quality Inspector.
 *
 * Routes:
 *   /command-center/creator-content/templates-editor?id=<userTemplateId>   (edit)
 *   /command-center/creator-content/templates-editor?family=image&source=<id>  (create)
 */

interface VersionRow { version: number; createdAt?: string; template: CreatorTemplate }

export default function TemplatesEditorPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId } = useCompanyContext();
  const [tpl, setTpl] = React.useState<CreatorTemplate | null>(null);
  const [versions, setVersions] = React.useState<VersionRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => { if (authChecked && !isLoading && !user?.userId) router.replace('/login'); }, [authChecked, isLoading, user?.userId, router]);

  // Load (edit) or create on first ready.
  const initialized = React.useRef(false);
  React.useEffect(() => {
    if (!router.isReady || initialized.current || !user?.userId) return;
    initialized.current = true;
    const id = typeof router.query.id === 'string' ? router.query.id : null;
    const family = typeof router.query.family === 'string' ? router.query.family : null;
    const source = typeof router.query.source === 'string' ? router.query.source : null;
    if (id) { void loadTemplate(id); return; }
    if (family) { void createTemplate(family, source); return; }
    setError('Provide ?id= to edit or ?family= to create.');
  }, [router.isReady, user?.userId]);

  // Live preview status — poll while a render is in flight; publish unlocks
  // automatically when status becomes 'ready' (no manual refresh).
  React.useEffect(() => {
    if (!tpl) return;
    const st = previewStatusOf(tpl);
    if (st !== 'pending' && st !== 'rendering') return;
    const h = setInterval(() => { void refreshStatus(tpl.id); }, 3000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.id, tpl ? previewStatusOf(tpl) : 'none']);

  async function loadTemplate(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/creator-templates/user/${encodeURIComponent(id)}?include=versions`);
      if (!r.ok) throw new Error(`Load failed (${r.status})`);
      const d = await r.json();
      setTpl(d.template); setVersions(Array.isArray(d.versions) ? d.versions : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); } finally { setBusy(false); }
  }
  async function createTemplate(family: string, source: string | null) {
    setBusy(true);
    try {
      const r = await fetch('/api/creator-templates/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, family, source_template_id: source }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error || `Create failed (${r.status})`); }
      const d = await r.json();
      setTpl(d.template);
      router.replace({ pathname: router.pathname, query: { id: d.template.id } }, undefined, { shallow: true });
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed'); } finally { setBusy(false); }
  }

  const edit = (patch: Partial<CreatorTemplate>) => setTpl((t) => (t ? { ...t, ...patch } : t));
  const editVisual = (patch: Partial<CreatorTemplate['visualLanguage']>) => setTpl((t) => (t ? { ...t, visualLanguage: { ...t.visualLanguage, ...patch } } : t));

  async function save() {
    if (!tpl) return; setBusy(true); setError(null); setNotice(null);
    try {
      const edits = { name: tpl.name, category: tpl.category, description: tpl.description, visualLanguage: tpl.visualLanguage, tags: tpl.tags };
      const r = await fetch(`/api/creator-templates/user/${encodeURIComponent(tpl.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error || `Save failed (${r.status})`); }
      const d = await r.json(); setTpl(d.template); setNotice(`Saved as v${d.template.version}.`);
      void loadVersions(tpl.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); }
  }
  async function loadVersions(id: string) {
    try { const r = await fetch(`/api/creator-templates/user/${encodeURIComponent(id)}?include=versions`); if (r.ok) { const d = await r.json(); setVersions(d.versions ?? []); } } catch { /* ignore */ }
  }
  async function refreshStatus(id: string) {
    try { const r = await fetch(`/api/creator-templates/user/${encodeURIComponent(id)}`); if (r.ok) { const d = await r.json(); setTpl(d.template); } } catch { /* ignore */ }
  }
  async function action(act: 'publish' | 'restore' | 'archive', extra: Record<string, unknown> = {}) {
    if (!tpl) return; setBusy(true); setError(null); setNotice(null);
    try {
      const body: Record<string, unknown> = { action: act, ...extra };
      if (act === 'publish') body.diagnostic = diagnostic;
      const r = await fetch(`/api/creator-templates/user/${encodeURIComponent(tpl.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.gate?.reasons?.join(' · ') || d?.error || `${act} failed`); return; }
      if (d.template) setTpl(d.template);
      setNotice(`${act[0].toUpperCase()}${act.slice(1)} succeeded.`);
      void loadVersions(tpl.id);
    } catch (e) { setError(e instanceof Error ? e.message : `${act} failed`); } finally { setBusy(false); }
  }

  if (!authChecked || isLoading) return <PageLoader />;

  const diagnostic = tpl ? (tpl.metadata as any)?.creator_diagnostic_report ?? null : null;
  const status: PreviewStatus = tpl ? previewStatusOf(tpl) : 'pending';
  const gate = tpl ? canPublishWithPreview(tpl, diagnostic) : { ok: false, reasons: ['No template'] };
  const PREVIEW_LABEL: Record<PreviewStatus, { label: string; color: string }> = {
    pending: { label: 'Preview pending', color: '#fbbf24' },
    rendering: { label: 'Rendering preview…', color: '#60a5fa' },
    ready: { label: 'Preview ready', color: '#86efac' },
    failed: { label: 'Preview failed', color: '#fca5a5' },
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 20px 80px', color: '#e5e7eb' }}>
      <button type="button" style={linkBtn} onClick={() => router.back()}><ArrowLeft size={14} /> Back</button>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '8px 0 4px', color: '#f8fafc' }}>Template Editor</h1>
      <p style={{ color: '#9ca3af', marginBottom: 16 }}>Edit the supported properties. Rendering contracts are managed automatically and are not directly editable.</p>

      {error ? <div style={{ ...banner, borderColor: '#b91c1c', color: '#fca5a5' }}>{error}</div> : null}
      {notice ? <div style={{ ...banner, borderColor: '#166534', color: '#86efac' }}>{notice}</div> : null}

      {!tpl ? (busy ? <PageLoader /> : <div style={{ color: '#94a3b8' }}>No template loaded.</div>) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
          <div>
            <Field label="Name"><input style={input} value={tpl.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
            <Field label="Category"><input style={input} value={tpl.category} onChange={(e) => edit({ category: e.target.value })} /></Field>
            <Field label="Description"><textarea style={{ ...input, minHeight: 64 }} value={tpl.description} onChange={(e) => edit({ description: e.target.value })} /></Field>
            <Field label="Accent color"><input style={input} value={tpl.visualLanguage.accent ?? ''} onChange={(e) => editVisual({ accent: e.target.value })} /></Field>
            <Field label="Density bias">
              <select style={input} value={tpl.visualLanguage.densityBias ?? 'balanced'} onChange={(e) => editVisual({ densityBias: e.target.value as any })}>
                {['minimal', 'balanced', 'dense'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Typography weight">
              <select style={input} value={tpl.visualLanguage.typographyWeight ?? 'lead'} onChange={(e) => editVisual({ typographyWeight: e.target.value as any })}>
                {['support', 'lead', 'feature'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Tags (comma separated)"><input style={input} value={tpl.tags.join(', ')} onChange={(e) => edit({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" style={primaryBtn} disabled={busy} onClick={save}><Save size={15} /> Save version</button>
              <button type="button" style={ghostBtn} disabled={busy || !gate.ok} title={gate.ok ? 'Publish' : gate.reasons.join(' · ')} onClick={() => action('publish')}><Upload size={15} /> Publish</button>
              <button type="button" style={ghostBtn} disabled={busy} onClick={() => action('archive')}><Archive size={15} /> Archive</button>
            </div>
            {!gate.ok ? <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>Publish blocked: {gate.reasons.join(' · ')}</div> : null}
          </div>

          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4 }}>Preview</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PREVIEW_LABEL[status].color }}>{PREVIEW_LABEL[status].label}</span>
              </div>
              {tpl.preview.thumbnailUrl ? (
                <div style={{ position: 'relative' }}>
                  <img src={tpl.preview.thumbnailUrl} alt="Template preview" style={{ width: '100%', borderRadius: 10, border: '1px solid #1f2937', display: 'block' }} />
                  {(status === 'rendering' || status === 'pending') ? (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,6,23,0.55)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 12 }}>Updating preview…</div>
                  ) : null}
                </div>
              ) : (
                <div style={{ ...banner, borderColor: '#1f2937', color: '#94a3b8', fontSize: 12, minHeight: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                  {status === 'failed' ? 'Preview render failed — Save again to retry.' : 'Generating first preview…'}
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Status</div>
            <div style={{ ...banner, borderColor: '#1f2937', color: '#cbd5e1' }}>
              v{tpl.version} · {String((tpl.metadata as any)?.status ?? 'draft')} · {tpl.assetFamily}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4, margin: '16px 0 8px' }}>
              <History size={13} /> Version history
            </div>
            {versions.length === 0 ? <div style={{ fontSize: 12, color: '#64748b' }}>No saved versions yet.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {versions.map((v) => (
                  <div key={v.version} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', borderRadius: 8, padding: '6px 10px', background: '#020617' }}>
                    <span style={{ fontSize: 12.5, color: '#cbd5e1' }}>v{v.version}{v.version === tpl.version ? ' (current)' : ''}</span>
                    {v.version !== tpl.version ? <button type="button" style={smallBtn} disabled={busy} onClick={() => action('restore', { version: v.version })}><RotateCcw size={12} /> Restore</button> : null}
                  </div>
                ))}
              </div>
            )}

            {diagnostic ? (
              <div style={{ marginTop: 16 }}>
                <CreatorQualityInspector report={diagnostic} />
              </div>
            ) : (
              <div style={{ ...banner, borderColor: '#1f2937', color: '#94a3b8', marginTop: 16, fontSize: 12 }}>
                Generate a preview to produce a Quality Inspector report (required before publishing).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}><label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e5e7eb', marginBottom: 4 }}>{label}</label>{children}</div>;
}

const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px', color: '#f8fafc', fontSize: 14 };
const banner: React.CSSProperties = { border: '1px solid', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 12, background: '#0b1220' };
const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 13, padding: 0 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const smallBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', color: '#93c5fd', border: '1px solid #1e3a8a', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11.5 };
