# Canonical Identity — Guarantees for Future Lead Ingestion

Written at the end of W6. **Nothing here is an implementation.** It records what
the database now guarantees, so a future ingestion system can rely on those
guarantees instead of re-deriving them — and records three requirements that
must shape that system before it is built.

Every guarantee below is enforced by PostgreSQL and covered by the real-schema
suite (`docs/database/real-schema-ci.md`). Application code cannot opt out of
them, which is the point.

## 1. Tenant isolation

**Identity is tenant-scoped. There is no platform-global person or account.**
The same human known to two tenants is two rows, deliberately.

- `unified_persons.company_id` is `NOT NULL` — a person always has a tenant.
- Thirteen of the fourteen inbound foreign keys to `unified_persons` are
  composite: `(person_col, tenant_col) REFERENCES unified_persons (id, company_id)`.
  A tenant-A row referencing a tenant-B person is rejected with `23503`.
- `MATCH SIMPLE` means a NULL reference is still legal, so an unlinked row is
  fine. That is what lets ingestion park unresolved records.
- `ON DELETE SET NULL (person_col)` nulls only the person column; the tenant on
  the surviving row is preserved.

**The one exception:** `users.unified_person_id` is still a simple foreign key.
`users.company_id` is NULL on most rows and the authoritative membership model
is `user_company_roles`, so a composite key there would encode a tenant claim the
schema does not make. Ingestion must not treat `users` as a tenant-owned
identity table.

## 2. Account identity

Two deterministic keys, both tenant-scoped, in priority order:

1. `(organization_id, source, source_reference)` — the provider's own id, which
   survives rebrands.
2. `(organization_id, domain_normalized)`.

**A company name is never an identity key**, and no unique index on `name` or
`legal_name` exists. Name-based resolution is where account resolution silently
becomes fuzzy resolution and two real companies get fused.

When the two keys disagree, the resolver returns `ambiguous` and creates
nothing. Cross-tenant, the same domain and the same provider reference each
produce separate accounts.

## 3. Person identity

`identityResolutionService.resolveUnifiedPerson` is the **only** path that
creates a person. Ingestion must call it rather than inserting directly, or
there will be two answers to "who is this".

`unified_persons.account_id` is the canonical person→account edge.
`identity_claims.account_id` means something different — a claim whose *subject*
is an account. Do not read one as the other.

**Known limitation:** `account_id` is single-valued. One person belongs to one
account at a time, with no history and no simultaneous multi-account. Consultants,
agency contacts and job changes will hit this. Extending it is additive (a
`prospect_account_members` table needs no change to the column), but it is not
built.

## 4. Claim provenance

Every `identity_claim` carries `source`, `confidence`, `first_seen_at` and a
canonicalisation version. Uniqueness is
`(organization_id, claim_type, platform, normalized_value)` where `revoked_at IS NULL`,
**with `NULLS NOT DISTINCT`** — essential, because `platform` is NULL for email,
phone and domain claims and without it those would not deduplicate at all.

`confidence` describes certainty about the **evidence**, not verified human
identity. `1` means "a provider asserted this id", not "this person is real".

## 5. Deterministic identifiers

Idempotency comes from **database constraints**, not from SELECT-then-INSERT —
which is a lost-update bug under concurrency. The established pattern:

> attempt the INSERT; on `23505`, re-resolve.

The suite proves that two concurrent sessions racing on the same account
evidence or the same claim produce exactly one canonical row, and that a person
cannot be re-tenanted out from under a live reference.

**The index is partial, so `ON CONFLICT` cannot infer it** — an upsert against
it raises `42P10`. This is why claim persistence inserts and catches `23505`.
Ingestion must do the same.

## 6. Duplicate detection boundaries

What the database decides, and what it does not:

| Decided by the database | Left to the application |
|---|---|
| exact duplicate on a deterministic key | *possible* duplicates |
| cross-tenant separation | which of two candidates is canonical |
| claim uniqueness within a tenant | whether two similar people are one person |

There is **no fuzzy matching, no probabilistic scoring, and no silent merge**
anywhere in this spine. `unified_person_merges` now constrains both the winner
and the loser to the same tenant, and rejects a loser that does not exist.

---

# Requirements recorded for future phases

Recorded, **not implemented**.

## R1 — Multi-source ingestion

Sources will eventually include Omnivyra-native capture, Apollo, LinkedIn /
Sales Navigator where permitted, RapidAPI-backed providers, other API providers,
CRM, Excel / CSV, and manual entry.

**No provider may become the canonical identity system.** Every provider is
evidence, recorded as a claim with its own `source` and `source_reference`. The
canonical person and account remain Omnivyra's, tenant-scoped, so that losing or
replacing a provider never destroys identity. `(organization_id, source,
source_reference)` already gives each provider its own namespace within a tenant.

## R2 — Duplicates must be reviewable, never silently discarded

The pipeline must be:

```
INGEST → NORMALIZE → IDENTIFY → DUPLICATE CLASSIFY → PARK REVIEWABLE DUPLICATES
       → USER DECISION → CANONICALIZE → ENRICH → ENGAGE
```

Classes: `EXACT DUPLICATE`, `POSSIBLE PERSON DUPLICATE`,
`POSSIBLE ACCOUNT DUPLICATE`, `CONFLICTING RECORD`, `NO MATCH`.

Only `EXACT DUPLICATE` is decidable by the database today; the rest are
application judgements and must be **parked for a human**, not dropped. The UI
must distinguish reviewable duplicates and **explain why** Omnivyra considers
them duplicates — which evidence matched, and on which key.

This is why the ingestion path must be able to park an unresolved record:
`MATCH SIMPLE` and the nullable person references exist to make that legal.

## R3 — Cross-channel contact fatigue

The same person must not receive email, phone and WhatsApp separately because
each channel keeps its own list.

Contact governance must key on **canonical person identity** plus tenant-scoped
contact history, and must cover DNC, unsubscribe, contact frequency, channel
suppression, scheduled follow-up, and cross-channel coordination.

Suppression is **tenant-scoped, never platform-global** — a person's DNC in one
tenant says nothing about another.

The canonical spine makes this expressible for the first time: before it, a
person had no single identity to hang contact history from. Nothing in W0–W6
implements any of it.
