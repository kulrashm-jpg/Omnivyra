'use client';
/**
 * TemplateDiscovery (CREATOR-144) — the ONE canonical Template Discovery experience.
 * Same UI for every scope (SYSTEM/MARKETPLACE/ORG/PERSONAL/AI/RECENT/FAVORITES/
 * COLLECTIONS); the scope changes only the DATA (RULE 3). Grid/list, search, category,
 * sort, quick + detailed preview (RULE 6). Selection returns template_id ONLY (RULE 7).
 * Platform tokens + primitives only (RULE 5). Replaces SampleGallery + the per-feature
 * browsers/galleries — those become thin scope-configured uses of this.
 */
import React from 'react';
import { Check, Sparkles, Image as ImageIcon, Layers, BarChart3, LayoutGrid, List as ListIcon, Lock, Wand2, ArrowLeft } from 'lucide-react';
import type { CreatorTemplate, TemplateAssetFamily } from '../../lib/creator-templates/types';
import { color, radius, shadow, space, fontSize, fontWeight, Modal, SearchBar, EmptySearch, PageHeader } from '../../lib/platform/ui';
import {
  type DiscoveryScope, type DiscoverySort, type DiscoveryView, type ScopeSource,
  applyDiscovery, defaultScopeSources, categoriesOf, SCOPE_LABEL,
} from '../../lib/creator-outcomes/templateDiscovery';

const ASSET_ICON: Record<string, React.ReactNode> = { image: <ImageIcon size={13} />, carousel: <Layers size={13} />, infographic: <BarChart3 size={13} /> };
const families = (t: CreatorTemplate): string[] => { const f = t.metadata?.supportedFamilies; return Array.isArray(f) && f.length ? (f as string[]) : [t.assetFamily]; };

const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space.sm, background: color.primary[600], color: color.onPrimary, border: 'none', borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, cursor: 'pointer', fontWeight: fontWeight.bold, fontSize: fontSize.sm };
const chip = (active: boolean): React.CSSProperties => ({ padding: `${space.xs}px ${space.md}px`, borderRadius: radius.full, border: `1px solid ${active ? color.primary[600] : color.border}`, background: active ? color.primary[600] : color.surface, color: active ? color.onPrimary : color.textMuted, cursor: 'pointer', fontSize: fontSize.sm, fontWeight: fontWeight.medium });

function Card({ t, recommended, onSelect, onDetails }: { t: CreatorTemplate; recommended?: boolean; onSelect: () => void; onDetails: () => void }) {
  const preview = t.preview.thumbnailUrl;
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.xl, background: color.surface, boxShadow: shadow.sm, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button type="button" onClick={onDetails} title="Preview" style={{ aspectRatio: '4 / 3', background: color.surface2, borderBottom: `1px solid ${color.border}`, border: 'none', padding: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', width: '100%' }}>
        {preview ? <img src={preview} alt={t.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <ImageIcon size={24} color={color.borderStrong} aria-label="Preview" />}
        {recommended ? <span style={{ position: 'absolute', top: space.sm, left: space.sm, display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.success, color: color.onPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.bold, borderRadius: radius.full, padding: `3px ${space.sm}px` }}><Sparkles size={11} /> Recommended</span> : null}
      </button>
      <div style={{ padding: `${space.md}px ${space.lg}px`, display: 'flex', flexDirection: 'column', gap: space.sm, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <div style={{ fontSize: fontSize.base, fontWeight: fontWeight.bold, color: color.text }}>{t.name}</div>
          <div style={{ display: 'inline-flex', gap: space.xs, color: color.textSubtle }}>{families(t).map((f) => <span key={f}>{ASSET_ICON[f]}</span>)}</div>
        </div>
        <div style={{ fontSize: fontSize.sm, color: color.textMuted, lineHeight: 1.45, flex: 1 }}>{t.description}</div>
        <button type="button" style={{ ...primaryBtn, justifyContent: 'center' }} onClick={onSelect}><Check size={15} /> Use this</button>
      </div>
    </div>
  );
}

function Row({ t, onSelect, onDetails }: { t: CreatorTemplate; onSelect: () => void; onDetails: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space.lg, border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, padding: space.md }}>
      <button type="button" onClick={onDetails} style={{ width: 64, height: 48, borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${color.border}`, background: color.surface2, padding: 0, cursor: 'pointer', flexShrink: 0 }}>
        {t.preview.thumbnailUrl ? <img src={t.preview.thumbnailUrl} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.text }}>{t.name}</div>
        <div style={{ fontSize: fontSize.xs, color: color.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
      </div>
      <button type="button" style={primaryBtn} onClick={onSelect}><Check size={14} /> Use</button>
    </div>
  );
}

function Details({ t, onUse, onClose }: { t: CreatorTemplate; onUse: () => void; onClose: () => void }) {
  const a = t.adaptation ?? { immutable: [], adaptable: [] };
  const colmn = (label: string, icon: React.ReactNode, items: string[], tone: string) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, fontWeight: fontWeight.bold, fontSize: fontSize.sm, color: tone }}>{icon} {label}</div>
      <ul style={{ margin: `${space.sm}px 0 0`, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {items.map((it) => <li key={it} style={{ display: 'flex', alignItems: 'center', gap: space.xs, fontSize: fontSize.sm, color: color.textMuted, textTransform: 'capitalize' }}><Check size={13} color={tone} /> {it}</li>)}
      </ul>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={t.name} width={680}
      footer={<button type="button" style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }} onClick={onUse}><Check size={16} /> Use this template</button>}>
      {t.preview.thumbnailUrl ? <img src={t.preview.thumbnailUrl} alt={t.name} style={{ width: '100%', borderRadius: radius.lg, border: `1px solid ${color.border}`, marginBottom: space.lg }} /> : null}
      <div style={{ fontSize: fontSize.sm, color: color.textMuted, marginBottom: space.lg }}>{t.description}</div>
      <div style={{ display: 'flex', gap: space.xl, flexWrap: 'wrap' }}>
        {colmn('Preserved', <Lock size={14} />, a.immutable, color.primary[600])}
        {colmn('Adapted to you', <Wand2 size={14} />, a.adaptable, color.success)}
      </div>
    </Modal>
  );
}

export function TemplateDiscovery({ scopes = ['SYSTEM'], initialScope = 'SYSTEM', family, goalId, goalLabel, sources, onSelect, onBack, title = 'Template library', subtitle }: {
  scopes?: DiscoveryScope[];
  initialScope?: DiscoveryScope;
  family?: TemplateAssetFamily;
  goalId?: string | null;
  goalLabel?: string;
  sources?: Partial<Record<DiscoveryScope, ScopeSource>>;
  onSelect: (templateId: string) => void;   // RULE 7 — template_id only
  onBack?: () => void;
  title?: string;
  subtitle?: string;
}) {
  const src = React.useMemo(() => defaultScopeSources(sources), [sources]);
  const [scope, setScope] = React.useState<DiscoveryScope>(initialScope);
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<string | undefined>(undefined);
  const [sort, setSort] = React.useState<DiscoverySort>('recommended');
  const [view, setView] = React.useState<DiscoveryView>('grid');
  const [details, setDetails] = React.useState<CreatorTemplate | null>(null);

  const base = src[scope]({ scope, family, goalId, sort });
  const cats = categoriesOf(base);
  const items = applyDiscovery(base, { scope, family, query, category, sort });
  const q = query.trim();

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: `${space['2xl']}px ${space.xl}px ${space['4xl']}px`, color: color.text }}>
      {onBack ? <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: 'transparent', border: 'none', color: color.primary[600], cursor: 'pointer', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: space.md }}><ArrowLeft size={14} /> Back</button> : null}
      <PageHeader title={title} subtitle={subtitle ?? (goalLabel ? `${goalLabel} — choose a template; we match its look to your content.` : undefined)} />

      {scopes.length > 1 ? (
        <div role="tablist" style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.md }}>
          {scopes.map((s) => <button key={s} role="tab" aria-selected={s === scope} type="button" onClick={() => { setScope(s); setCategory(undefined); }} style={chip(s === scope)}>{SCOPE_LABEL[s]}</button>)}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginBottom: space.lg }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search templates…" />
        {cats.length > 1 ? (
          <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setCategory(undefined)} style={chip(!category)}>All</button>
            {cats.slice(0, 8).map((c) => <button key={c} type="button" onClick={() => setCategory(c)} style={chip(category === c)}>{c}</button>)}
          </div>
        ) : null}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: space.xs }}>
          <button type="button" onClick={() => setSort(sort === 'name' ? 'recommended' : 'name')} style={chip(false)}>{sort === 'name' ? 'A–Z' : 'Recommended'}</button>
          <button type="button" aria-label="Grid view" onClick={() => setView('grid')} style={{ ...chip(view === 'grid'), padding: space.xs }}><LayoutGrid size={16} /></button>
          <button type="button" aria-label="List view" onClick={() => setView('list')} style={{ ...chip(view === 'list'), padding: space.xs }}><ListIcon size={16} /></button>
        </div>
      </div>

      {items.length === 0 ? (
        q ? <EmptySearch query={q} /> : <div style={{ color: color.textSubtle, fontSize: fontSize.sm, padding: space.xl, textAlign: 'center' }}>No templates in {SCOPE_LABEL[scope]} yet.</div>
      ) : view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: space.lg }}>
          {items.map((t, i) => <Card key={t.id} t={t} recommended={!q && !category && scope === 'SYSTEM' && i < 3} onSelect={() => onSelect(t.id)} onDetails={() => setDetails(t)} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          {items.map((t) => <Row key={t.id} t={t} onSelect={() => onSelect(t.id)} onDetails={() => setDetails(t)} />)}
        </div>
      )}

      {details ? <Details t={details} onUse={() => { const id = details.id; setDetails(null); onSelect(id); }} onClose={() => setDetails(null)} /> : null}
    </div>
  );
}
