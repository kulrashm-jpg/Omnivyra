'use client';
/**
 * Layout primitives (CREATOR-140) — the platform layout framework, additive + opt-in
 * (does NOT replace existing screens until they migrate). All values from tokens; zero
 * raw hex/spacing/shadow. Components: AppShell, Sidebar, TopHeader, Breadcrumb,
 * PageContainer, PageHeader, SectionHeader, Toolbar, ActionBar, SplitPanel,
 * InspectorPanel, PreviewPanel.
 */
import React from 'react';
import { color, radius, shadow, space, fontSize, fontWeight, zIndex } from './tokens';

export function AppShell({ sidebar, header, children }: { sidebar?: React.ReactNode; header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: color.surface2, color: color.text }}>
      {sidebar}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {header}
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}

export function Sidebar({ children, width = 240 }: { children: React.ReactNode; width?: number }) {
  return <nav aria-label="Primary" style={{ width, flexShrink: 0, background: color.surface, borderRight: `1px solid ${color.border}`, position: 'sticky', top: 0, height: '100vh', overflow: 'auto', zIndex: zIndex.sticky }}>{children}</nav>;
}

export function TopHeader({ children }: { children: React.ReactNode }) {
  return <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: space.md, padding: `0 ${space.xl}px`, background: color.surface, borderBottom: `1px solid ${color.border}`, position: 'sticky', top: 0, zIndex: zIndex.sticky }}>{children}</header>;
}

export function Breadcrumb({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: space.xs, fontSize: fontSize.sm, color: color.textMuted }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span style={{ color: color.textSubtle }}>/</span> : null}
          {it.onClick ? <button type="button" onClick={it.onClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: i === items.length - 1 ? color.text : color.primary[600], fontSize: fontSize.sm }}>{it.label}</button>
            : <span style={{ color: i === items.length - 1 ? color.text : color.textMuted }}>{it.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function PageContainer({ children, maxWidth = 1200 }: { children: React.ReactNode; maxWidth?: number }) {
  return <div style={{ maxWidth, margin: '0 auto', padding: `${space.xl}px` }}>{children}</div>;
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; breadcrumb?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.lg, marginBottom: space.xl }}>
      <div>
        {breadcrumb ? <div style={{ marginBottom: space.sm }}>{breadcrumb}</div> : null}
        <h1 style={{ fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, margin: 0, color: color.text }}>{title}</h1>
        {subtitle ? <p style={{ fontSize: fontSize.sm, color: color.textMuted, margin: `${space.xs}px 0 0` }}>{subtitle}</p> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: space.sm, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
      <h2 style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, margin: 0, color: color.text }}>{title}</h2>
      {actions ? <div style={{ display: 'flex', gap: space.sm }}>{actions}</div> : null}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div role="toolbar" style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px`, background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg }}>{children}</div>;
}

export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space.sm, padding: `${space.md}px ${space.xl}px`, borderTop: `1px solid ${color.border}`, background: color.surface, position: 'sticky', bottom: 0, zIndex: zIndex.sticky }}>{children}</div>;
}

export function SplitPanel({ left, right, leftWidth = 320 }: { left: React.ReactNode; right: React.ReactNode; leftWidth?: number }) {
  return (
    <div style={{ display: 'flex', gap: space.lg, alignItems: 'flex-start' }}>
      <div style={{ width: leftWidth, flexShrink: 0 }}>{left}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{right}</div>
    </div>
  );
}

export function InspectorPanel({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return <aside aria-label="Inspector" style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: shadow.sm, padding: space.lg }}>
    {title ? <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.textMuted, marginBottom: space.md, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div> : null}
    {children}
  </aside>;
}

export function PreviewPanel({ children }: { children: React.ReactNode }) {
  return <div style={{ background: color.surface2, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: space.xl, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>{children}</div>;
}
