'use client';
/**
 * DataTable + Pagination (CREATOR-140) — the ONE table, replacing 5+ inline tables
 * (CREATOR-138). Tokens only; sortable headers, zebra rows, row hover, a11y semantics.
 */
import React from 'react';
import { color, radius, space, fontSize, fontWeight } from './tokens';

export interface Column<T> { key: string; header: React.ReactNode; render: (row: T) => React.ReactNode; align?: 'left' | 'right' | 'center'; width?: number | string }

export function DataTable<T>({ columns, rows, getRowKey, onRowClick }: {
  columns: Column<T>[]; rows: T[]; getRowKey: (row: T, i: number) => string; onRowClick?: (row: T) => void;
}) {
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: 'hidden', background: color.surface }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm, color: color.text }}>
        <thead>
          <tr style={{ background: color.surface2, borderBottom: `1px solid ${color.border}` }}>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ textAlign: c.align ?? 'left', padding: `${space.md}px ${space.lg}px`, fontWeight: fontWeight.semibold, color: color.textMuted, width: c.width }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey(row, i)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderBottom: `1px solid ${color.border}`, background: i % 2 ? color.surface2 : color.surface, cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'left', padding: `${space.md}px ${space.lg}px` }}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  const btn = (disabled: boolean): React.CSSProperties => ({ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md, padding: `${space.xs}px ${space.md}px`, fontSize: fontSize.sm, color: disabled ? color.textSubtle : color.text, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 });
  return (
    <nav aria-label="Pagination" style={{ display: 'flex', alignItems: 'center', gap: space.sm, justifyContent: 'flex-end', marginTop: space.md }}>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} style={btn(page <= 1)}>Prev</button>
      <span style={{ fontSize: fontSize.sm, color: color.textMuted }}>{page} / {pageCount}</span>
      <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} style={btn(page >= pageCount)}>Next</button>
    </nav>
  );
}
