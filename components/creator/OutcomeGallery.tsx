'use client';
/**
 * OutcomeGallery (CREATOR-UX-001) — the outcome-first replacement for the template
 * marketplace grid. ONE outcome per screen: a dominant preview (the real finished sample
 * asset), a plain-language summary ("what it creates" / "when to use it"), and a single
 * primary action. The user browses OUTCOMES (Next / Previous / Jump / Search), never cards.
 *
 * No template terminology on the primary screen — no variant/template-id/layout/family/
 * renderer/category/style badges. Every internal detail lives behind "Learn more". Comparison
 * is opt-in (hidden until the user presses Compare). Exactly ONE recommendation, shown as
 * "Recommended for your campaign" above the recommended outcome only.
 *
 * It reuses the canonical discovery data pipeline (systemScopeSource + applyDiscovery) and the
 * platform UI tokens; it does NOT reimplement filtering, and it leaves the canonical
 * TemplateDiscovery power-browser untouched.
 */
import React from 'react';
import { Check, ChevronLeft, ChevronRight, Search, GitCompare, Info, LayoutList, X, Sparkles, ArrowLeft } from 'lucide-react';
import type { CreatorTemplate, TemplateAssetFamily } from '../../lib/creator-templates/types';
import { color, radius, shadow, space, fontSize, fontWeight, Modal, SearchBar } from '../../lib/platform/ui';
import { systemScopeSource, applyDiscovery } from '../../lib/creator-outcomes/templateDiscovery';

const TYPE_LABEL: Record<string, string> = { image: 'Image post', carousel: 'Carousel', infographic: 'Infographic' };
const TYPE_INDEF: Record<string, string> = { image: 'An image post', carousel: 'A multi-slide carousel', infographic: 'An infographic' };

const friendlyType = (family: TemplateAssetFamily | undefined, t: CreatorTemplate) => TYPE_LABEL[family ?? t.assetFamily] ?? 'Marketing asset';
const friendlyTypeIndef = (family: TemplateAssetFamily | undefined, t: CreatorTemplate) => TYPE_INDEF[family ?? t.assetFamily] ?? 'A marketing asset';

/** Plain-language "when to use it" from the real audience/industry tags (never fabricated). */
function whenToUse(t: CreatorTemplate): string {
  const md = (t.metadata ?? {}) as Record<string, unknown>;
  const ind = (Array.isArray(md.industryTags) ? (md.industryTags as string[]) : []).filter(Boolean);
  const aud = (Array.isArray(md.audienceTags) ? (md.audienceTags as string[]) : []).filter(Boolean);
  if (ind.length || aud.length) {
    const bits: string[] = [];
    if (ind.length) bits.push(ind.slice(0, 3).join(', '));
    if (aud.length) bits.push(`speaks to ${aud.slice(0, 3).join(', ')}`);
    return `Best for ${bits.join(' — ')}.`;
  }
  const tags = (t.tags ?? []).filter(Boolean);
  return tags.length ? `Best for ${tags.slice(0, 4).join(', ')}.` : 'A versatile look that fits most campaigns.';
}

const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: space.sm, background: color.primary[600], color: color.onPrimary, border: 'none', borderRadius: radius.md, padding: `${space.md}px ${space.xl}px`, cursor: 'pointer', fontWeight: fontWeight.bold, fontSize: fontSize.base };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space.xs, background: 'transparent', border: `1px solid ${color.border}`, borderRadius: radius.md, padding: `${space.sm}px ${space.md}px`, cursor: 'pointer', color: color.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium };
const arrowBtn = (disabled: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: radius.full, border: `1px solid ${color.border}`, background: color.surface, boxShadow: shadow.sm, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, color: color.text, flexShrink: 0 });

function PreviewImage({ t, label }: { t: CreatorTemplate; label: string }) {
  return t.preview?.thumbnailUrl
    ? <img src={t.preview.thumbnailUrl} alt={label} decoding="async" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: radius.lg, boxShadow: shadow.md, background: color.surface }} />
    : <div style={{ color: color.textSubtle, fontSize: fontSize.sm }}>Preview unavailable</div>;
}

export function OutcomeGallery({ goalId, goalLabel, family, onUse, onBack }: {
  goalId?: string | null;
  goalLabel?: string;
  family?: TemplateAssetFamily;
  onUse: (template: CreatorTemplate) => void;
  onBack?: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const [jumpOpen, setJumpOpen] = React.useState(false);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [learnOpen, setLearnOpen] = React.useState(false);

  const base = React.useMemo(() => systemScopeSource({ scope: 'SYSTEM', family, goalId, sort: 'recommended' }), [family, goalId]);
  const items = React.useMemo(() => applyDiscovery(base, { scope: 'SYSTEM', family, goalId, query, sort: 'recommended' }), [base, family, goalId, query]);
  const recommendedId = base[0]?.id ?? null; // the single, top-recommended outcome

  React.useEffect(() => { setIndex(0); }, [query, family, goalId]);
  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i));
  const go = React.useCallback((d: number) => setIndex((i) => clamp(i + d)), [items.length]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (jumpOpen || compareOpen || learnOpen) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, jumpOpen, compareOpen, learnOpen]);

  const t = items[index];
  const isRecommended = t && t.id === recommendedId;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: `${space.lg}px ${space.xl}px`, color: color.text, display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 96px)' }}>
      {/* Top bar (minimal): back + counter + search/jump. ~ part of the 5% actions band. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.sm, flex: '0 0 auto' }}>
        {onBack ? <button type="button" onClick={onBack} style={{ ...ghostBtn, border: 'none', color: color.primary[600], fontWeight: fontWeight.semibold }}><ArrowLeft size={15} /> Back</button> : null}
        <div style={{ marginLeft: onBack ? 0 : 'auto', color: color.textSubtle, fontSize: fontSize.sm }}>{goalLabel ? `${goalLabel} · ` : ''}{items.length ? `Outcome ${index + 1} of ${items.length}` : 'No matches'}</div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: space.xs }}>
          <button type="button" onClick={() => setJumpOpen(true)} style={ghostBtn}><Search size={15} /> Search</button>
          <button type="button" onClick={() => setJumpOpen(true)} style={ghostBtn}><LayoutList size={15} /> Jump to outcome</button>
        </div>
      </div>

      {!t ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color.textSubtle }}>
          No outcomes match “{query}”. <button type="button" onClick={() => setQuery('')} style={{ ...ghostBtn, marginLeft: space.sm }}>Clear search</button>
        </div>
      ) : (
        <>
          {/* Recommendation line — ONE, only above the recommended outcome. */}
          <div style={{ minHeight: 26, marginBottom: space.xs, flex: '0 0 auto' }}>
            {isRecommended && !query ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.success, color: color.onPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold, borderRadius: radius.full, padding: `4px ${space.md}px` }}>
                <Sparkles size={13} /> Recommended for your campaign
              </span>
            ) : null}
          </div>

          {/* PREVIEW — dominant (~80%). The example IS the explanation. */}
          <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: space.md, minHeight: '58vh' }}>
            <button type="button" aria-label="Previous outcome" disabled={index === 0} onClick={() => go(-1)} style={arrowBtn(index === 0)}><ChevronLeft size={22} /></button>
            <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: color.surface2, borderRadius: radius.xl, border: `1px solid ${color.border}`, padding: space.xl, overflow: 'hidden' }}>
              <PreviewImage t={t} label={`${friendlyType(family, t)} example`} />
            </div>
            <button type="button" aria-label="Next outcome" disabled={index >= items.length - 1} onClick={() => go(1)} style={arrowBtn(index >= items.length - 1)}><ChevronRight size={22} /></button>
          </div>

          {/* SUMMARY (~15%) — plain language only. */}
          <div style={{ flex: '0 0 auto', marginTop: space.lg, display: 'flex', flexDirection: 'column', gap: space.xs }}>
            <div style={{ fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textSubtle }}>What you'll create</div>
            <div style={{ fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: color.text, lineHeight: 1.15 }}>{friendlyTypeIndef(family, t)} — {t.description}</div>
            <div style={{ fontSize: fontSize.base, color: color.textMuted, lineHeight: 1.45 }}>{whenToUse(t)}</div>
          </div>

          {/* ACTIONS (~5%) — one primary; everything optional/secondary. */}
          <div style={{ flex: '0 0 auto', marginTop: space.lg, display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
            <button type="button" style={primaryBtn} onClick={() => onUse(t)}><Check size={17} /> Use this outcome</button>
            <button type="button" style={ghostBtn} onClick={() => go(-1)} disabled={index === 0}><ChevronLeft size={15} /> Previous</button>
            <button type="button" style={ghostBtn} onClick={() => go(1)} disabled={index >= items.length - 1}>Next <ChevronRight size={15} /></button>
            <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: space.xs }}>
              <button type="button" style={ghostBtn} onClick={() => setCompareOpen(true)}><GitCompare size={15} /> Compare</button>
              <button type="button" style={ghostBtn} onClick={() => setLearnOpen(true)}><Info size={15} /> Learn more</button>
            </div>
          </div>
        </>
      )}

      {/* Jump / Search overlay — the ONLY list, opt-in. */}
      {jumpOpen ? (
        <Modal open onClose={() => setJumpOpen(false)} title="Jump to an outcome" width={680}>
          <div style={{ marginBottom: space.md }}><SearchBar value={query} onChange={setQuery} placeholder="Search outcomes…" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: space.md, maxHeight: '52vh', overflowY: 'auto' }}>
            {items.map((it, i) => (
              <button key={it.id} type="button" onClick={() => { setIndex(i); setJumpOpen(false); }} style={{ textAlign: 'left', border: `1px solid ${i === index ? color.primary[600] : color.border}`, borderRadius: radius.lg, overflow: 'hidden', background: color.surface, cursor: 'pointer', padding: 0 }}>
                <div style={{ aspectRatio: '4 / 3', background: color.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {it.preview?.thumbnailUrl ? <img src={it.preview.thumbnailUrl} alt={it.description} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </div>
                <div style={{ padding: `${space.xs}px ${space.sm}px`, fontSize: fontSize.xs, color: color.textMuted, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description}</div>
              </button>
            ))}
          </div>
        </Modal>
      ) : null}

      {/* Compare overlay — opt-in only. Current outcome + its neighbours, side by side. */}
      {compareOpen && t ? (
        <Modal open onClose={() => setCompareOpen(false)} title="Compare outcomes" width={860}>
          <div style={{ display: 'flex', gap: space.lg }}>
            {[items[index], items[index + 1], items[index + 2]].filter(Boolean).map((it) => (
              <div key={(it as CreatorTemplate).id} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.sm }}>
                <div style={{ aspectRatio: '4 / 3', background: color.surface2, borderRadius: radius.lg, border: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {(it as CreatorTemplate).preview?.thumbnailUrl ? <img src={(it as CreatorTemplate).preview.thumbnailUrl} alt={(it as CreatorTemplate).description} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </div>
                <div style={{ fontSize: fontSize.sm, color: color.textMuted, lineHeight: 1.4 }}>{(it as CreatorTemplate).description}</div>
                <button type="button" style={{ ...primaryBtn, padding: `${space.sm}px ${space.md}px`, fontSize: fontSize.sm }} onClick={() => { onUse(it as CreatorTemplate); setCompareOpen(false); }}><Check size={14} /> Use this one</button>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {/* Learn more — the ONLY place internal/technical detail appears. */}
      {learnOpen && t ? (
        <Modal open onClose={() => setLearnOpen(false)} title="About this outcome" width={620}
          footer={<button type="button" style={{ ...primaryBtn, width: '100%' }} onClick={() => { onUse(t); setLearnOpen(false); }}><Check size={16} /> Use this outcome</button>}>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: `${space.sm}px ${space.lg}px`, fontSize: fontSize.sm }}>
            <dt style={{ color: color.textSubtle }}>What it creates</dt><dd style={{ margin: 0, color: color.text }}>{friendlyType(family, t)}</dd>
            <dt style={{ color: color.textSubtle }}>Visual style</dt><dd style={{ margin: 0, color: color.text }}>{t.name}{t.category ? ` · ${t.category}` : ''}</dd>
            <dt style={{ color: color.textSubtle }}>Stays the same</dt><dd style={{ margin: 0, color: color.textMuted, textTransform: 'capitalize' }}>{(t.adaptation?.immutable ?? []).join(', ') || '—'}</dd>
            <dt style={{ color: color.textSubtle }}>Personalised to you</dt><dd style={{ margin: 0, color: color.textMuted, textTransform: 'capitalize' }}>{(t.adaptation?.adaptable ?? []).join(', ') || '—'}</dd>
            <dt style={{ color: color.textSubtle }}>Tags</dt><dd style={{ margin: 0, color: color.textMuted }}>{(t.tags ?? []).join(', ') || '—'}</dd>
            <dt style={{ color: color.textSubtle }}>Reference</dt><dd style={{ margin: 0, color: color.textSubtle, fontSize: fontSize.xs }}>{t.id}</dd>
          </dl>
        </Modal>
      ) : null}
    </div>
  );
}
