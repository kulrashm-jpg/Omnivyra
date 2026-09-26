/**
 * PI-LEAD-FOUNDATION-002 — archive and precedence against REAL PostgreSQL.
 *
 * ─── WHAT THIS SUITE DOES THAT THE CONTRACT TESTS CANNOT ──────────────────
 * The contract suites drive the archive service against an in-memory port
 * implementation. This one drives THE SAME production service against the real
 * governed schema: `ArchivePorts` is an interface, so it is implemented here
 * over the harness's `pg` client. The service's logic — its refusals, its
 * ordering, its "recommendation is not archival" rule — is the production code,
 * and every assertion below reads the database back with SQL.
 *
 * Precedence is likewise the real `selectCanonicalObservation`, run over rows
 * actually persisted in `source_assertions` rather than over literals.
 *
 * ─── WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM ──────────────────────────
 * It does NOT exercise the ingestion orchestrator, and therefore does not prove
 * canonical collapse or duplicate parking. That is an architectural limit of
 * this harness, not an omission: the orchestrator persists through
 * `ownedDbTable` -> the Supabase client, which speaks PostgREST, and
 * `real-schema-ci.yml` sets only `W6_DB_URL` — no `SUPABASE_URL`. A service on
 * that path cannot reach this database at all. Rather than invent a second
 * harness (forbidden) or fake the orchestrator (pointless), the limit is stated
 * and the rest is proven.
 *
 * SECRETS: every value is synthetic. No credential, no provider, no network.
 */
import { createHash } from 'crypto';
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, constraintDef, uniqueIndexColumns } from './setup';
import {
  evaluateArchiveCandidacy, recommendArchive,
  confirmArchiveRecommendation, rejectArchiveRecommendation, archiveProspect,
  isEnrichmentEligible, type ArchivePorts, type ArchiveRecommendation,
} from '../../services/prospectIdentity/archiveService';
import {
  selectCanonicalObservation, type SourceObservation,
} from '../../services/prospectIdentity/sourcePrecedence';

const TABLE = 'prospect_archive_recommendations';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** A reviewer. `users` needs only `email`; everything else defaults. */
async function newUser(tag: string): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO public.users (email) VALUES ($1) RETURNING id',
    [`w6-${tag}-${Math.random().toString(36).slice(2, 10)}@example.test`],
  );
  return rows[0].id;
}

async function newSourceRecord(org: string, provider: string, ref: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.source_records
       (organization_id, provider, source_entity_type, source_record_id, raw_payload, payload_hash)
     VALUES ($1,$2,'person',$3,'{}'::jsonb,$4) RETURNING id`,
    [org, provider, ref, hash(`${org}|${provider}|${ref}`)],
  );
  return rows[0].id;
}

/** Persist one observation as real evidence. */
async function newAssertion(input: {
  org: string; sourceRecordId: string; personId: string;
  attribute: string; value: string; provider: string;
  confidence: number; observedAt: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO public.source_assertions
       (organization_id, source_record_id, entity_type, person_id,
        attribute, raw_value, normalized_value, value_hash, provider, confidence, observed_at)
     VALUES ($1,$2,'person',$3,$4,$5,$5,$6,$7,$8,$9)`,
    [input.org, input.sourceRecordId, input.personId, input.attribute, input.value,
      hash(`${input.attribute}|${input.value}`), input.provider, input.confidence, input.observedAt],
  );
}

/** Read persisted observations back as the precedence contract's input shape. */
async function readObservations(org: string, personId: string, attribute: string): Promise<SourceObservation[]> {
  const { rows } = await db.query(
    `SELECT provider, attribute, normalized_value, observed_at, confidence
       FROM public.source_assertions
      WHERE organization_id=$1 AND person_id=$2 AND attribute=$3`,
    [org, personId, attribute],
  );
  return rows.map((r: any) => ({
    source: r.provider,
    attribute: r.attribute,
    value: r.normalized_value,
    observedAt: r.observed_at instanceof Date ? r.observed_at.toISOString() : String(r.observed_at),
    confidence: r.confidence === null ? null : Number(r.confidence),
  }));
}

const personStatus = async (personId: string): Promise<string> => {
  const { rows } = await db.query('SELECT status FROM public.unified_persons WHERE id=$1', [personId]);
  return rows.length ? rows[0].status : 'MISSING';
};

/**
 * The production `ArchivePorts`, implemented over real PostgreSQL.
 *
 * `statusWrites` records every call to `setPersonStatus`, so "zero unauthorized
 * status writes" is an assertion about observed calls AND about the persisted
 * column, not about one or the other.
 */
function pgPorts(nowIso = '2026-09-26T09:00:00.000Z') {
  const statusWrites: { organizationId: string; personId: string; status: string }[] = [];
  const ports: ArchivePorts = {
    async readPerson(organizationId, personId) {
      const { rows } = await db.query(
        'SELECT id, company_id, status FROM public.unified_persons WHERE id=$1 AND company_id=$2',
        [personId, organizationId],
      );
      if (!rows.length) return null;
      return { personId: rows[0].id, organizationId: rows[0].company_id, status: rows[0].status };
    },
    async insertRecommendation(input) {
      const { rows } = await db.query(
        `INSERT INTO public.${TABLE}
           (organization_id, person_id, reason, reasoning, evidence, model_version,
            status, recommended_at, reviewed_by_user_id, reviewed_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *`,
        [input.organizationId, input.personId, input.reason, input.reasoning,
          JSON.stringify(input.evidence), input.modelVersion, input.status,
          input.recommendedAt, input.reviewedByUserId, input.reviewedAt],
      );
      return rowToRec(rows[0]);
    },
    async readOpenRecommendation(organizationId, personId) {
      const { rows } = await db.query(
        `SELECT * FROM public.${TABLE} WHERE organization_id=$1 AND person_id=$2 AND status='open'`,
        [organizationId, personId],
      );
      return rows.length ? rowToRec(rows[0]) : null;
    },
    async readRecommendation(organizationId, recommendationId) {
      const { rows } = await db.query(
        `SELECT * FROM public.${TABLE} WHERE id=$1 AND organization_id=$2`,
        [recommendationId, organizationId],
      );
      return rows.length ? rowToRec(rows[0]) : null;
    },
    async updateRecommendationStatus({ organizationId, recommendationId, status, reviewedByUserId, reviewedAt }) {
      const { rows } = await db.query(
        `UPDATE public.${TABLE}
            SET status=$3, reviewed_by_user_id=$4, reviewed_at=$5
          WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [recommendationId, organizationId, status, reviewedByUserId, reviewedAt],
      );
      return rowToRec(rows[0]);
    },
    async setPersonStatus(input) {
      statusWrites.push(input);
      await db.query(
        'UPDATE public.unified_persons SET status=$3 WHERE id=$1 AND company_id=$2',
        [input.personId, input.organizationId, input.status],
      );
    },
    now: () => nowIso,
  };
  return { ports, statusWrites };
}

function rowToRec(r: any): ArchiveRecommendation {
  return {
    id: r.id,
    organizationId: r.organization_id,
    personId: r.person_id,
    reason: r.reason,
    reasoning: r.reasoning,
    evidence: r.evidence ?? {},
    modelVersion: r.model_version,
    status: r.status,
    recommendedAt: r.recommended_at instanceof Date ? r.recommended_at.toISOString() : String(r.recommended_at),
    reviewedByUserId: r.reviewed_by_user_id,
    reviewedAt: r.reviewed_at === null ? null
      : (r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : String(r.reviewed_at)),
  };
}

const CANDIDACY = () => evaluateArchiveCandidacy({
  organizationId: ORG_A, personId: 'x', outreachAttemptsWithoutResponse: 6,
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-FOUNDATION-002 — the archive schema exists and ENFORCES', () => {
  it('the table, its composite tenant FK, its CHECKs and its partial index are present', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [TABLE]);
    expect(rows).toHaveLength(1);

    expect(await constraintDef('prospect_archive_rec_person_tenant_fk'))
      .toMatch(/FOREIGN KEY \(person_id, organization_id\) REFERENCES unified_persons\(id, company_id\)/);
    expect(await constraintDef('prospect_archive_rec_status_valid')).toMatch(/open/);
    expect(await constraintDef('prospect_archive_rec_reason_valid')).toMatch(/prolonged_inactivity/);
    expect(await constraintDef('prospect_archive_rec_review_coherent')).toMatch(/reviewed_by_user_id/);
    expect(await uniqueIndexColumns('uq_prospect_archive_rec_open')).toEqual(['organization_id', 'person_id']);
  });

  it('RLS is enabled and no policy admits anon or authenticated', async () => {
    const { rows: rls } = await db.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname=$1 AND relnamespace='public'::regnamespace`, [TABLE]);
    expect(rls[0].relrowsecurity).toBe(true);

    const { rows: pol } = await db.query(
      `SELECT policyname, roles::text FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [TABLE]);
    expect(pol.length).toBeGreaterThan(0);
    for (const p of pol) {
      expect(p.roles).not.toMatch(/\banon\b/);
      expect(p.roles).not.toMatch(/\bauthenticated\b/);
    }
  });

  it('a CROSS-TENANT recommendation is refused by the database, not merely by the service', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      // ORG_B naming an ORG_A person: the composite FK has no such parent row.
      expect(await attempt(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason)
         VALUES ($1,$2,'prolonged_inactivity')`, [ORG_B, person],
      )).toBe('23503');
      // The same insert in the RIGHT tenant succeeds — proves the refusal was
      // about tenancy and not about the row being malformed.
      expect(await attempt(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason)
         VALUES ($1,$2,'prolonged_inactivity')`, [ORG_A, person],
      )).toBe('ok');
    });
  });

  it('an unrecognised reason and an unrecognised status are both refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      expect(await attempt(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason)
         VALUES ($1,$2,'because_i_said_so')`, [ORG_A, person])).toBe('23514');
      expect(await attempt(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason, status)
         VALUES ($1,$2,'prolonged_inactivity','half_archived')`, [ORG_A, person])).toBe('23514');
    });
  });

  it('a CONFIRMED recommendation with no reviewer is structurally impossible', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      // This is the autonomous-archive shape. The database refuses it.
      expect(await attempt(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason, status)
         VALUES ($1,$2,'prolonged_inactivity','confirmed')`, [ORG_A, person])).toBe('23514');
    });
  });

  it('only ONE open recommendation may exist per person, while history accumulates', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('rev');
      await db.query(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason)
         VALUES ($1,$2,'prolonged_inactivity')`, [ORG_A, person]);
      expect(await attempt(
        `INSERT INTO public.${TABLE} (organization_id, person_id, reason)
         VALUES ($1,$2,'prolonged_inactivity')`, [ORG_A, person])).toBe('23505');
      // A rejected one does not occupy the slot — the index is partial.
      expect(await attempt(
        `INSERT INTO public.${TABLE}
           (organization_id, person_id, reason, status, reviewed_by_user_id, reviewed_at)
         VALUES ($1,$2,'prolonged_inactivity','rejected',$3, now())`, [ORG_A, person, reviewer])).toBe('ok');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-FOUNDATION-002 — the REAL archive service against REAL PostgreSQL', () => {
  it('RECOMMENDATION IS NOT ARCHIVAL: the person stays active and nothing is written', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const { ports, statusWrites } = pgPorts();

      const rec = await recommendArchive(
        { organizationId: ORG_A, personId: person, candidacy: CANDIDACY() }, ports);

      // Persisted state, read back from the database.
      const { rows } = await db.query(
        `SELECT status, reviewed_by_user_id, reviewed_at, reason, model_version, evidence
           FROM public.${TABLE} WHERE id=$1`, [rec.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('open');
      expect(rows[0].reviewed_by_user_id).toBeNull();
      expect(rows[0].reviewed_at).toBeNull();
      expect(rows[0].reason).toBe('no_response_after_repeated_outreach');
      expect(rows[0].model_version).toBe('pi.archive-rules.1');
      // Evidence is retained for the reviewing human.
      expect(rows[0].evidence).toHaveProperty('outreachAttemptsWithoutResponse', 6);

      // THE property: no lifecycle mutation, observed AND persisted.
      expect(statusWrites).toEqual([]);
      expect(await personStatus(person)).toBe('active');
    });
  });

  it('CONFIRMATION archives, and persists the reviewer and the timestamp', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('confirm');
      const { ports, statusWrites } = pgPorts();

      const rec = await recommendArchive(
        { organizationId: ORG_A, personId: person, candidacy: CANDIDACY() }, ports);
      const out = await confirmArchiveRecommendation(
        { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: reviewer }, ports);

      expect(out.personStatus).toBe('archived');
      const { rows } = await db.query(
        `SELECT status, reviewed_by_user_id, reviewed_at FROM public.${TABLE} WHERE id=$1`, [rec.id]);
      expect(rows[0].status).toBe('confirmed');
      expect(rows[0].reviewed_by_user_id).toBe(reviewer);
      expect(rows[0].reviewed_at).not.toBeNull();

      expect(await personStatus(person)).toBe('archived');
      expect(statusWrites).toEqual([{ organizationId: ORG_A, personId: person, status: 'archived' }]);
    });
  });

  it('REJECTION leaves the person active and retains the reviewer as audit', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('reject');
      const { ports, statusWrites } = pgPorts();

      const rec = await recommendArchive(
        { organizationId: ORG_A, personId: person, candidacy: CANDIDACY() }, ports);
      const out = await rejectArchiveRecommendation(
        { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: reviewer }, ports);

      expect(out.personStatus).toBe('active');
      const { rows } = await db.query(
        `SELECT status, reviewed_by_user_id FROM public.${TABLE} WHERE id=$1`, [rec.id]);
      expect(rows[0].status).toBe('rejected');
      expect(rows[0].reviewed_by_user_id).toBe(reviewer);
      // The rejection is retained, not deleted.
      expect(await personStatus(person)).toBe('active');
      expect(statusWrites).toEqual([]);
    });
  });

  it('a confirmation with no reviewer is refused, and writes nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const { ports, statusWrites } = pgPorts();
      const rec = await recommendArchive(
        { organizationId: ORG_A, personId: person, candidacy: CANDIDACY() }, ports);

      await expect(confirmArchiveRecommendation(
        { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: '' }, ports,
      )).rejects.toMatchObject({ refusal: 'actor_required' });

      expect(statusWrites).toEqual([]);
      expect(await personStatus(person)).toBe('active');
      const { rows } = await db.query(`SELECT status FROM public.${TABLE} WHERE id=$1`, [rec.id]);
      expect(rows[0].status).toBe('open');
    });
  });

  it('archiving DELETES NOTHING — source records and assertions survive', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('keep');
      const sr = await newSourceRecord(ORG_A, 'salesnav-sim', 'SN-KEEP-1');
      await newAssertion({
        org: ORG_A, sourceRecordId: sr, personId: person, attribute: 'job_title',
        value: 'VP Marketing', provider: 'salesnav-sim', confidence: 0.9,
        observedAt: '2026-09-05T09:00:00.000Z',
      });
      const { ports } = pgPorts();

      await archiveProspect({ organizationId: ORG_A, personId: person, actorUserId: reviewer }, ports);
      expect(await personStatus(person)).toBe('archived');

      // The person row itself is still there — archive is not deletion.
      const { rows: p } = await db.query('SELECT id FROM public.unified_persons WHERE id=$1', [person]);
      expect(p).toHaveLength(1);
      // And so is every piece of evidence.
      const { rows: s } = await db.query(
        'SELECT count(*)::int n FROM public.source_assertions WHERE person_id=$1', [person]);
      expect(s[0].n).toBe(1);
      const { rows: r } = await db.query(
        'SELECT count(*)::int n FROM public.source_records WHERE id=$1', [sr]);
      expect(r[0].n).toBe(1);
      // Contact governance is a different axis and is untouched.
      const { rows: g } = await db.query(
        'SELECT count(*)::int n FROM public.contact_governance_records WHERE organization_id=$1', [ORG_A]);
      expect(g[0].n).toBe(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-FOUNDATION-002 — tenant isolation, database backed', () => {
  it('ORG_B cannot recommend, confirm or archive an ORG_A person — zero status writes', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('crosstenant');
      const { ports, statusWrites } = pgPorts();

      const rec = await recommendArchive(
        { organizationId: ORG_A, personId: person, candidacy: CANDIDACY() }, ports);

      await expect(recommendArchive(
        { organizationId: ORG_B, personId: person, candidacy: CANDIDACY() }, ports,
      )).rejects.toMatchObject({ refusal: 'person_not_found' });

      await expect(confirmArchiveRecommendation(
        { organizationId: ORG_B, recommendationId: rec.id, reviewedByUserId: reviewer }, ports,
      )).rejects.toMatchObject({ refusal: 'recommendation_not_found' });

      await expect(archiveProspect(
        { organizationId: ORG_B, personId: person, actorUserId: reviewer }, ports,
      )).rejects.toMatchObject({ refusal: 'person_not_found' });

      // ZERO unauthorized status writes, observed and persisted.
      expect(statusWrites).toEqual([]);
      expect(await personStatus(person)).toBe('active');
      const { rows } = await db.query(`SELECT status FROM public.${TABLE} WHERE id=$1`, [rec.id]);
      expect(rows[0].status).toBe('open');
    });
  });

  it('a mismatched tenant from a port is refused as wrong_tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('mismatch');
      const { ports, statusWrites } = pgPorts();
      const rogue: ArchivePorts = {
        ...ports,
        // Claims the person belongs to ORG_B while ORG_A was requested.
        async readPerson(_org, personId) {
          return { personId, organizationId: ORG_B, status: 'active' };
        },
      };
      await expect(archiveProspect(
        { organizationId: ORG_A, personId: person, actorUserId: reviewer }, rogue,
      )).rejects.toMatchObject({ refusal: 'wrong_tenant' });
      expect(statusWrites).toEqual([]);
      expect(await personStatus(person)).toBe('active');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-FOUNDATION-002 — PI-ADR-009 precedence over PERSISTED observations', () => {
  const SN = 'salesnav-sim';
  const T_SN = '2026-09-05T09:00:00.000Z';        // OLDEST
  const T_VENDOR = '2026-09-08T09:00:00.000Z';    // newer

  async function seedConflict(personId: string) {
    const snRec = await newSourceRecord(ORG_A, SN, 'SN-1');
    const apRec = await newSourceRecord(ORG_A, 'apollo-sim', 'AP-1');
    const ziRec = await newSourceRecord(ORG_A, 'zoominfo-sim', 'ZI-1');

    // title: SN is authoritative and OLDEST — the interesting case.
    await newAssertion({ org: ORG_A, sourceRecordId: snRec, personId, attribute: 'job_title', value: 'VP Marketing', provider: SN, confidence: 0.9, observedAt: T_SN });
    await newAssertion({ org: ORG_A, sourceRecordId: apRec, personId, attribute: 'job_title', value: 'Marketing Manager', provider: 'apollo-sim', confidence: 0.6, observedAt: T_VENDOR });
    await newAssertion({ org: ORG_A, sourceRecordId: ziRec, personId, attribute: 'job_title', value: 'Head of Marketing', provider: 'zoominfo-sim', confidence: 0.55, observedAt: T_VENDOR });

    // company: same shape.
    await newAssertion({ org: ORG_A, sourceRecordId: snRec, personId, attribute: 'company', value: 'Acme', provider: SN, confidence: 0.9, observedAt: T_SN });
    await newAssertion({ org: ORG_A, sourceRecordId: apRec, personId, attribute: 'company', value: 'Acme Corporation', provider: 'apollo-sim', confidence: 0.8, observedAt: T_VENDOR });

    // seniority: NOT authoritative. SN is older AND more confident, and must
    // still lose — this is the assertion that distinguishes the approved narrow
    // rule from the broad one the owner declined.
    await newAssertion({ org: ORG_A, sourceRecordId: snRec, personId, attribute: 'seniority', value: 'director', provider: SN, confidence: 0.9, observedAt: T_SN });
    await newAssertion({ org: ORG_A, sourceRecordId: apRec, personId, attribute: 'seniority', value: 'head', provider: 'apollo-sim', confidence: 0.4, observedAt: T_VENDOR });
  }

  it('TITLE: Sales Navigator wins despite being the OLDEST persisted observation', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      await seedConflict(person);

      const observed = await readObservations(ORG_A, person, 'job_title');
      expect(observed).toHaveLength(3);                 // all three persisted
      const v = selectCanonicalObservation(observed, 'job_title');

      expect(v.selected?.value).toBe('VP Marketing');
      expect(v.selected?.source).toBe(SN);
      expect(v.rule).toBe('authoritative_source');
      expect(v.conflicted).toBe(true);
      expect(new Date(v.selected!.observedAt!).toISOString()).toBe(T_SN);
    });
  });

  it('COMPANY: Sales Navigator wins', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      await seedConflict(person);
      const v = selectCanonicalObservation(await readObservations(ORG_A, person, 'company'), 'company');
      expect(v.selected?.value).toBe('Acme');
      expect(v.rule).toBe('authoritative_source');
    });
  });

  it('SENIORITY: Sales Navigator authority does NOT apply — recency wins', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      await seedConflict(person);
      const v = selectCanonicalObservation(await readObservations(ORG_A, person, 'seniority'), 'seniority');
      // The newer, LESS confident vendor value wins. If Sales Navigator
      // authority had been broadened, this would be 'director'.
      expect(v.selected?.value).toBe('head');
      expect(v.selected?.source).toBe('apollo-sim');
      expect(v.rule).toBe('most_recent');
    });
  });

  it('winning a conflict DELETES NOTHING — every losing observation is still in the database', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      await seedConflict(person);

      selectCanonicalObservation(await readObservations(ORG_A, person, 'job_title'), 'job_title');

      const { rows } = await db.query(
        `SELECT provider, normalized_value FROM public.source_assertions
          WHERE person_id=$1 AND attribute='job_title' ORDER BY provider`, [person]);
      expect(rows.map((r: any) => `${r.provider}=${r.normalized_value}`)).toEqual([
        'apollo-sim=Marketing Manager',
        'salesnav-sim=VP Marketing',
        'zoominfo-sim=Head of Marketing',
      ]);
    });
  });

  it('provenance is persisted with every observation — source, tenant, value and instant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      await seedConflict(person);
      const { rows } = await db.query(
        `SELECT sa.provider, sa.organization_id, sa.observed_at, sa.confidence, sr.source_record_id
           FROM public.source_assertions sa
           JOIN public.source_records sr ON sr.id = sa.source_record_id
          WHERE sa.person_id=$1 AND sa.attribute='job_title' ORDER BY sa.provider`, [person]);
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.organization_id).toBe(ORG_A);
        expect(r.provider).toEqual(expect.any(String));
        expect(r.observed_at).not.toBeNull();
        expect(r.source_record_id).toEqual(expect.any(String));   // external identity retained
      }
    });
  });

  it('observations are tenant-scoped: ORG_B sees none of ORG_A evidence', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      await seedConflict(person);
      expect(await readObservations(ORG_B, person, 'job_title')).toEqual([]);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-FOUNDATION-002 — archive / enrichment interaction', () => {
  it('active is enrichment-eligible; a confirmed archive makes it ineligible', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('enrich');
      const { ports } = pgPorts();

      expect(isEnrichmentEligible(await personStatus(person))).toBe(true);

      const rec = await recommendArchive(
        { organizationId: ORG_A, personId: person, candidacy: CANDIDACY() }, ports);
      // Still eligible: a recommendation is not an archive.
      expect(isEnrichmentEligible(await personStatus(person))).toBe(true);

      await confirmArchiveRecommendation(
        { organizationId: ORG_A, recommendationId: rec.id, reviewedByUserId: reviewer }, ports);
      expect(isEnrichmentEligible(await personStatus(person))).toBe(false);
    });
  });

  it('archival does not erase enrichment history', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const reviewer = await newUser('hist');
      const { ports } = pgPorts();

      // Required columns verified against the 20261015000000 DDL: provider_key,
      // attempt_number, correlation_id and started_at are NOT NULL without
      // defaults, and a CHECK demands exactly one of person_id / account_id.
      await db.query(
        `INSERT INTO public.prospect_enrichment_attempts
           (organization_id, person_id, provider_key, attempt_number, correlation_id, started_at)
         VALUES ($1,$2,'apollo-sim',1,'pi-sim-corr-1', now())`, [ORG_A, person]);

      await archiveProspect({ organizationId: ORG_A, personId: person, actorUserId: reviewer }, ports);

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.prospect_enrichment_attempts
          WHERE organization_id=$1 AND person_id=$2`, [ORG_A, person]);
      expect(rows[0].n).toBe(1);
      expect(await personStatus(person)).toBe('archived');
    });
  });
});
