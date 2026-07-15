/**
 * W5-5 — minimal fixed-height list windowing (no new dependency).
 *
 * For long flat lists with uniform row heights: renders only the rows in
 * (and around) the scroll viewport. Deliberately NOT a general virtualizer —
 * variable heights, grids, and sticky sections should get a real library
 * when profiling justifies it (audit W5-5 guidance: never virtualize small
 * collections; the audit's big candidates — inbox, member tables, calendar —
 * have variable-height rows and stay unvirtualized pending profiling).
 *
 * Usage:
 *   const v = useWindowedList({ count: items.length, rowHeight: 56, viewportHeight: 400 });
 *   <div ref={v.containerRef} style={v.containerStyle}>
 *     <div style={v.spacerStyle}>
 *       {items.slice(v.start, v.end).map((item, i) => (
 *         <div key={...} style={v.rowStyle(v.start + i)}>…</div>
 *       ))}
 *     </div>
 *   </div>
 */
import { useCallback, useRef, useState, type CSSProperties } from 'react';

export function useWindowedList(opts: {
  count: number;
  rowHeight: number;
  viewportHeight: number;
  overscan?: number;
  /** Below this count, windowing disables itself (render everything). */
  threshold?: number;
}) {
  const { count, rowHeight, viewportHeight } = opts;
  const overscan = opts.overscan ?? 5;
  const threshold = opts.threshold ?? 50;
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  const active = count > threshold;
  const start = active ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0;
  const visible = active ? Math.ceil(viewportHeight / rowHeight) + overscan * 2 : count;
  const end = Math.min(count, start + visible);

  return {
    active,
    start,
    end,
    containerRef,
    onScroll,
    containerStyle: {
      height: viewportHeight,
      overflowY: 'auto' as const,
      position: 'relative' as const,
    } satisfies CSSProperties,
    spacerStyle: {
      height: count * rowHeight,
      position: 'relative' as const,
    } satisfies CSSProperties,
    rowStyle: (index: number): CSSProperties => ({
      position: 'absolute',
      top: index * rowHeight,
      left: 0,
      right: 0,
      height: rowHeight,
    }),
  };
}
