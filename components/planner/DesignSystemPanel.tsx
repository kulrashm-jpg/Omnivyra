import React from 'react';
import { useRouter } from 'next/router';
import { Layers, Sparkles, CheckCircle2, AlertTriangle, Settings2, Wand2 } from 'lucide-react';
import { familyForCreatorType, type TemplateAssetFamily, type CreatorTemplate } from '../../lib/creator-templates';
import {
  evaluateDesignSystemCoverage,
  coverageWarnings,
  type RequestedFamilyFrequency,
} from '../../lib/creator-templates/designSystemCoverage';
import { buildManageGalleryHref } from '../../lib/creator-templates/designSystemManage';

/**
 * Campaign Planner — Design System step (CREATOR-029).
 *
 * The campaign owns exactly ONE Design System (one pinned collection). This panel
 * SURFACES it and reuses the existing services end-to-end — it never stores template
 * ids itself, never builds another picker, and never adds another recommendation
 * engine:
 *   • per-family count + coverage + Manage  → existing Collection editor (members)
 *   • Generate Design System from Brief      → existing createAiCollection + attach
 *   • coverage validation                    → evaluateDesignSystemCoverage (shared)
 * Manual + AI always modify the SAME collection. The AI badge clears once the
 * collection is manually edited (its version moves past 1).
 */

// The template-backed asset families (banner renders via 'image'; PDF is not a
// template family yet, so it is intentionally not part of the Design System).
const SUPPORTED_FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
const FAMILY_LABEL: Record<string, string> = { image: 'Images / Banner', carousel: 'Carousel', infographic: 'Infographic' };

interface Props {
  campaignId: string;
  companyId: string;
  /** Requested families + frequency (from the campaign plan) for coverage validation. */
  requestedFamilies?: RequestedFamilyFrequency[];
}

interface DesignSystemState {
  collectionId: string;
  collectionName: string;
  version: number;
  templates: CreatorTemplate[];
}

export default function DesignSystemPanel({ campaignId, companyId, requestedFamilies = [] }: Props) {
  const router = useRouter();
  const [ds, setDs] = React.useState<DesignSystemState | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [brief, setBrief] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [coverageAck, setCoverageAck] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!campaignId) return;
    setError(null);
    try {
      const r = await fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}`);
      if (!r.ok) { setDs(null); setLoaded(true); return; }
      const d = await r.json();
      const collectionId = d?.designSystem?.collectionId as string | undefined;
      if (!collectionId) { setDs(null); setLoaded(true); return; }
      // Resolve the collection's members for per-family counts + version (badge).
      const cr = await fetch(`/api/creator-templates/collections/${encodeURIComponent(collectionId)}`);
      const cd = cr.ok ? await cr.json() : null;
      setDs({
        collectionId,
        collectionName: cd?.collection?.name ?? d.designSystem.pinnedSnapshot?.name ?? 'Design System',
        version: Number(cd?.collection?.version ?? d.designSystem.pinnedVersion ?? 1),
        templates: Array.isArray(cd?.templates) ? cd.templates : [],
      });
    } catch { setDs(null); } finally { setLoaded(true); }
  }, [campaignId]);
  React.useEffect(() => { void load(); }, [load]);
  // Coverage refreshes after Design System edits — re-fetch when the user returns
  // to the planner from the gallery (window regains focus).
  React.useEffect(() => {
    const onFocus = () => { void load(); };
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus); };
  }, [load]);

  const countByFamily = React.useMemo(() => {
    const m: Partial<Record<TemplateAssetFamily, number>> = {};
    for (const t of ds?.templates ?? []) m[t.assetFamily] = (m[t.assetFamily] ?? 0) + 1;
    return m;
  }, [ds]);

  // Families to display: the supported base plus any extra family the collection carries.
  const families = React.useMemo(() => {
    const extra = Object.keys(countByFamily).filter((f) => !SUPPORTED_FAMILIES.includes(f as TemplateAssetFamily)) as TemplateAssetFamily[];
    return [...SUPPORTED_FAMILIES, ...extra];
  }, [countByFamily]);

  const coverage = React.useMemo(
    () => evaluateDesignSystemCoverage({ requestedFamilies, selectedCountByFamily: countByFamily }),
    [requestedFamilies, countByFamily],
  );
  const aiBadge = !!ds && ds.version === 1; // AI collections are born complete at v1; a manual edit bumps the version.

  async function attach(collectionId: string) {
    const res = await fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, collection_id: collectionId }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d?.validation?.errors || [d?.error]).filter(Boolean).join(' ') || 'Attach failed'); }
  }

  async function generateFromBrief() {
    if (busy || !brief.trim()) return; setBusy(true); setError(null);
    try {
      const r = await fetch('/api/creator-templates/collections/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, prompt: brief.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d?.collection?.id) throw new Error(d?.error || 'Generation failed');
      await attach(d.collection.id);     // the generated collection BECOMES the design system
      setBrief('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Generation failed'); } finally { setBusy(false); }
  }

  async function startManual() {
    if (busy) return; setBusy(true); setError(null);
    try {
      // One empty collection → attach as the design system → Manage adds templates.
      const r = await fetch('/api/creator-templates/collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name: 'Campaign Design System' }),
      });
      const d = await r.json();
      if (!r.ok || !d?.collection?.id) throw new Error(d?.error || 'Could not create design system');
      await attach(d.collection.id);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create design system'); } finally { setBusy(false); }
  }

  const manage = (family?: TemplateAssetFamily) => {
    if (!ds) return;
    // Open the CANONICAL Template Gallery in campaign mode — it multi-selects
    // directly into this collection (the Design System). No member editor, no
    // second picker. "Manage All" defaults to a family; the gallery's family
    // switcher covers the rest.
    let returnTo = '/campaign-planner?tab=design';
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'design');
      returnTo = url.pathname + url.search;
    }
    router.push(buildManageGalleryHref({ family: family ?? 'carousel', collectionId: ds.collectionId, campaignId, returnTo }));
  };

  if (!campaignId || !companyId) {
    return <div style={S.hint}>Save the campaign first — a Design System is owned by a campaign.</div>;
  }
  if (!loaded) return <div style={S.hint}>Loading Design System…</div>;

  return (
    <div style={S.wrap}>
      <div style={S.headerRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Layers size={20} color="#6366f1" />
          <div>
            <div style={S.title}>Design System</div>
            <div style={S.sub}>The campaign owns one Design System. Every generated asset picks its best-fit template from it.</div>
          </div>
        </div>
        {ds && aiBadge ? <span style={S.aiBadge}><Sparkles size={12} /> AI-generated</span> : null}
      </div>

      {error ? <div style={S.err}>{error}</div> : null}

      {!ds ? (
        /* Empty state */
        <div style={S.card}>
          <div style={S.cardTitle}>No Design System yet</div>
          <div style={S.cardSub}>Generate one from a brief, or start an empty system and add templates per family.</div>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Describe the campaign so AI can assemble a matching set of templates (e.g. ‘bold B2B SaaS launch — carousels, stat cards, infographics’)"
            rows={3} style={S.textarea} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" onClick={generateFromBrief} disabled={busy || !brief.trim()} style={S.primary}><Wand2 size={14} /> {busy ? 'Generating…' : 'Generate Design System from Brief'}</button>
            <button type="button" onClick={startManual} disabled={busy} style={S.ghost}><Settings2 size={14} /> Start empty &amp; add manually</button>
          </div>
        </div>
      ) : (
        <>
          {/* Coverage validation — non-blocking warning */}
          {!coverage.ok && !coverageAck ? (
            <div style={S.warn}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}><AlertTriangle size={15} /> Coverage gaps</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                {coverageWarnings(coverage).map((w) => <li key={w}>{w}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => manage()} style={S.primarySm}>Manage Templates</button>
                <button type="button" onClick={() => setCoverageAck(true)} style={S.ghostSm}>Continue Anyway</button>
              </div>
            </div>
          ) : null}

          {/* Per-family rows */}
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={S.cardTitle}>{ds.collectionName}</div>
              <button type="button" onClick={() => manage()} style={S.ghostSm}><Settings2 size={13} /> Manage all</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {families.map((fam) => {
                const count = countByFamily[fam] ?? 0;
                const requested = requestedFamilies.find((r) => r.family === fam && r.frequency > 0);
                const gap = !!requested && count === 0;
                return (
                  <div key={fam} style={S.famRow}>
                    <div>
                      <div style={S.famName}>{FAMILY_LABEL[fam] ?? fam}</div>
                      <div style={S.famMeta}>
                        {count === 0 ? <span style={{ color: gap ? '#f59e0b' : '#94a3b8' }}>{gap ? 'Requested · 0 templates' : 'No templates'}</span>
                          : <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={12} /> {count} template{count === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => manage(fam)} style={S.ghostSm}>Manage</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" onClick={() => manage()} style={S.ghost}><Settings2 size={14} /> Manage templates</button>
            <details style={{ flex: 1, minWidth: 260 }}>
              <summary style={S.regenSummary}><Wand2 size={13} /> Regenerate from a new brief</summary>
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="New brief — replaces the current Design System with an AI-generated one" rows={2} style={S.textarea} />
              <button type="button" onClick={generateFromBrief} disabled={busy || !brief.trim()} style={{ ...S.primarySm, marginTop: 8 }}>{busy ? 'Generating…' : 'Generate'}</button>
            </details>
          </div>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: 16 },
  hint: { padding: 20, color: '#64748b', fontSize: 13 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  title: { fontSize: 16, fontWeight: 800, color: '#0f172a' },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  aiBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#6d28d9', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '3px 10px' },
  err: { marginTop: 12, color: '#b91c1c', fontSize: 13, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 8, padding: 10 },
  card: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff', marginTop: 12 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  cardSub: { fontSize: 12.5, color: '#64748b', marginTop: 3 },
  textarea: { width: '100%', boxSizing: 'border-box', marginTop: 10, border: '1px solid #d1d5db', borderRadius: 8, padding: 10, fontSize: 13, color: '#0f172a', resize: 'vertical' },
  primary: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  primarySm: { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' },
  ghost: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 13px', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  ghostSm: { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 8, padding: '5px 11px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' },
  warn: { marginTop: 12, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, padding: 12, color: '#92400e', fontSize: 12.5 },
  famRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eef2f7', borderRadius: 10, padding: '9px 12px' },
  famName: { fontSize: 13.5, fontWeight: 600, color: '#0f172a' },
  famMeta: { fontSize: 11.5, marginTop: 2 },
  regenSummary: { fontSize: 12.5, color: '#4338ca', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 },
};
