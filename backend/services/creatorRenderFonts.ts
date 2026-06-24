/**
 * Vercel render-runtime font provisioning (Option A, PHASE 13Z).
 *
 * The Vercel Node serverless function that runs render-inline ships no system
 * fonts, so sharp→librsvg(2.61.2)/fontconfig(2.17.1) could not resolve the
 * infographic SVG's `font-family:"Inter, Arial"` → text rendered with zero ink
 * (blank). This module makes the vendored fonts in assets/fonts/ discoverable to
 * fontconfig at runtime by writing a minimal fonts.conf to /tmp (the only
 * writable path on Lambda) and pointing FONTCONFIG_FILE at it.
 *
 * Mechanism proven on the production sharp 0.34.5 build: a custom <dir> + a
 * /tmp cachedir, referenced via FONTCONFIG_FILE, renders text (ink > 0); with
 * no fonts, ink = 0. The config also aliases the SVG font-family chains
 * (Arial/Helvetica/sans-serif) to the vendored Inter so a bare runtime resolves
 * every chain deterministically, and includes the standard system font dirs so
 * the Railway worker (which has OS fonts) is unaffected.
 *
 * Idempotent, never throws (best-effort: on failure the renderer simply falls
 * back to whatever the runtime already had — i.e. the prior behavior).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface RenderFontDiagnostics {
  resolvedFontDir: string | null;
  fontCount: number;
  configPath: string;
}

const CACHE_DIR = path.join(os.tmpdir(), 'fontconfig');
const CONFIG_PATH = path.join(os.tmpdir(), 'fonts.conf');

let _diag: RenderFontDiagnostics | null = null;

/** Candidate locations for the vendored font dir across dev / compiled / traced layouts. */
function fontDirCandidates(): string[] {
  const c: string[] = [];
  try { c.push(path.join(process.cwd(), 'assets', 'fonts')); } catch { /* ignore */ }
  // dist/backend/services → repo root is ../../../ ; src layout ../../ .
  try { c.push(path.join(__dirname, '..', '..', 'assets', 'fonts')); } catch { /* ignore */ }
  try { c.push(path.join(__dirname, '..', '..', '..', 'assets', 'fonts')); } catch { /* ignore */ }
  return c;
}

function resolveFontDir(): { dir: string | null; count: number } {
  for (const dir of fontDirCandidates()) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const fonts = fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f));
        if (fonts.length > 0) return { dir, count: fonts.length };
      }
    } catch { /* keep trying next candidate */ }
  }
  return { dir: null, count: 0 };
}

/** fontconfig wants forward slashes in <dir>, even on Windows. */
function toFcPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function buildConfig(fontDir: string): string {
  const dir = toFcPath(fontDir);
  const cache = toFcPath(CACHE_DIR);
  return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <cachedir>${cache}</cachedir>
  <alias><family>Arial</family><prefer><family>Inter</family></prefer></alias>
  <alias><family>Helvetica</family><prefer><family>Inter</family></prefer></alias>
  <alias binding="weak"><family>sans-serif</family><prefer><family>Inter</family></prefer></alias>
</fontconfig>
`;
}

/**
 * Make the vendored fonts discoverable to fontconfig/librsvg for the current
 * runtime. Idempotent + best-effort. Returns diagnostics for the probe.
 */
export function ensureRenderFonts(): RenderFontDiagnostics {
  if (_diag) {
    // Re-assert env on warm invocations. MUST be guarded: production hardens
    // process.env as a readonly proxy whose set-trap throws ("'set' on proxy:
    // trap returned falsish") — an unguarded write here crashed warm render
    // invocations with a 500. The write is a no-op in prod (blocked) and only
    // takes effect in dev/local where process.env is writable.
    if (_diag.resolvedFontDir) {
      try {
        process.env.FONTCONFIG_FILE = CONFIG_PATH;
        process.env.FONTCONFIG_PATH = path.dirname(CONFIG_PATH);
      } catch { /* prod readonly-proxy blocks env writes — non-fatal */ }
    }
    return _diag;
  }

  const { dir, count } = resolveFontDir();
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

  if (dir) {
    try {
      fs.writeFileSync(CONFIG_PATH, buildConfig(dir), 'utf8');
      process.env.FONTCONFIG_FILE = CONFIG_PATH;
      process.env.FONTCONFIG_PATH = path.dirname(CONFIG_PATH);
    } catch {
      // Write failed — leave env untouched; renderer falls back to prior behavior.
    }
  }

  _diag = { resolvedFontDir: dir, fontCount: count, configPath: CONFIG_PATH };
  return _diag;
}

/** Test-only: reset the idempotency cache. */
export function __resetRenderFontsCacheForTest(): void {
  _diag = null;
}
