/**
 * Template Operational Health — pure, deterministic lifecycle/health metrics.
 *
 * Measures ONLY operational health (created/updated/selected/generation/render/
 * validation/publish/archive lifecycle) — NO marketing/business analytics, no
 * engagement, CTR, impressions, reach, clicks, conversions, no AI. Aggregates
 * the EXISTING template audit events (one event store, one event model — see
 * userTemplateService.writeAudit / listTemplateAudit); this module is the pure
 * computation over those events.
 */

/** Operational + lifecycle event actions (superset of the audit actions). */
export type TemplateHealthAction =
  | 'created' | 'updated' | 'edited' | 'version_created' | 'restored'
  | 'selected'
  | 'generation_started' | 'generation_succeeded' | 'generation_failed'
  | 'validation_failed'
  | 'render_succeeded' | 'render_failed'
  | 'published' | 'archived' | 'deleted' | 'deprecated';

export interface TemplateHealthEvent {
  action: string;
  templateId: string;
  templateVersion: number;
  at: string; // ISO timestamp
}

export type VersionStatus = 'ACTIVE' | 'CURRENT' | 'SUPERSEDED' | 'ARCHIVED' | 'DEPRECATED' | 'UNKNOWN';

export interface TemplateHealth {
  templateId: string;
  ownership: 'system' | 'user';
  activeVersion: number | null;
  latestVersion: number | null;
  timesSelected: number;
  timesGenerated: number;
  generationSuccessRate: number; // 0..1
  renderSuccessRate: number;     // 0..1
  validationFailureCount: number;
  generationFailureCount: number;
  renderFailureCount: number;
  publishCount: number;
  lastUsed: string | null;
  lastGenerated: string | null;
  lastPublished: string | null;
  versionStatus: VersionStatus;
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

/** Deterministic version status for a template's active version. */
export function resolveVersionStatus(input: { version: number | null; latestVersion: number | null; status?: string | null }): VersionStatus {
  const s = String(input.status ?? '').toLowerCase();
  if (s === 'archived') return 'ARCHIVED';
  if (s === 'deprecated') return 'DEPRECATED';
  if (input.version == null || input.latestVersion == null) return 'UNKNOWN';
  if (input.version < input.latestVersion) return 'SUPERSEDED';
  if (s === 'published') return 'ACTIVE';
  if (input.version === input.latestVersion) return 'CURRENT';
  return 'UNKNOWN';
}

/**
 * Compute a template's operational health by aggregating its audit/operational
 * events. Rates default to 1 when there are no attempts (no failures observed).
 */
export function computeTemplateHealth(
  templateId: string,
  events: readonly TemplateHealthEvent[],
  opts: { ownership?: 'system' | 'user'; latestVersion?: number | null; activeVersion?: number | null; status?: string | null } = {},
): TemplateHealth {
  const of = (a: string) => events.filter((e) => e.action === a);
  const count = (a: string) => of(a).length;
  const lastAt = (...actions: string[]): string | null =>
    events.filter((e) => actions.includes(e.action)).reduce<string | null>((m, e) => (e.at > (m ?? '') ? e.at : m), null);

  const genStarted = count('generation_started');
  const genOk = count('generation_succeeded');
  const genFail = count('generation_failed');
  const rOk = count('render_succeeded');
  const rFail = count('render_failed');

  const versionsInEvents = events.map((e) => e.templateVersion || 0).filter((v) => v > 0);
  const inferredLatest = versionsInEvents.length ? Math.max(...versionsInEvents) : null;
  const latestVersion = opts.latestVersion ?? inferredLatest;
  const activeVersion = opts.activeVersion ?? latestVersion;

  return {
    templateId,
    ownership: opts.ownership ?? 'user',
    activeVersion,
    latestVersion,
    timesSelected: count('selected'),
    timesGenerated: genStarted,
    generationSuccessRate: genStarted > 0 ? round3(genOk / genStarted) : 1,
    renderSuccessRate: (rOk + rFail) > 0 ? round3(rOk / (rOk + rFail)) : 1,
    validationFailureCount: count('validation_failed'),
    generationFailureCount: genFail,
    renderFailureCount: rFail,
    publishCount: count('published'),
    lastUsed: lastAt('selected'),
    lastGenerated: lastAt('generation_started', 'generation_succeeded'),
    lastPublished: lastAt('published'),
    versionStatus: resolveVersionStatus({ version: activeVersion, latestVersion, status: opts.status }),
  };
}

/* ── System health (fleet-level operational flags) ───────────────────── */

export interface SystemHealth {
  /** Never selected and never generated. */
  noUsage: string[];
  /** Generation + render failures at/above the threshold. */
  repeatedFailures: string[];
  /** One or more validation failures. */
  failingValidation: string[];
  /** Active version is deprecated/superseded. */
  deprecatedVersions: string[];
  /** Never published. */
  neverPublished: string[];
  /** No usage, never published, not already archived → candidate to archive. */
  safeToArchive: string[];
}

export function computeSystemHealth(
  healths: readonly TemplateHealth[],
  opts: { failureThreshold?: number } = {},
): SystemHealth {
  const thr = opts.failureThreshold ?? 3;
  const ids = (pred: (h: TemplateHealth) => boolean) => healths.filter(pred).map((h) => h.templateId);
  return {
    noUsage: ids((h) => h.timesSelected === 0 && h.timesGenerated === 0),
    repeatedFailures: ids((h) => (h.generationFailureCount + h.renderFailureCount) >= thr),
    failingValidation: ids((h) => h.validationFailureCount > 0),
    deprecatedVersions: ids((h) => h.versionStatus === 'DEPRECATED' || h.versionStatus === 'SUPERSEDED'),
    neverPublished: ids((h) => h.publishCount === 0),
    safeToArchive: ids((h) => h.ownership === 'user' && h.timesSelected === 0 && h.timesGenerated === 0 && h.publishCount === 0 && h.versionStatus !== 'ARCHIVED'),
  };
}
