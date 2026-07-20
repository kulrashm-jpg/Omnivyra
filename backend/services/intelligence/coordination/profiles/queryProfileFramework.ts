/**
 * Query Profile framework (WS-2D Phases 1 & 8) — the ONE shared execution layer.
 *
 * Every profile is a thin `QueryProfile` whose `run` COMPOSES the existing
 * Communication Intelligence + graph-navigation APIs. It never re-implements graph
 * traversal. `executeProfile` is the single orchestration seam: tenant guard →
 * time → run → observability → fail-safe envelope. Profiles are independently
 * testable (each `run` is a pure-ish function of `deps`).
 */
import { AiError } from '../../../ai/safety';
import type { CoordinationResult } from '../coordinationContracts';
import type { CommunicationIntelligence } from '../intelligence/communicationIntelligenceContracts';
import { recordProfileExecution, recordProfileDegrade } from './profileObservability';
import type { ProfileType, ProfileResponse } from './profileModels';

/** What every profile is given — the existing intelligence service (composed, never bypassed). */
export interface ProfileDeps {
  intel: CommunicationIntelligence;
}

/** A profile: a type tag + a composition function + a result-count projector. */
export interface QueryProfile<Req, Data> {
  readonly type: ProfileType;
  run(deps: ProfileDeps, companyId: string, req: Req): Promise<Data>;
  resultCount(data: Data): number;
}

/** Unwrap a coordination Result inside a profile; a failure throws (framework catches). */
export function must<T>(r: CoordinationResult<T>): T {
  if ('error' in r) throw r.error;
  return r.value;
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/**
 * The single orchestration seam. Runs a profile, records metrics, and returns a
 * fail-safe envelope. Never throws into the caller.
 */
export async function executeProfile<Req, Data>(
  profile: QueryProfile<Req, Data>,
  deps: ProfileDeps,
  companyId: string,
  req: Req,
): Promise<CoordinationResult<ProfileResponse<Data>>> {
  if (typeof companyId !== 'string' || companyId.length === 0) {
    return { ok: false, error: new AiError('TENANT_REQUIRED', { devDetail: `queryprofile ${profile.type}: companyId is required` }) };
  }
  const started = Date.now();
  try {
    const data = await profile.run(deps, companyId, req);
    const resultCount = profile.resultCount(data);
    recordProfileExecution(profile.type, resultCount, Date.now() - started);
    return { ok: true, value: { meta: { profileType: profile.type, companyId, resultCount, degraded: false }, data } };
  } catch (e) {
    recordProfileDegrade(profile.type, 'run_error');
    return { ok: false, error: e instanceof AiError ? e : new AiError('INTERNAL', { devDetail: `queryprofile ${profile.type} failed: ${msg(e)}` }) };
  }
}
