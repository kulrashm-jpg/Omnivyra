/**
 * PARITY GATE — worker boot preflight.
 *
 * Runs at worker startup (main.ts) to verify this runtime can actually do what
 * localhost does: render SVG text glyphs (fonts present) and has the
 * prod-required env/assets. A failure is logged LOUDLY (and surfaced via the
 * report) so "works on localhost, blank/broken in prod" can never again ship
 * silently — the operator sees it the moment the worker boots.
 *
 * Non-fatal by design (a false-negative must not crash the worker); the
 * fail-CLOSED enforcement is the predeploy gate that runs the same checks
 * before deploy. This is the runtime visibility half of the same contract.
 */

import { probeRenderTextCapability } from '../services/renderTextCapabilityProbe';

export type PreflightSeverity = 'critical' | 'warn';

export interface PreflightItem {
  name: string;
  ok: boolean;
  severity: PreflightSeverity;
  detail?: string;
}

export interface PreflightReport {
  ok: boolean;
  criticalFailures: number;
  warnings: number;
  items: PreflightItem[];
}

/**
 * Prod-required env/asset contract. CRITICAL = production diverges or fails
 * without it; WARN = degraded/feature-specific (e.g. governed renders that
 * need OCR fail closed when CREATOR_OCR_ENDPOINT is unset in prod).
 */
const REQUIRED_ENV: Array<{ key: string; severity: PreflightSeverity; note: string }> = [
  { key: 'SUPABASE_URL', severity: 'critical', note: 'DB access' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', severity: 'critical', note: 'service-role writes' },
  { key: 'REDIS_URL', severity: 'critical', note: 'queue workers' },
  { key: 'OPENAI_API_KEY', severity: 'critical', note: 'content/creator generation' },
  { key: 'CREATOR_OCR_ENDPOINT', severity: 'warn', note: 'governed creator renders fail closed in prod without it' },
];

export async function runRenderParityPreflight(
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<PreflightReport> {
  const env = opts.env ?? process.env;
  const items: PreflightItem[] = [];

  // 1. Render-text capability (fonts) — the universal local↔prod parity probe.
  const probe = await probeRenderTextCapability();
  items.push({
    name: 'render_text_glyphs',
    ok: probe.ok,
    severity: 'critical',
    detail: probe.ok
      ? `ink=${probe.inkRatio.toFixed(4)} family="${probe.fontFamily}"`
      : (probe.reason ?? 'no glyphs rendered — fonts missing'),
  });

  // 2. Env/asset contract.
  for (const e of REQUIRED_ENV) {
    const v = env[e.key];
    const present = typeof v === 'string' && v.trim().length > 0;
    items.push({ name: `env:${e.key}`, ok: present, severity: e.severity, detail: present ? undefined : e.note });
  }

  const criticalFailures = items.filter((i) => !i.ok && i.severity === 'critical').length;
  const warnings = items.filter((i) => !i.ok && i.severity === 'warn').length;
  return { ok: criticalFailures === 0, criticalFailures, warnings, items };
}

/** Loud, operator-visible logging of the preflight report. */
export function logPreflightReport(report: PreflightReport): void {
  for (const i of report.items) {
    if (i.ok) {
      console.info(`[parity-preflight] OK   ${i.name}${i.detail ? ` (${i.detail})` : ''}`);
    } else if (i.severity === 'critical') {
      console.error(`[parity-preflight] FAIL ${i.name}${i.detail ? ` — ${i.detail}` : ''}`);
    } else {
      console.warn(`[parity-preflight] WARN ${i.name}${i.detail ? ` — ${i.detail}` : ''}`);
    }
  }
  if (!report.ok) {
    console.error(
      `[parity-preflight] ${report.criticalFailures} CRITICAL parity failure(s) — production WILL diverge from localhost. ` +
        `Fix before relying on this worker.`,
    );
  } else if (report.warnings > 0) {
    console.warn(`[parity-preflight] ${report.warnings} warning(s) — some features may be degraded in this environment.`);
  } else {
    console.info('[parity-preflight] all parity checks passed — environment matches local capability.');
  }
}
