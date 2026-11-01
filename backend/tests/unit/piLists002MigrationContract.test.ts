/**
 * PI LISTS-001 — what migration 20261127000000 DECLARES.
 *
 * ─── THE CLAIM THIS SUITE MAKES, AND THE ONE IT DOES NOT ──────────────────
 * It reads the migration SQL as text and asserts that the constraints the
 * feature depends on are WRITTEN DOWN. That is a real guarantee against a
 * regression — someone weakening the uniqueness index or flipping a cascade
 * fails this build — and it is NOT evidence that any database enforces them.
 *
 * Enforcement needs a real schema. The migration has deliberately NOT been
 * applied anywhere, so uniqueness, the composite foreign keys, the CHECKs, the
 * cascade on erasure and RLS are all `UNVERIFIED` at the database level and a
 * real-schema suite is the only thing that could change that.
 *
 * This file exists because the alternative is worse: asserting these properties
 * through an in-memory double would let a fake's behaviour stand in for the
 * database's, which is exactly how a constraint gets quietly dropped.
 */

const MIGRATION = 'supabase/migrations/20261127000000_pi_prospect_lists.sql';

const raw = (): string => require('fs').readFileSync(
  require('path').join(process.cwd(), MIGRATION), 'utf8');

/**
 * STATEMENTS, not prose.
 *
 * The migration's header quotes the existing `idx_canonical_leads_id_company`
 * definition and names `unified_persons` precisely to record that it does not
 * touch them — so a scan of the raw file would find both and conclude the
 * opposite. Every assertion below reads comment-stripped SQL, which is also
 * what stops a positive assertion being satisfied by a comment that merely
 * describes the constraint.
 */
const sql = (): string => raw()
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');

/** Whitespace-insensitive search, so SQL formatting is not the contract. */
const declares = (needle: string): boolean => {
  const flat = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  return flat(sql()).includes(flat(needle));
};

/**
 * DDL only — statements with their STRING LITERALS blanked out.
 *
 * `COMMENT ON TABLE … IS '…'` is a statement, so comment-stripping leaves it,
 * and the corrected comment legitimately names `unified_persons` to record that
 * person erasure does NOT reach this table. Naming a table inside a string is
 * not touching it, so the forbidden-table scan reads this instead.
 */
const ddl = (): string => sql().replace(/'(?:[^']|'')*'/g, "''");

describe('the migration creates exactly the two tables, and no more', () => {
  it('1. creates prospect_lists and prospect_list_members', () => {
    expect(declares('create table if not exists public.prospect_lists')).toBe(true);
    expect(declares('create table if not exists public.prospect_list_members')).toBe(true);
  });

  it('2. creates NO other table, and alters no existing one', () => {
    const created = [...sql().matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\S+)/gi)]
      .map((m) => m[1].toLowerCase());
    expect(created.sort()).toEqual(['public.prospect_list_members', 'public.prospect_lists']);

    // The only ALTER TABLE statements are the two RLS enables on its own tables.
    const altered = [...sql().matchAll(/alter\s+table\s+(\S+)/gi)].map((m) => m[1].toLowerCase());
    expect(new Set(altered)).toEqual(new Set(['public.prospect_list_members', 'public.prospect_lists']));
  });

  it('3. does not touch canonical_leads, unified_persons or any PI canonical table', () => {
    const body = ddl().toLowerCase();
    // canonical_leads appears ONLY as a foreign-key target, never as a target of
    // a write, an alter or an index.
    expect(body).not.toMatch(/alter\s+table\s+(public\.)?canonical_leads/);
    expect(body).not.toMatch(/create\s+(unique\s+)?index[^;]*on\s+(public\.)?canonical_leads/);
    // The other canonical tables are never named in DDL at all — not as a
    // reference target, not altered, not indexed, not written.
    for (const table of ['unified_persons', 'prospect_accounts', 'source_records', 'source_assertions',
      'canonical_attribute_decisions', 'attribute_authority_declarations']) {
      expect(body).not.toMatch(new RegExp(`references[^;]*\\b${table}\\b`));
      expect(body).not.toMatch(new RegExp(`alter\\s+table\\s+(public\\.)?${table}\\b`));
      expect(body).not.toMatch(new RegExp(`\\bon\\s+(public\\.)?${table}\\b`));
      expect(body).not.toMatch(new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${table}\\b`));
    }
    // No data movement of any kind.
    expect(body).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/);
  });
});

describe('tenant-safe foreign keys, with the tenant as the second leg', () => {
  it('4. the list reference carries the tenant and CASCADEs from the list', () => {
    expect(declares(
      'foreign key (list_id, organization_id) references public.prospect_lists (id, organization_id) on delete cascade',
    )).toBe(true);
  });

  it('5. the prospect reference carries the tenant and targets canonical_leads(id, company_id)', () => {
    // The deliberate name asymmetry: organization_id here, company_id there.
    expect(declares(
      'foreign key (prospect_id, organization_id) references public.canonical_leads (id, company_id) on delete cascade',
    )).toBe(true);
  });

  it('6. both tables anchor their tenant to companies(id)', () => {
    const occurrences = sql().toLowerCase().split('references public.companies (id) on delete cascade').length - 1;
    expect(occurrences).toBe(2);
  });

  it('7. publishes the composite target its own members table needs', () => {
    expect(declares(
      'create unique index if not exists uq_prospect_lists_id_org on public.prospect_lists (id, organization_id)',
    )).toBe(true);
  });
});

describe('duplicate membership is prevented at the database', () => {
  it('8. a UNIQUE index on (organization_id, list_id, prospect_id), partial on active', () => {
    expect(declares(
      'create unique index if not exists uq_prospect_list_members_active '
      + 'on public.prospect_list_members (organization_id, list_id, prospect_id) where status = \'active\'',
    )).toBe(true);
  });

  it('9. the index is PARTIAL on purpose — a total one would destroy removal history', () => {
    // If someone drops the WHERE clause, re-adding a removed prospect would
    // have to overwrite the removed row. The predicate is the contract.
    const index = sql().match(/uq_prospect_list_members_active[\s\S]*?;/i)?.[0] ?? '';
    expect(index.toLowerCase()).toContain("where status = 'active'");
  });
});

describe('deletion semantics: three questions, three answers', () => {
  it('10. nothing here can delete a canonical prospect', () => {
    // Both cascades run FROM a parent TO a membership. There is no statement
    // that deletes, or cascades into, canonical_leads.
    const body = sql().toLowerCase();
    expect(body).not.toMatch(/delete\s+from\s+(public\.)?canonical_leads/);
    expect(body).not.toMatch(/references\s+public\.prospect_list_members/);
  });

  it('11. removal is SOFT — status, timestamp, actor and reason all exist', () => {
    for (const column of ['status', 'removed_at', 'removed_by_user_id', 'removal_reason']) {
      expect(sql().toLowerCase()).toContain(column);
    }
    expect(declares("check (status in ('active', 'removed'))")).toBe(true);
  });

  it('12. F-3: an ACTIVE row may carry NO removal data of any kind', () => {
    // The earlier revision constrained only `removed_at`, so an active row
    // could keep a stray actor or reason from a half-written update.
    expect(declares('constraint prospect_list_members_removal_coherent')).toBe(true);
    expect(declares(
      "(status = 'active' and removed_at is null and removed_by_user_id is null and removal_reason is null)",
    )).toBe(true);
  });

  it('12a. F-3: a REMOVED row must carry its timestamp', () => {
    // 'removed' without a timestamp would read as a live membership.
    expect(declares("(status = 'removed' and removed_at is not null)")).toBe(true);
  });

  it('12b. F-3: the removed branch does NOT constrain the actor — SET NULL must stay legal', () => {
    // `removed_by_user_id` is ON DELETE SET NULL. Requiring it non-null on a
    // removed row would make deleting a user fail, or corrupt the very trail
    // the column exists to keep.
    const flat = sql().replace(/\s+/g, ' ').toLowerCase();
    const removedBranch = flat.split("status = 'removed'")[1]?.slice(0, 120) ?? '';
    expect(removedBranch).toContain('removed_at is not null');
    expect(removedBranch).not.toContain('removed_by_user_id is not null');
    expect(removedBranch).not.toContain('removal_reason is not null');
  });

  it('12c. F-3: removal_reason and the actor are nullable columns', () => {
    // Decided, not left vague: a user need not justify a removal, and a
    // required reason would produce placeholder text that reads like evidence.
    expect(ddl().toLowerCase()).not.toMatch(/removal_reason\s+text\s+not\s+null/);
    expect(ddl().toLowerCase()).not.toMatch(/removed_by_user_id\s+uuid\s+not\s+null/);
  });

  it('12d. F-3: re-add after removal is not blocked by the constraint', () => {
    // A new row has status 'active' with every removal column NULL, satisfying
    // the first branch; the prior removed row is untouched and satisfies the
    // second. The partial unique index only ever sees the active one.
    expect(declares("where status = 'active'")).toBe(true);
    expect(declares("(status = 'active' and removed_at is null")).toBe(true);
  });

  it('13. a creator or remover leaving does NOT delete the list or the membership', () => {
    const userRefs = sql().toLowerCase().split('references public.users (id) on delete set null').length - 1;
    // created_by_user_id, added_by_user_id, removed_by_user_id.
    expect(userRefs).toBe(3);
  });

  it('13a. F-1: the header no longer claims the cascade is the ERASURE answer', () => {
    // This one assertion is ABOUT THE COMMENT, deliberately: the corrected
    // header is F-1's deliverable, so `raw()` is the right source here.
    const header = raw();
    expect(header).not.toMatch(/This is the ERASURE answer/);
    // And it records what actually happens, naming the mechanism.
    expect(header).toMatch(/NEVER FIRES ON PERSON ERASURE/);
    expect(header).toMatch(/SET NULL \(unified_person_id\)/);
    expect(header).toMatch(/personErasure\.deletePersonRow/);
    expect(header).toMatch(/NO erasure cleanup is implemented here/);
  });

  it('13b. F-1: no erasure cleanup was implemented in this batch', () => {
    // The correction is a statement of fact, not a change of behaviour.
    const body = ddl().toLowerCase();
    expect(body).not.toContain('unified_persons');
    expect(body).not.toMatch(/trigger[^;]*eras/);
  });

  it('14. archive is a status, not a delete', () => {
    expect(declares("check (status in ('active', 'archived'))")).toBe(true);
    expect(sql().toLowerCase()).not.toMatch(/drop\s+table/);
  });
});

describe('provenance and integrity columns', () => {
  it('15. provenance is mandatory and may never be blank', () => {
    expect(declares('added_via text not null')).toBe(true);
    expect(declares('check (length(btrim(added_via)) > 0)')).toBe(true);
    expect(sql().toLowerCase()).toContain('added_at');
    expect(sql().toLowerCase()).toContain('added_by_user_id');
  });

  it('16. a list may never be unnameable', () => {
    expect(declares('check (length(btrim(name)) > 0)')).toBe(true);
  });

  it('17. provenance is NOT a closed vocabulary — a new audience source needs no migration', () => {
    // Mirrors LI-2's reasoning for source_records.provider being free text.
    expect(sql().toLowerCase()).not.toMatch(/check\s*\(\s*added_via\s+in\s*\(/);
  });
});

describe('indexes support the reads the service actually performs', () => {
  it('18. pages members by (added_at DESC, id) within a tenant and list', () => {
    expect(declares(
      'idx_prospect_list_members_list on public.prospect_list_members '
      + '(organization_id, list_id, status, added_at desc, id)',
    )).toBe(true);
  });

  it('19. answers "which lists is this prospect in?"', () => {
    expect(declares(
      'idx_prospect_list_members_prospect on public.prospect_list_members '
      + '(organization_id, prospect_id, status)',
    )).toBe(true);
  });
});

describe('RLS matches the PI convention', () => {
  it('20. both tables enable RLS and carry a service_role policy', () => {
    expect(declares('alter table public.prospect_lists enable row level security')).toBe(true);
    expect(declares('alter table public.prospect_list_members enable row level security')).toBe(true);
    expect(sql()).toContain('prospect_lists_service_role');
    expect(sql()).toContain('prospect_list_members_service_role');
    const policies = sql().split("auth.role() = 'service_role'").length - 1;
    // USING and WITH CHECK on each of the two policies.
    expect(policies).toBe(4);
  });

  it('21. reuses the existing touch function rather than defining a new one', () => {
    expect(declares('execute function public.omnivyra_touch_updated_at()')).toBe(true);
    expect(sql().toLowerCase()).not.toMatch(/create\s+(or\s+replace\s+)?function/);
  });

  it('22. is idempotent — every object guards against re-application', () => {
    const creates = [...sql().matchAll(/create\s+(table|unique\s+index|index)\s+(if\s+not\s+exists)?/gi)];
    for (const m of creates) {
      expect(m[2]).toBeTruthy();
    }
  });
});
