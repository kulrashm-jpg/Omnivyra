/**
 * F3 test helper: is `marker` inside an open `<gate> && (` … `)` group in `src`?
 * Paren-balanced scan, so it follows multi-line JSX. Throws if the marker is missing,
 * so a renamed control fails loudly instead of passing vacuously.
 */
export function insideWriteGate(src: string, marker: string, gate = 'canWriteThisCampaign'): boolean {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const OPEN = `${gate} && (`;
  let from = 0;
  for (;;) {
    const o = src.indexOf(OPEN, from);
    if (o < 0 || o > at) return false;
    let depth = 0;
    let i = o + OPEN.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (at > o && at < i) return true;
    from = o + OPEN.length;
  }
}
