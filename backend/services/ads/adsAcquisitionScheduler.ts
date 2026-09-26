/**
 * PO-3 — the scheduled public-advertising acquisition cycle.
 *
 * ─── WHY A SCHEDULE AT ALL ────────────────────────────────────────────────
 * Report 1 composes on Vercel, whose only Chromium path cannot navigate (`setContent` only).
 * The browser lives on the Railway worker. So acquisition cannot run inline with composition: it
 * runs here, persists, and the composer reads what was persisted — the same acquire → persist →
 * compose shape `ensureReportCrawlEvidence` already uses for crawl evidence.
 *
 * ─── OFF BY DEFAULT ───────────────────────────────────────────────────────
 * Gated on `ADS_TRANSPARENCY_ACQUISITION_ENABLED`, which is absent from every environment. Enabling
 * it is a production-configuration change and therefore a T3 decision, not an implementation one.
 * With the flag unset this module registers, reports `enabled: 0`, and does nothing.
 *
 * ─── PUBLIC AND ANONYMOUS ─────────────────────────────────────────────────
 * The session factory is injected and the production one opens a FRESH unauthenticated context per
 * page. The authenticated `rpaPlaywrightRunner` `storageState` path is never reachable from here:
 * there is no parameter through which a session could be supplied.
 */
import type { AdsBrowserSession } from './adsTransparencyBrowserClient';
import { createAdsTransparencyBrowserClient } from './adsTransparencyBrowserClient';
import { observePublicAdvertising, type AdsObservationResult } from './adsTransparencyObservation';
import type { SubjectIdentity } from './advertiserIdentityResolver';

/** One company due for observation, with the identity anchors already resolved by the caller. */
export interface AdsAcquisitionSubject {
  companyId: string;
  /** R1-OPEN-01 — conclusions belong to the domain they were observed for. */
  domainId: string | null;
  destinationDomain: string | null;
  subject: SubjectIdentity;
}

/** Persistence port. Production writes `report_evidence_history`; tests use a fake. */
export interface AdsEvidenceSink {
  persist(params: {
    companyId: string;
    domainId: string | null;
    observedAt: string;
    vantage: string;
    observation: AdsObservationResult;
  }): Promise<void>;
}

export interface AdsAcquisitionDeps {
  listDueSubjects: (limit: number) => Promise<AdsAcquisitionSubject[]>;
  openSession: () => Promise<{ session: AdsBrowserSession; close: () => Promise<void> }>;
  sink: AdsEvidenceSink;
  vantage: string;
  /** Defaults to the env gate. Injectable so a test can exercise both sides deterministically. */
  isEnabled?: () => boolean;
  maxSubjectsPerCycle?: number;
}

export function adsAcquisitionEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED ?? '');
}

const DEFAULT_MAX_SUBJECTS = 5;

/**
 * Run one acquisition cycle. Returns scheduler-shaped counters.
 *
 * Never throws: one company's failure must not end the cycle, and an access failure is recorded
 * as an access state rather than swallowed — "we could not look" has to survive into the report,
 * because the alternative is a report that implies the company does not advertise.
 */
export async function runAdsAcquisitionCycle(
  deps: AdsAcquisitionDeps,
): Promise<Record<string, number>> {
  const enabled = (deps.isEnabled ?? adsAcquisitionEnabled)();
  if (!enabled) return { enabled: 0, subjects: 0, observed: 0, persisted: 0, errors: 0 };

  const limit = Math.max(1, deps.maxSubjectsPerCycle ?? DEFAULT_MAX_SUBJECTS);
  let subjects: AdsAcquisitionSubject[] = [];
  try {
    subjects = await deps.listDueSubjects(limit);
  } catch {
    return { enabled: 1, subjects: 0, observed: 0, persisted: 0, errors: 1 };
  }
  if (subjects.length === 0) return { enabled: 1, subjects: 0, observed: 0, persisted: 0, errors: 0 };

  let opened: { session: AdsBrowserSession; close: () => Promise<void> };
  try {
    opened = await deps.openSession();
  } catch {
    return { enabled: 1, subjects: subjects.length, observed: 0, persisted: 0, errors: 1 };
  }

  const client = createAdsTransparencyBrowserClient(opened.session);
  let observed = 0;
  let persisted = 0;
  let errors = 0;

  try {
    for (const entry of subjects) {
      try {
        // Names in evidence-strength order: the site's declared legal name is the only anchor
        // that can reach MATCHED, so it is searched first; the brand name can only ever surface
        // candidates. Both are de-duplicated by the orchestrator.
        const searchNames = [entry.subject.declaredLegalName, entry.subject.brandName]
          .map((n) => (n ?? '').trim())
          .filter((n, i, all) => n.length > 0 && all.indexOf(n) === i);

        const observation = await observePublicAdvertising({
          subject: entry.subject,
          searchNames,
          destinationDomain: entry.destinationDomain,
          client,
          vantage: deps.vantage,
        });
        observed += 1;

        // Persisted even when the access state is not `observed`: a recorded "restricted" is what
        // lets the report say why, instead of rendering silence the reader may read as absence.
        await deps.sink.persist({
          companyId: entry.companyId,
          domainId: entry.domainId,
          observedAt: observation.observedAt,
          vantage: observation.vantage,
          observation,
        });
        persisted += 1;
      } catch {
        errors += 1;
      }
    }
  } finally {
    await opened.close().catch(() => undefined);
  }

  return { enabled: 1, subjects: subjects.length, observed, persisted, errors };
}
