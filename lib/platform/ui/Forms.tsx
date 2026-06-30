'use client';
/**
 * Form + search + filter primitives (CREATOR-140). Tokens only; consistent inputs,
 * focus ring (focusRing token), and layout rhythm. Components: SearchBar, FilterBar,
 * FormLayout, FormField, PropertyGrid, EmptySearch, WizardLayout.
 */
import React from 'react';
import { color, radius, space, fontSize, fontWeight, focusRing } from './tokens';

const inputBase: React.CSSProperties = { background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md, padding: `${space.sm}px ${space.md}px`, fontSize: fontSize.sm, color: color.text, outline: 'none', width: '100%' };

export function SearchBar({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [f, setF] = React.useState(false);
  return <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} onFocus={() => setF(true)} onBlur={() => setF(false)}
    style={{ ...inputBase, maxWidth: 360, boxShadow: f ? `0 0 0 ${focusRing.width}px ${focusRing.color}33` : 'none', borderColor: f ? focusRing.color : color.border }} />;
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div role="group" aria-label="Filters" style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', padding: `${space.sm}px 0` }}>{children}</div>;
}

export function FormLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gap: space.lg }}>{children}</div>;
}

export function FormField({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: space.xs }}>
      <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.text }}>{label}{required ? <span style={{ color: color.danger }}> *</span> : null}</span>
      {children}
      {error ? <span style={{ fontSize: fontSize.xs, color: color.danger }}>{error}</span> : hint ? <span style={{ fontSize: fontSize.xs, color: color.textSubtle }}>{hint}</span> : null}
    </label>
  );
}

export function PropertyGrid({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, margin: 0 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: space.md, padding: `${space.sm}px 0`, borderBottom: `1px solid ${color.surface2}`, fontSize: fontSize.sm }}>
          <dt style={{ color: color.textMuted }}>{it.label}</dt>
          <dd style={{ color: color.text, fontWeight: fontWeight.medium, textAlign: 'right', margin: 0 }}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptySearch({ query }: { query: string }) {
  return <div style={{ color: color.textSubtle, fontSize: fontSize.sm, padding: space.xl, textAlign: 'center' }}>No results match “{query}”.</div>;
}

export function WizardLayout({ steps, current, children }: { steps: string[]; current: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: space.xl }}>
      <ol style={{ display: 'flex', gap: space.sm, listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((s, i) => (
          <li key={s} aria-current={i === current ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: space.xs, fontSize: fontSize.sm, fontWeight: i === current ? fontWeight.semibold : fontWeight.normal, color: i === current ? color.primary[600] : i < current ? color.text : color.textSubtle }}>
            <span style={{ width: 22, height: 22, borderRadius: radius.full, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: i <= current ? color.primary[600] : color.border, color: i <= current ? color.onPrimary : color.textSubtle, fontSize: fontSize.xs }}>{i + 1}</span>
            {s}
            {i < steps.length - 1 ? <span style={{ color: color.textSubtle, marginLeft: space.xs }}>›</span> : null}
          </li>
        ))}
      </ol>
      <div>{children}</div>
    </div>
  );
}
