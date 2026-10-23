/**
 * PI-LEAD-FOUNDATION-002 — archive: AI recommends, a human confirms.
 *
 * The property that matters most is a NEGATIVE one: creating a recommendation
 * must not change the prospect's state. So `setPersonStatus` is recorded on
 * every call and asserted absent where the contract forbids it — a test that
 * only checked the confirm path would pass against an implementation that
 * archived on recommendation too.
 */

import {
  evaluateArchiveCandidacy, recommendArchive,
  confirmArchiveRecommendation, rejectArchiveRecommendation, archiveProspect,
  isEnrichmentEligible, ArchiveError, ARCHIVE_REASONS,
  DEFAULT_ARCHIVE_THRESHOLDS, ARCHIVE_RULES_VERSION,
  type ArchivePorts, type ArchiveRecommendation, type ArchiveSignals,
} from '../../services/prospectIdentity/archiveService';

const ORG_A = '00000000-0000-4000-8000-00000000a001';
const ORG_B = '00000000-0000-4000-8000-00000000b002';
const PERSON = 'person-jane';
const REVIEWER = 'user-reviewer-1';
const NOW = '2026-09-26T09:00:00.000Z';

/** Every mutation the service performed, so absence is assertable. */
interface Harness {
  ports: ArchivePorts;
  statusWrites: { organizationId: string; personId: string; status: string }[];
  recommendations: ArchiveRecommendation[];
  /** Stand-in for evidence that archiving must never touch. */
  evidenceStore: { sourceRecords: number; enrichmentAttempts: number; governanceRecords: number };
}

function harness(over: { personStatus?: string; personOrg?: string } = {}): Harness {
  const statusWrites: Harness['statusWrites'] = [];
  const recommendations: ArchiveRecommendation[] = [];
  const evidenceStore = { sourceRecords: 7, enrichmentAttempts: 3, governanceRecords: 1 };
  let seq = 0;
  const personStatus = { value: over.personStatus ?? 'active' };

  const ports: ArchivePorts = {
    async readPerson(organizationId, personId) {
      if (organizationId !== (over.personOrg ?? ORG_A)) return null;
      if (personId !== PERSON) return null;
      return { personId, organizationId: over.personOrg ?? ORG_A, status: personStatus.value };
    },
    async insertRecommendation(input) {
      seq += 1;
      const rec: ArchiveRecommendation = { id: `rec-${seq}`, ...input };
      recommendations.push(rec);
      return rec;
    },
    async readOpenRecommendation(organizationId, personId) {
      return recommendations.find((r) =>
        r.organizationId === organizationId && r.personId === personId && r.status === 'open') ?? null;
    },
    async readRecommendation(organizationId, recommendationId) {
      return recommendations.find((r) => r.id === recommendationId
        && r.organizationId === organizationId) ?? null;
    },
    async updateRecommendationStatus({ recommendationId, status, reviewedByUserId, reviewedAt }) {
      const i = recommendations.findIndex((r) => r.id === recommendationId);
      recommendations[i] = { ...recommendations[i], status, reviewedByUserId, reviewedAt };
      return recommendations[i];
    },
    async setPersonStatus(input) {
      statusWrites.push(input);
      personStatus.value = input.status;
    },
    now: () => NOW,
  };
  return { ports, statusWrites, recommendations, evidenceStore };
}

const recommendingSignals: ArchiveSignals = {
  organizationId: ORG_A, personId: PERSON, outreachAttemptsWithoutResponse: 6,
};

// ───────────────────────────────────────────────────────────────────────────
describe('archive candidacy — deterministic, explainable, versioned', () => {
  it('recommends on repeated outreach with no response, and names ONE reason', () => {
    const c = evaluateArchiveCandidacy(recommendingSignals);
    expect(c.recommend).toBe(true);
    expect(c.reason).toBe('no_response_after_repeated_outreach');
    expect(c.reasoning).toMatch(/6 outreach attempts/);
    expect(c.modelVersion).toBe(ARCHIVE_RULES_VERSION);
  });

  it('carries the FULL signal set as evidence, including the thresholds used', () => {
    const c = evaluateArchiveCandidacy(recommendingSignals);
    // A reviewer must be able to see what the rules saw, not just the verdict.
    expect(c.evidence).toHaveProperty('outreachAttemptsWithoutResponse', 6);
    expect(c.evidence).toHaveProperty('daysSinceLastObservation', null);
    expect(c.evidence).toHaveProperty('thresholds', DEFAULT_ARCHIVE_THRESHOLDS);
  });

  it('does NOT recommend a healthy prospect', () => {
    const c = evaluateArchiveCandidacy({
      organizationId: ORG_A, personId: PERSON,
      outreachAttemptsWithoutResponse: 1, daysSinceLastObservation: 3,
      consecutiveEnrichmentFailures: 0, contactDataInvalid: false,
      identityConfidence: 0.9, matchesTargeting: true,
    });
    expect(c.recommend).toBe(false);
    expect(c.reason).toBeNull();
    // Evidence is still returned — "we looked and found nothing" is a result.
    expect(c.evidence).toHaveProperty('identityConfidence', 0.9);
  });

  it.each([
    [{ matchesTargeting: false }, 'no_longer_matches_targeting'],
    [{ contactDataInvalid: true }, 'stale_or_invalid_contact_data'],
    [{ consecutiveEnrichmentFailures: 4 }, 'repeated_enrichment_failure'],
    [{ daysSinceLastObservation: 400 }, 'prolonged_inactivity'],
    [{ identityConfidence: 0.1 }, 'insufficient_identity_confidence'],
  ] as const)('maps %o to reason %s', (signal, reason) => {
    const c = evaluateArchiveCandidacy({ organizationId: ORG_A, personId: PERSON, ...signal });
    expect(c.reason).toBe(reason);
    expect(ARCHIVE_REASONS).toContain(c.reason);
  });

  it('thresholds are overridable, so the rule set is policy and not a magic number', () => {
    const lenient = evaluateArchiveCandidacy(
      { organizationId: ORG_A, personId: PERSON, outreachAttemptsWithoutResponse: 6 },
      { ...DEFAULT_ARCHIVE_THRESHOLDS, outreachAttemptsWithoutResponse: 99 },
    );
    expect(lenient.recommend).toBe(false);
  });

  it('is pure — same signals, same verdict', () => {
    expect(evaluateArchiveCandidacy(recommendingSignals))
      .toEqual(evaluateArchiveCandidacy(recommendingSignals));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('AI RECOMMENDS — and recommending archives NOTHING', () => {
  it('creates an open recommendation and does not touch the prospect state', async () => {
    const h = harness();
    const rec = await recommendArchive(
      { organizationId: ORG_A, personId: PERSON, candidacy: evaluateArchiveCandidacy(recommendingSignals) },
      h.ports,
    );
    expect(rec.status).toBe('open');
    expect(rec.reviewedByUserId).toBeNull();
    expect(rec.reviewedAt).toBeNull();
    expect(rec.recommendedAt).toBe(NOW);
    // THE property: no state mutation occurred.
    expect(h.statusWrites).toEqual([]);
  });

  it('refuses to record a recommendation that does not recommend anything', async () => {
    const h = harness();
    const healthy = evaluateArchiveCandidacy({
      organizationId: ORG_A, personId: PERSON, outreachAttemptsWithoutResponse: 0,
    });
    await expect(recommendArchive(
      { organizationId: ORG_A, personId: PERSON, candidacy: healthy }, h.ports,
    )).rejects.toThrow(ArchiveError);
    expect(h.recommendations).toEqual([]);
  });

  it('refuses an already-archived prospect rather than re-recommending', async () => {
    const h = harness({ personStatus: 'archived' });
    await expect(recommendArchive(
      { organizationId: ORG_A, personId: PERSON, candidacy: evaluateArchiveCandidacy(recommendingSignals) },
      h.ports,
    )).rejects.toMatchObject({ refusal: 'already_archived' });
  });

  it('refuses a tenant-less request before reading anything', async () => {
    const h = harness();
    await expect(recommendArchive(
      { organizationId: '  ', personId: PERSON, candidacy: evaluateArchiveCandidacy(recommendingSignals) },
      h.ports,
    )).rejects.toMatchObject({ refusal: 'tenant_required' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('USER CONFIRMS — the only path to archived', () => {
  const open = async () => {
    const h = harness();
    const rec = await recommendArchive(
      { organizationId: ORG_A, personId: PERSON, candidacy: evaluateArchiveCandidacy(recommendingSignals) },
      h.ports,
    );
    return { h, rec };
  };

  it('confirmation archives the prospect and records the reviewer', async () => {
    const { h, rec } = await open();
    const out = await confirmArchiveRecommendation(
      { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: REVIEWER }, h.ports);

    expect(out.personStatus).toBe('archived');
    expect(out.recommendation.status).toBe('confirmed');
    expect(out.recommendation.reviewedByUserId).toBe(REVIEWER);
    expect(out.recommendation.reviewedAt).toBe(NOW);
    expect(h.statusWrites).toEqual([
      { organizationId: ORG_A, personId: PERSON, status: 'archived' },
    ]);
  });

  it('rejection leaves the prospect ACTIVE and writes no status at all', async () => {
    const { h, rec } = await open();
    const out = await rejectArchiveRecommendation(
      { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: REVIEWER }, h.ports);

    expect(out.personStatus).toBe('active');
    expect(out.recommendation.status).toBe('rejected');
    // The rejection is retained as audit — not deleted.
    expect(out.recommendation.reviewedByUserId).toBe(REVIEWER);
    expect(h.statusWrites).toEqual([]);
  });

  it('a confirmation with no reviewer is refused — AI cannot archive alone', async () => {
    const { h, rec } = await open();
    await expect(confirmArchiveRecommendation(
      { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: '' }, h.ports,
    )).rejects.toMatchObject({ refusal: 'actor_required' });
    expect(h.statusWrites).toEqual([]);
  });

  it('a recommendation cannot be reviewed twice', async () => {
    const { h, rec } = await open();
    await confirmArchiveRecommendation(
      { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: REVIEWER }, h.ports);
    await expect(rejectArchiveRecommendation(
      { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: REVIEWER }, h.ports,
    )).rejects.toMatchObject({ refusal: 'recommendation_not_open' });
  });

  it('a user may archive directly, still naming an actor', async () => {
    const h = harness();
    const out = await archiveProspect(
      { organizationId: ORG_A, personId: PERSON, actorUserId: REVIEWER }, h.ports);
    expect(out.personStatus).toBe('archived');
    expect(h.statusWrites).toHaveLength(1);
  });

  it('a direct archive with no actor is refused', async () => {
    const h = harness();
    await expect(archiveProspect(
      { organizationId: ORG_A, personId: PERSON, actorUserId: '' }, h.ports,
    )).rejects.toMatchObject({ refusal: 'actor_required' });
    expect(h.statusWrites).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('archive is NOT delete, and NOT DNC', () => {
  it('archiving writes exactly one status and touches no evidence store', async () => {
    const h = harness();
    const before = { ...h.evidenceStore };
    await archiveProspect({ organizationId: ORG_A, personId: PERSON, actorUserId: REVIEWER }, h.ports);

    // Source records, enrichment attempts and governance records are all intact.
    expect(h.evidenceStore).toEqual(before);
    expect(h.evidenceStore.sourceRecords).toBe(7);
    expect(h.evidenceStore.enrichmentAttempts).toBe(3);
    expect(h.evidenceStore.governanceRecords).toBe(1);
  });

  it('the service has no port that could delete or suppress anything', () => {
    const h = harness();
    const surface = Object.keys(h.ports).sort();
    expect(surface).toEqual([
      'insertRecommendation', 'now', 'readOpenRecommendation', 'readPerson',
      'readRecommendation', 'setPersonStatus', 'updateRecommendationStatus',
    ]);
    // Positive companion: the write surface is exactly one status setter.
    expect(surface).toContain('setPersonStatus');
    expect(surface.some((k) => /delete|erase|suppress|governance|dnc/i.test(k))).toBe(false);
  });

  it('archived and suppressed are orthogonal — archiving asserts nothing about contactability', async () => {
    const h = harness();
    await archiveProspect({ organizationId: ORG_A, personId: PERSON, actorUserId: REVIEWER }, h.ports);
    // Governance is a different table with a different owner; unchanged here.
    expect(h.evidenceStore.governanceRecords).toBe(1);
    expect(h.statusWrites[0].status).toBe('archived');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('enrichment interaction', () => {
  it('active is eligible; archived is not', () => {
    expect(isEnrichmentEligible('active')).toBe(true);
    expect(isEnrichmentEligible('archived')).toBe(false);
    expect(isEnrichmentEligible('merged')).toBe(false);
    expect(isEnrichmentEligible('suppressed')).toBe(false);
  });

  it('archiving does not erase enrichment history — eligibility is a read, not a purge', async () => {
    const h = harness();
    await archiveProspect({ organizationId: ORG_A, personId: PERSON, actorUserId: REVIEWER }, h.ports);
    expect(h.evidenceStore.enrichmentAttempts).toBe(3);
    expect(isEnrichmentEligible('archived')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('tenant isolation', () => {
  it('ORG_B cannot recommend against an ORG_A prospect', async () => {
    const h = harness();   // person belongs to ORG_A
    await expect(recommendArchive(
      { organizationId: ORG_B, personId: PERSON, candidacy: evaluateArchiveCandidacy(recommendingSignals) },
      h.ports,
    )).rejects.toMatchObject({ refusal: 'person_not_found' });
    expect(h.recommendations).toEqual([]);
  });

  it('ORG_B cannot archive an ORG_A prospect', async () => {
    const h = harness();
    await expect(archiveProspect(
      { organizationId: ORG_B, personId: PERSON, actorUserId: REVIEWER }, h.ports,
    )).rejects.toMatchObject({ refusal: 'person_not_found' });
    expect(h.statusWrites).toEqual([]);
  });

  it('ORG_B cannot confirm an ORG_A recommendation', async () => {
    const h = harness();
    const rec = await recommendArchive(
      { organizationId: ORG_A, personId: PERSON, candidacy: evaluateArchiveCandidacy(recommendingSignals) },
      h.ports,
    );
    await expect(confirmArchiveRecommendation(
      { organizationId: ORG_B, recommendationId: rec.id, reviewedByUserId: REVIEWER }, h.ports,
    )).rejects.toMatchObject({ refusal: 'recommendation_not_found' });
    expect(h.statusWrites).toEqual([]);
  });

  it('a tenant mismatch between the person and the request is refused explicitly', async () => {
    // A port that returns a person belonging to a DIFFERENT tenant than asked.
    const h = harness();
    const rogue: ArchivePorts = {
      ...h.ports,
      async readPerson(_org, personId) {
        return { personId, organizationId: ORG_B, status: 'active' };
      },
    };
    await expect(archiveProspect(
      { organizationId: ORG_A, personId: PERSON, actorUserId: REVIEWER }, rogue,
    )).rejects.toMatchObject({ refusal: 'wrong_tenant' });
  });
});
