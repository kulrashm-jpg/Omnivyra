/**
 * Resilient selector resolver for Playwright-driven RPA.
 *
 * Contract:
 *  - Callers supply a prioritized list of candidate selectors (CSS, XPath,
 *    or role-based queryables). The resolver tries each with a short
 *    per-attempt timeout, rotating up to `retries` times with jittered
 *    backoff. If none match, it falls back to a text-heuristic pass:
 *    scan all visible elements for substring matches against
 *    `textHeuristics`.
 *
 *  - Returns the first matching element's ElementHandle, or null.
 *
 * Selector descriptor:
 *   { kind: 'css' | 'xpath' | 'role' | 'text', value: string, role?: string, name?: string }
 *
 * The shape is intentionally broad so scripts can mix strategies. `role`
 * maps to Playwright's getByRole; `text` uses getByText (partial match).
 */

export type ResolverCandidate =
  | string
  | { kind: 'css'; value: string }
  | { kind: 'xpath'; value: string }
  | { kind: 'role'; role: string; name?: string | RegExp }
  | { kind: 'text'; value: string; exact?: boolean }
  /**
   * i18n-aware text/role lookup. The `semanticKey` is looked up in the
   * i18n map below and expanded to the localized strings + a role
   * fallback. Prefer this over raw text matches for UI affordances that
   * render in the user's locale (Like / Comment / Send / Reply etc).
   */
  | { kind: 'i18n'; semanticKey: SemanticKey; role?: string };

export type ResolveOptions = {
  retries?: number;          // default 3
  perAttemptMs?: number;     // default 4000
  backoffMs?: number;        // default 400
  textHeuristics?: string[]; // final-fallback text fragments to scan the DOM for
  semanticFallbacks?: SemanticKey[]; // i18n semantic keys for final-fallback
  visibleOnly?: boolean;     // default true
};

/**
 * Semantic affordance keys + their localized surface strings across
 * major locales. Extended as needed. The resolver expands an `i18n`
 * candidate into one `getByText` attempt per locale string plus a role
 * fallback (`getByRole('button', { name: /like|gefällt/i })` etc).
 *
 * Covered locales: en, de, es, fr, pt, it, nl, ja, zh-CN.
 */
export type SemanticKey =
  | 'like' | 'unlike'
  | 'comment' | 'reply'
  | 'send' | 'post' | 'publish'
  | 'message'
  | 'follow' | 'following'
  | 'search';

export const I18N_MAP: Record<SemanticKey, string[]> = {
  like:     ['Like', 'Gefällt mir', 'Me gusta', "J'aime", 'Gosto', 'Mi piace', 'Vind ik leuk', 'いいね', '点赞'],
  unlike:   ['Unlike', 'Gefällt mir nicht mehr', 'Ya no me gusta', "Je n'aime plus", 'Não gosto', 'Non mi piace più', 'Niet leuk meer', 'いいね！を取り消す', '取消点赞'],
  comment:  ['Comment', 'Kommentar', 'Kommentieren', 'Comentar', 'Commenter', 'Commento', 'Reageer', 'コメント', '评论'],
  reply:    ['Reply', 'Antworten', 'Responder', 'Répondre', 'Rispondi', 'Beantwoorden', '返信', '回复'],
  send:     ['Send', 'Senden', 'Enviar', 'Envoyer', 'Invia', 'Verzenden', '送信', '发送'],
  post:     ['Post', 'Posten', 'Publicar', 'Publier', 'Pubblica', 'Plaatsen', '投稿', '发布'],
  publish:  ['Publish', 'Veröffentlichen', 'Publicar', 'Publier', 'Pubblica', 'Publiceren', '公開', '发布'],
  message:  ['Message', 'Nachricht', 'Mensaje', 'Message', 'Messaggio', 'Bericht', 'メッセージ', '消息'],
  follow:   ['Follow', 'Folgen', 'Seguir', 'Suivre', 'Segui', 'Volgen', 'フォロー', '关注'],
  following:['Following', 'Folge ich', 'Siguiendo', 'Abonné', 'Stai seguendo', 'Volgend', 'フォロー中', '关注中'],
  search:   ['Search', 'Suchen', 'Buscar', 'Rechercher', 'Cerca', 'Zoeken', '検索', '搜索'],
};

function expandI18n(candidate: { kind: 'i18n'; semanticKey: SemanticKey; role?: string }): ResolverCandidate[] {
  const locales = I18N_MAP[candidate.semanticKey] ?? [];
  const role = candidate.role || 'button';
  const pattern = new RegExp(locales.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const out: ResolverCandidate[] = [];
  // Role-based first (most stable across i18n + DOM rotation).
  out.push({ kind: 'role', role, name: pattern });
  // Per-locale text fallback.
  for (const s of locales) {
    out.push({ kind: 'text', value: s, exact: false });
  }
  return out;
}

function toCss(c: ResolverCandidate): string | null {
  if (typeof c === 'string') return c;
  if (c.kind === 'css') return c.value;
  return null;
}

async function tryCandidate(page: any, candidate: ResolverCandidate, timeoutMs: number) {
  try {
    if (typeof candidate === 'string' || candidate.kind === 'css') {
      const sel = toCss(candidate)!;
      return await page.waitForSelector(sel, { timeout: timeoutMs, state: 'visible' });
    }
    if (candidate.kind === 'xpath') {
      return await page.waitForSelector(`xpath=${candidate.value}`, { timeout: timeoutMs, state: 'visible' });
    }
    if (candidate.kind === 'role') {
      const locator = page.getByRole(candidate.role, candidate.name ? { name: candidate.name } : {});
      await locator.first().waitFor({ timeout: timeoutMs, state: 'visible' });
      return await locator.first().elementHandle();
    }
    if (candidate.kind === 'text') {
      const locator = page.getByText(candidate.value, candidate.exact ? { exact: true } : {});
      await locator.first().waitFor({ timeout: timeoutMs, state: 'visible' });
      return await locator.first().elementHandle();
    }
    if (candidate.kind === 'i18n') {
      // Recursively try the expanded candidates: role pattern first,
      // then each localized text variant. Role-based is most stable
      // across both i18n and DOM rotation.
      for (const expanded of expandI18n(candidate)) {
        const handle = await tryCandidate(page, expanded, timeoutMs);
        if (handle) return handle;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function textHeuristicScan(
  page: any,
  fragments: string[],
  timeoutMs: number,
): Promise<any | null> {
  try {
    for (const frag of fragments) {
      const locator = page.getByText(frag, { exact: false });
      try {
        await locator.first().waitFor({ timeout: timeoutMs, state: 'visible' });
        const handle = await locator.first().elementHandle();
        if (handle) return handle;
      } catch {
        /* try next fragment */
      }
    }
  } catch { /* swallow */ }
  return null;
}

function jitter(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * Math.floor(baseMs / 2));
}

export async function resolveSelector(
  page: any,
  candidates: ResolverCandidate[],
  options: ResolveOptions = {},
): Promise<any | null> {
  const retries = Math.max(1, options.retries ?? 3);
  const perAttemptMs = options.perAttemptMs ?? 4000;
  const backoffMs = options.backoffMs ?? 400;

  for (let attempt = 0; attempt < retries; attempt++) {
    for (const candidate of candidates) {
      const handle = await tryCandidate(page, candidate, perAttemptMs);
      if (handle) return handle;
    }
    if (attempt < retries - 1) {
      await page.waitForTimeout(jitter(backoffMs * (attempt + 1)));
    }
  }

  if (options.textHeuristics && options.textHeuristics.length > 0) {
    const fallback = await textHeuristicScan(page, options.textHeuristics, perAttemptMs);
    if (fallback) return fallback;
  }
  if (options.semanticFallbacks && options.semanticFallbacks.length > 0) {
    for (const key of options.semanticFallbacks) {
      const handle = await tryCandidate(page, { kind: 'i18n', semanticKey: key }, perAttemptMs);
      if (handle) return handle;
    }
  }
  return null;
}

/**
 * Convenience: wait for ANY of the candidates to resolve (semantics match
 * the runner's previous `wait_for_any`). Returns true when one matched.
 */
export async function waitForAny(
  page: any,
  candidates: ResolverCandidate[],
  options: ResolveOptions = {},
): Promise<boolean> {
  const handle = await resolveSelector(page, candidates, options);
  return handle != null;
}
