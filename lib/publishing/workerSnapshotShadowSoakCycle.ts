// Soak Cycle Resolution Model
//
// Deterministic grouping of worker shadow telemetry into soak cycles. The same
// environment + worker group + publish-time window always resolves to the same
// soakCycleId, so telemetry from one runtime window aggregates together.
//
// Pure and deterministic given explicit inputs. `currentSoakCycleId` reads the
// environment and wall clock — it is non-deterministic by design (it is "now").

const DEFAULT_WINDOW_HOURS = 6;

export interface SoakCycleResolutionInput {
  environment: string;
  workerGroup: string;
  nowIso: string;
  windowHours?: number;
}

function slug(value: string, fallback: string): string {
  const cleaned = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

// Floors a timestamp to the start of its soak window (epoch ms).
export function resolveSoakCycleWindowStartMs(nowIso: string, windowHours: number): number {
  const parsed = Date.parse(nowIso);
  const safeNow = Number.isFinite(parsed) ? parsed : 0;
  const windowMs = Math.max(1, windowHours) * 3_600_000;
  return Math.floor(safeNow / windowMs) * windowMs;
}

// Deterministic: identical inputs always produce the same soakCycleId.
export function resolveSoakCycleId(input: SoakCycleResolutionInput): string {
  const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;
  const windowStartMs = resolveSoakCycleWindowStartMs(input.nowIso, windowHours);
  return `soak_${slug(input.environment, 'unknown')}_${slug(input.workerGroup, 'shared')}_w${windowStartMs}`;
}

// Resolves the soak cycle for the current runtime window.
export function currentSoakCycleId(options?: { windowHours?: number }): string {
  return resolveSoakCycleId({
    environment: process.env.NODE_ENV ?? 'unknown',
    workerGroup: process.env.WORKER_SNAPSHOT_SHADOW_GROUP ?? 'shared',
    nowIso: new Date().toISOString(),
    windowHours: options?.windowHours,
  });
}
