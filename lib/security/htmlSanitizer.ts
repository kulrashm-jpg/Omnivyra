/**
 * HARDEN-003 — centralized HTML sanitization.
 *
 * THE single place that decides what HTML may reach the browser. Every
 * dangerouslySetInnerHTML / innerHTML / markdown-raw-HTML path in the app must
 * go through this module — do not add per-component sanitizers.
 *
 * Engine: DOMPurify (isomorphic-dompurify — same engine in the browser and in
 * Node API routes), plus an equivalent rehype-sanitize schema exported for the
 * ReactMarkdown pipelines so one file owns the entire allow-list policy.
 *
 * Profiles:
 *   'rich'     — blog/editor content: headings, paragraphs, lists, tables,
 *                images, links, code, quotes, inline formatting. No SVG/MathML,
 *                no iframes, no forms, no style TAGS (style ATTRIBUTE allowed
 *                but filtered to a safe CSS property allow-list).
 *   'inline'   — short fragments (list items, spans): inline formatting + links.
 *   'document' — system-generated report snapshots rendered inline: 'rich'
 *                plus <style> tags (their charts/layout are CSS-driven) — still
 *                strips every executable construct.
 *   'text'     — strips ALL tags, returns text content only.
 *
 * Everything is fail-CLOSED: if sanitization throws for any reason the caller
 * gets an empty string, never the raw input.
 */
// NOTE: no rehype-sanitize import here — it is ESM-only and this module is
// also loaded by the CommonJS worker (via blogService). The rehype schema
// below is plain data; only React components import the plugin itself.
import DOMPurify from 'isomorphic-dompurify';

export type SanitizeProfile = 'rich' | 'inline' | 'document' | 'text';

// ── Allow-lists ────────────────────────────────────────────────────────────────

const INLINE_TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark',
  'code', 'kbd', 'sub', 'sup', 'span', 'br', 'abbr', 'small', 'q', 'cite', 'time',
];

const RICH_TAGS = [
  ...INLINE_TAGS,
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'hr',
  'img', 'figure', 'figcaption', 'picture', 'source',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'details', 'summary', 'address', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
];

const COMMON_ATTRS = [
  'class', 'id', 'title', 'lang', 'dir', 'style',
  'href', 'target', 'rel', 'name',
  'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding',
  'colspan', 'rowspan', 'scope', 'headers', 'align', 'valign',
  'start', 'reversed', 'type', 'value', 'datetime', 'cite', 'open',
];

/** Tags that are ALWAYS removed, in every profile, content included. */
const FORBID_TAGS = [
  'script', 'iframe', 'object', 'embed', 'applet', 'base', 'form', 'input',
  'button', 'select', 'textarea', 'option', 'link', 'meta', 'noscript',
  'template', 'slot', 'dialog', 'frame', 'frameset', 'portal',
  // SVG / MathML scripting surface — media belongs in <img>, not inline SVG.
  'svg', 'math', 'use', 'animate', 'set', 'foreignobject',
];

/** Attributes that are ALWAYS removed (DOMPurify already drops on* handlers). */
const FORBID_ATTRS = [
  'formaction', 'form', 'xlink:href', 'action', 'background', 'ping',
  'srcdoc', 'contenteditable', 'autofocus',
];

/**
 * Safe URL schemes for href/src: http(s), mailto, tel — plus scheme-less
 * (relative paths, anchors, query-only). Mirrors DOMPurify's default shape:
 * a letter-leading value is allowed only when its leading run does NOT end in
 * ':' (i.e. it can't be a scheme like javascript:/data:/vbscript:).
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$)|$)/i;

/** data: image URLs allowed ONLY on <img src> (editor paste produces these). */
const SAFE_DATA_IMAGE_REGEXP = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]*$/i;

// ── style attribute filtering (style-based injection defense) ─────────────────

const SAFE_CSS_PROPS = new Set([
  'color', 'background', 'background-color', 'font-size', 'font-weight',
  'font-style', 'font-family', 'text-align', 'text-decoration', 'text-transform',
  'text-indent', 'line-height', 'letter-spacing', 'white-space', 'word-break',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-radius', 'border-collapse',
  'display', 'float', 'clear', 'vertical-align', 'object-fit', 'object-position',
  'list-style', 'list-style-type', 'opacity', 'gap', 'text-shadow', 'box-shadow',
]);

const DANGEROUS_CSS_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|<|>/i;

function filterStyleAttribute(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!SAFE_CSS_PROPS.has(prop)) continue;
    if (!value || DANGEROUS_CSS_VALUE.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

// ── DOMPurify hooks (registered once) ──────────────────────────────────────────

let hooksRegistered = false;

function registerHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  // Stash safe data:image img srcs before the URI check strips them (re-applied below).
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (
      node.nodeName === 'IMG' &&
      data.attrName === 'src' &&
      typeof data.attrValue === 'string' &&
      SAFE_DATA_IMAGE_REGEXP.test(data.attrValue)
    ) {
      node.setAttribute('data-blocked-src', data.attrValue);
    }
  });

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // 1. style attribute → allow-listed CSS properties only.
    if (node.hasAttribute && node.hasAttribute('style')) {
      const filtered = filterStyleAttribute(node.getAttribute('style') || '');
      if (filtered) node.setAttribute('style', filtered);
      else node.removeAttribute('style');
    }
    // 2. <img src="data:image/...;base64"> is re-allowed (everything else data: stays banned).
    if (node.nodeName === 'IMG') {
      const dataSrc = node.getAttribute('data-blocked-src');
      if (dataSrc && SAFE_DATA_IMAGE_REGEXP.test(dataSrc)) {
        node.setAttribute('src', dataSrc);
      }
      node.removeAttribute('data-blocked-src');
    }
    // 3. target=_blank hardening on links that survived.
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

// ── Profile configs ────────────────────────────────────────────────────────────

function configFor(profile: SanitizeProfile): Record<string, unknown> {
  // NOTE: no USE_PROFILES here — DOMPurify's USE_PROFILES *overrides*
  // ALLOWED_TAGS/ALLOWED_ATTR, which would silently disable these allow-lists.
  const base = {
    FORBID_TAGS,
    FORBID_ATTR: FORBID_ATTRS,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
  };
  switch (profile) {
    case 'inline':
      return { ...base, ALLOWED_TAGS: INLINE_TAGS, ALLOWED_ATTR: COMMON_ATTRS };
    case 'document':
      // System-generated report snapshots: rich + <style> tags (layout/chart
      // CSS). FORCE_BODY keeps leading <style> in place — the parser would
      // otherwise hoist it into <head> and drop it from the sanitized body.
      return { ...base, ALLOWED_TAGS: [...RICH_TAGS, 'style'], ALLOWED_ATTR: COMMON_ATTRS, FORCE_BODY: true };
    case 'text':
      return { ...base, ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true };
    case 'rich':
    default:
      return { ...base, ALLOWED_TAGS: RICH_TAGS, ALLOWED_ATTR: COMMON_ATTRS };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Sanitize an HTML string against the given profile's allow-list.
 * Fail-CLOSED: any internal error returns ''.
 */
export function sanitizeHtml(html: string | null | undefined, profile: SanitizeProfile = 'rich'): string {
  if (!html) return '';
  try {
    registerHooks();
    return String(DOMPurify.sanitize(String(html), configFor(profile) as never));
  } catch {
    return '';
  }
}

/** Strip all markup, returning readable text only. */
export function htmlToSafeText(html: string | null | undefined): string {
  return sanitizeHtml(html, 'text');
}

/**
 * Validate a URL for use in a JSX href/src attribute. Returns the URL when the
 * scheme is safe (http(s), mailto, tel, relative, anchor), else undefined —
 * `<a href={sanitizeUrl(x)}>` renders no href for javascript:/data: inputs.
 */
export function sanitizeUrl(url: string | null | undefined): string | undefined {
  const raw = String(url ?? '').trim();
  if (!raw) return undefined;
  // Strip control/zero-width/whitespace chars that browsers ignore inside
  // schemes, then test the scheme.
  const descoped = raw.replace(/[\u0000-\u0020\u007F\u00A0\u1680\u2000-\u200F\u2028\u2029\u205F\u3000\uFEFF]/g, '');
  if (ALLOWED_URI_REGEXP.test(descoped)) return raw;
  return undefined;
}

/**
 * Serialize an object for a JSON-LD <script type="application/ld+json"> block.
 * Escapes <, >, & so stored strings (titles, descriptions) can never terminate
 * the script element ("</script><script>…" breakout).
 */
export function toJsonLd(data: unknown): string {
  try {
    return JSON.stringify(data)
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');
  } catch {
    return '{}';
  }
}

// ── ReactMarkdown (rehype) schema — same policy for the markdown pipelines ────

/** Minimal structural type for a hast-util-sanitize schema (kept local so this
 *  CJS-loaded module never imports the ESM-only rehype-sanitize package). */
export interface RehypeSanitizeSchema {
  tagNames: string[];
  attributes: Record<string, string[]>;
  protocols: Record<string, string[]>;
  strip: string[];
  clobber: string[];
  clobberPrefix: string;
  allowComments: boolean;
  allowDoctypes: boolean;
}

/**
 * rehype-sanitize schema mirroring the 'rich' profile. Use with:
 *   <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, rehypeSanitizeSchema]]}>
 * (rehype-raw parses embedded HTML, rehype-sanitize then applies this schema.)
 */
export const rehypeSanitizeSchema: RehypeSanitizeSchema = {
  tagNames: RICH_TAGS.filter((t) => !FORBID_TAGS.includes(t)),
  attributes: {
    '*': ['className', 'id', 'title', 'lang', 'dir'],
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
    td: ['colSpan', 'rowSpan', 'align'],
    th: ['colSpan', 'rowSpan', 'align', 'scope'],
    ol: ['start', 'reversed', 'type'],
    time: ['dateTime'],
    blockquote: ['cite'],
    q: ['cite'],
  },
  protocols: {
    href: ['http', 'https', 'mailto', 'tel'],
    src: ['http', 'https'],
    cite: ['http', 'https'],
  },
  strip: ['script'],
  // GitHub-style DOM-clobbering protection for user-controlled ids/names.
  clobber: ['name', 'id'],
  clobberPrefix: 'user-content-',
  allowComments: false,
  allowDoctypes: false,
};

// ── Storage-side helpers (defense in depth) ────────────────────────────────────

/**
 * Sanitize the HTML-bearing fields of a content_blocks array IN DEPTH before
 * storage. Only fields that are rendered as HTML are rewritten; all other
 * block data passes through untouched. Unknown shapes are left as-is (the
 * render-side sanitizer still covers them).
 */
export function sanitizeContentBlocks<T>(blocks: T): T {
  if (!Array.isArray(blocks)) return blocks;
  const walkListItems = (items: unknown[]): unknown[] =>
    items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const it = item as Record<string, unknown>;
      return {
        ...it,
        ...(typeof it.text === 'string' ? { text: sanitizeHtml(it.text, 'inline') } : {}),
        ...(Array.isArray(it.children) ? { children: walkListItems(it.children) } : {}),
      };
    });
  const walkBlocks = (list: unknown[]): unknown[] =>
    list.map((block) => {
      if (!block || typeof block !== 'object') return block;
      const b = block as Record<string, unknown>;
      const out: Record<string, unknown> = { ...b };
      if (typeof out.html === 'string') out.html = sanitizeHtml(out.html, 'rich');
      if (Array.isArray(out.items) && b.type === 'list') out.items = walkListItems(out.items);
      if (Array.isArray(out.columns)) {
        out.columns = (out.columns as unknown[]).map((col) => {
          if (!col || typeof col !== 'object') return col;
          const c = col as Record<string, unknown>;
          return Array.isArray(c.blocks) ? { ...c, blocks: walkBlocks(c.blocks) } : c;
        });
      }
      return out;
    });
  return walkBlocks(blocks) as T;
}
