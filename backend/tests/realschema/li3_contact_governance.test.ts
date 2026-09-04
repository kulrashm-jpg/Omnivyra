/**
 * LI-3B — contact governance, against real PostgreSQL.
 *
 * The properties that matter cannot be mocked: that a CHECK refuses a
 * `dnc_permanent` scoped to one channel, that a partial unique index makes a
 * repeated unsubscribe a no-op while still permitting a transition to a
 * permanent DNC, and — the decisive one — that deleting a person leaves the
 * instruction standing with its tenant and target intact.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';
import { createHash } from 'node:crypto';

const h = (s: string) => createHash('sha256').update(s).digest('hex');

const INS = `INSERT INTO public.contact_governance_records
  (organization_id, person_id, target_normalized, channel, governance_type, source, effective_until)
  VALUES ($1,$2,$3,$4,$5,'li3-test',$6)`;

const ins = (org: string, person: string | null, target: string | null,
  channel: string, type: string, until: string | null = null) =>
  attempt(INS, [org, person, target, channel, type, until]);

async function insert(org: string, person: string | null, target: string | null,
  channel: string, type: string, until: string | null = null): Promise<string> {
  const { rows } = await db.query(`${INS} RETURNING id`, [org, person, target, channel, type, until]);
  return rows[0].id;
}

describe('LI-3B — schema shape', () => {
  it('exists, tenant-scoped, RLS enabled', async () => {
    const { rows } = await db.query(`
      SELECT c.relrowsecurity rls,
             (SELECT count(*)::int FROM pg_attribute a
               WHERE a.attrelid=c.oid AND a.attname='organization_id' AND NOT a.attisdropped AND a.attnotnull) tenant
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='contact_governance_records'`);
    expect(rows[0].rls).toBe(true);
    expect(rows[0].tenant).toBe(1);
  });

  it('the tenant key is uuid with a REAL foreign key to companies — D-1', async () => {
    const { rows: col } = await db.query(
      `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
        WHERE attrelid='public.contact_governance_records'::regclass AND attname='organization_id'`);
    expect(col[0].t).toBe('uuid');

    const { rows: fk } = await db.query(`
      SELECT pg_get_constraintdef(con.oid) d FROM pg_constraint con
      JOIN pg_class s ON s.oid=con.conrelid JOIN pg_class t ON t.oid=con.confrelid
      WHERE con.contype='f' AND s.relname='contact_governance_records' AND t.relname='companies'`);
    expect(fk).toHaveLength(1);
    expect(fk[0].d).toMatch(/FOREIGN KEY \(organization_id\) REFERENCES companies\(id\)/);
  });

  it('has NO global-scope column and no is_suppressed boolean', async () => {
    const { rows } = await db.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid='public.contact_governance_records'::regclass AND attnum>0 AND NOT attisdropped`);
    const names = rows.map((r: any) => r.attname);
    for (const forbidden of ['scope', 'is_suppressed', 'suppressed', 'company_id', 'active']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('has 2 composite tenant-safe foreign keys', async () => {
    const { rows } = await db.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) d FROM pg_constraint con
      JOIN pg_class s ON s.oid=con.conrelid
      WHERE con.contype='f' AND s.relname='contact_governance_records' AND array_length(con.conkey,1)=2
      ORDER BY con.conname`);
    expect(rows).toHaveLength(2);
    for (const r of rows as any[]) expect(r.d).toMatch(/, organization_id\)/);
    expect(rows.map((r: any) => r.d).join(' ')).toMatch(/SET NULL \(person_id\)/);
  });

  it('the idempotency index is PARTIAL — so ON CONFLICT must not be used', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_contact_governance_identity'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/WHERE \(revoked_at IS NULL\)/);
  });
});

describe('LI-3B — governance type and channel CHECKs', () => {
  it('accepts every ADR type', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const cases: Array<[string, string, string | null]> = [
        ['dnc_permanent', '*', null],
        ['dnc_channel', 'email', null],
        ['unsubscribe', 'email', null],
        ['consent_withdrawn', 'email', null],
        ['invalid_contact', 'phone', null],
        ['bounce_hard', 'email', null],
        ['complaint', 'email', null],
        ['deferred', 'phone', '2027-01-01T00:00:00Z'],
        ['campaign_exclusion', 'email', null],
      ];
      for (const [type, ch, until] of cases) {
        expect(await ins(ORG_A, p, `t-${type}@x.test`, ch, type, until)).toBe('ok');
      }
    });
  });

  it('rejects a type outside the vocabulary', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      for (const bad of ['is_suppressed', 'dnc', 'suppressed', 'opt_out']) {
        expect(await ins(ORG_A, p, null, 'email', bad)).toBe('23514');
      }
    });
  });

  it('dnc_permanent MUST be channel `*` — ADR §10', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await ins(ORG_A, p, null, 'email', 'dnc_permanent')).toBe('23514');
      expect(await ins(ORG_A, p, null, '*', 'dnc_permanent')).toBe('ok');
    });
  });

  it('dnc_channel MUST name a channel', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await ins(ORG_A, p, null, '*', 'dnc_channel')).toBe('23514');
      expect(await ins(ORG_A, p, null, 'whatsapp', 'dnc_channel')).toBe('ok');
    });
  });

  it('only a deferment may carry an end date', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await ins(ORG_A, p, null, 'email', 'unsubscribe', '2027-01-01T00:00:00Z')).toBe('23514');
      expect(await ins(ORG_A, p, null, 'email', 'deferred', '2027-01-01T00:00:00Z')).toBe('ok');
    });
  });

  it('a record anchored to neither person nor target is rejected', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await ins(ORG_A, null, null, 'email', 'unsubscribe')).toBe('23514');
      expect(await ins(ORG_A, null, 'anchored@x.test', 'email', 'unsubscribe')).toBe('ok');
    });
  });

  it('rejects a blank channel and a blank target', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await ins(ORG_A, p, null, '   ', 'unsubscribe')).toBe('23514');
      expect(await ins(ORG_A, null, '  ', 'email', 'unsubscribe')).toBe('23514');
    });
  });

  it('revocation requires a reason', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, null, 'email', 'unsubscribe');
      expect(await attempt(`UPDATE public.contact_governance_records SET revoked_at=now() WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='resubscribed' WHERE id=$1`, [id])).toBe('ok');
    });
  });
});

describe('LI-3B — tenant isolation', () => {
  it('a governance record cannot reference another tenant\'s person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pB = await newPerson(ORG_B);
      expect(await ins(ORG_A, pB, null, 'email', 'unsubscribe')).toBe('23503');
    });
  });

  it('a governance record cannot reference another tenant\'s source record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { rows } = await db.query(
        `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id, raw_payload, payload_hash)
         VALUES ($1,'li3','person','SR-B','{}'::jsonb,$2) RETURNING id`, [ORG_B, h('p')]);
      expect(await attempt(
        `INSERT INTO public.contact_governance_records
          (organization_id, target_normalized, channel, governance_type, source, source_record_id)
         VALUES ($1,'x@y.test','email','unsubscribe','li3-test',$2)`, [ORG_A, rows[0].id])).toBe('23503');
    });
  });

  it('a governance record cannot reference a nonexistent tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await ins('00000000-0000-0000-0000-000000000000', null, 'ghost@x.test', 'email', 'unsubscribe')).toBe('23503');
    });
  });

  it('the same target is governed independently in two tenants', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await insert(ORG_A, null, 'shared@x.test', 'email', 'dnc_channel');
      const b = await insert(ORG_B, null, 'shared@x.test', 'email', 'dnc_channel');
      expect(a).not.toBe(b);
      // Tenant A's DNC is invisible to a tenant-B scoped read, and vice versa.
      const seenByB = await db.query(
        `SELECT count(*)::int n FROM public.contact_governance_records
          WHERE organization_id=$1 AND target_normalized='shared@x.test'`, [ORG_B]);
      expect(seenByB.rows[0].n).toBe(1);
      const total = await db.query(
        `SELECT count(*)::int n FROM public.contact_governance_records WHERE target_normalized='shared@x.test'`);
      expect(total.rows[0].n).toBe(2);
    });
  });

  it('a tenant-scoped read cannot see another tenant\'s record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const b = await insert(ORG_B, null, 'b-only@x.test', 'email', 'dnc_channel');
      const { rows } = await db.query(
        `SELECT id FROM public.contact_governance_records WHERE organization_id=$1 AND id=$2`, [ORG_A, b]);
      expect(rows).toHaveLength(0);
    });
  });

  it('a tenant-scoped update cannot revoke another tenant\'s record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const b = await insert(ORG_B, null, 'b-only2@x.test', 'email', 'dnc_channel');
      const res = await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='hijack'
          WHERE organization_id=$1 AND id=$2`, [ORG_A, b]);
      expect(res.rowCount).toBe(0);
      const { rows } = await db.query(`SELECT revoked_at FROM public.contact_governance_records WHERE id=$1`, [b]);
      expect(rows[0].revoked_at).toBeNull();
    });
  });

  it('a record cannot be moved to another tenant while it holds a person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pA = await newPerson(ORG_A);
      const id = await insert(ORG_A, pA, null, 'email', 'unsubscribe');
      expect(await attempt(
        `UPDATE public.contact_governance_records SET organization_id=$1 WHERE id=$2`, [ORG_B, id])).toBe('23503');
    });
  });
});

describe('LI-3B — idempotency', () => {
  it('the same instruction twice is rejected', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, null, 'email', 'unsubscribe');
      expect(await ins(ORG_A, p, null, 'email', 'unsubscribe')).toBe('23505');
    });
  });

  it('a DIFFERENT type for the same person is allowed — the transition is representable', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      // Both must PERSIST, so both use insert(); `ins()` probes acceptance and
      // rolls its own statement back, which would make the count meaningless.
      await insert(ORG_A, p, null, 'email', 'deferred', '2027-01-01T00:00:00Z');
      await insert(ORG_A, p, null, 'email', 'dnc_channel');
      const { rows } = await db.query(
        `SELECT governance_type FROM public.contact_governance_records WHERE person_id=$1 ORDER BY governance_type`, [p]);
      // Both survive: the transition is representable and the history is intact.
      expect(rows.map((r: any) => r.governance_type)).toEqual(['deferred', 'dnc_channel']);
    });
  });

  it('a different channel for the same person is allowed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, null, 'email', 'dnc_channel');
      expect(await ins(ORG_A, p, null, 'phone', 'dnc_channel')).toBe('ok');
    });
  });

  it('revoking releases the key so the same instruction can be recorded again', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, null, 'email', 'unsubscribe');
      expect(await ins(ORG_A, p, null, 'email', 'unsubscribe')).toBe('23505');
      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='resubscribed' WHERE id=$1`, [id]);
      // Re-subscribe then unsubscribe again must be expressible.
      expect(await ins(ORG_A, p, null, 'email', 'unsubscribe')).toBe('ok');
    });
  });

  it('the key falls back to target when there is no person', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(ORG_A, null, 'dup@x.test', 'email', 'unsubscribe');
      expect(await ins(ORG_A, null, 'dup@x.test', 'email', 'unsubscribe')).toBe('23505');
      expect(await ins(ORG_A, null, 'other@x.test', 'email', 'unsubscribe')).toBe('ok');
    });
  });
});

describe('LI-3B — D-3: the instruction outlives the person', () => {
  it('deleting the person preserves the record, its tenant and its target', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, 'survivor@x.test', 'email', 'unsubscribe');

      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [p]);

      const { rows } = await db.query(
        `SELECT organization_id, person_id, target_normalized, governance_type
           FROM public.contact_governance_records WHERE id=$1`, [id]);
      expect(rows).toHaveLength(1);                        // survived
      expect(rows[0].person_id).toBeNull();                // link nulled
      expect(rows[0].organization_id).toBe(ORG_A);         // tenant preserved
      expect(rows[0].target_normalized).toBe('survivor@x.test'); // still matchable
      expect(rows[0].governance_type).toBe('unsubscribe');
    });
  });

  it('deleting the source record preserves the governance record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { rows: sr } = await db.query(
        `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id, raw_payload, payload_hash)
         VALUES ($1,'li3','person','SR-1','{}'::jsonb,$2) RETURNING id`, [ORG_A, h('p')]);
      const { rows: g } = await db.query(
        `INSERT INTO public.contact_governance_records
          (organization_id, target_normalized, channel, governance_type, source, source_record_id)
         VALUES ($1,'ev@x.test','email','unsubscribe','li3-test',$2) RETURNING id`, [ORG_A, sr[0].id]);
      await db.query('DELETE FROM public.source_records WHERE id=$1', [sr[0].id]);
      const { rows } = await db.query(
        `SELECT organization_id, source_record_id FROM public.contact_governance_records WHERE id=$1`, [g[0].id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].source_record_id).toBeNull();
      expect(rows[0].organization_id).toBe(ORG_A);
    });
  });
});

describe('LI-3B — the legacy stacks are untouched', () => {
  it('both legacy suppression tables still exist and are empty', async () => {
    const { rows } = await db.query(`
      SELECT (SELECT count(*)::int FROM public.suppression_entries) se,
             (SELECT count(*)::int FROM public.outreach_suppressions) os`);
    expect(rows[0]).toEqual({ se: 0, os: 0 });
  });

  it('LI-1 and LI-2 surfaces are intact', async () => {
    const { rows } = await db.query(`
      SELECT (SELECT count(*)::int FROM pg_attribute
               WHERE attrelid='public.unified_persons'::regclass AND NOT attisdropped
                 AND attname = ANY(ARRAY['full_name','job_title','seniority','attributes_source'])) li1,
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname IN ('source_records','source_assertions')) li2`);
    expect(rows[0].li1).toBe(4);
    expect(rows[0].li2).toBe(2);
  });
});
