# DATABASE_IDENTITY_INTEGRITY_AUDIT.md

Phase 11B — does the **database itself** guarantee company identity consistency?
**Audit only — no migrations, no schema changes, no code changes, no DDL.**

Method: authoritative analysis of the declared schema DDL in `supabase/migrations/*`
(the source of truth for constraints), cross-checked against live data already
observed in prior phases. **No probe writes were performed against production**; where
live data already proves a behavior, it is cited as evidence.

## Bottom line

**If application code is bypassed, the database WILL accept inconsistent company
identity.** The only company-level identity constraint is a UNIQUE index on
`admin_email_domain`. There is **no** CHECK, trigger, generated column, or
website⇔website_domain linkage. All four application invariants (A–D) are
**NOT_ENFORCED** at the database layer.

---

## SECTION 1 — Column inventory (`companies`)

| Column | Type | Nullable | Default | Indexes | Unique |
|---|---|---|---|---|---|
| `website` | `text` | **YES** (no NOT NULL; null written successfully in Phase 10B) | none | none | none |
| `website_domain` | `text` | YES | none | `idx_companies_website_domain` (partial, `WHERE website_domain IS NOT NULL`) — **non-unique** | **none** |
| `admin_email_domain` | `text` | YES | none | `idx_companies_admin_email_domain_unique` (partial, `WHERE admin_email_domain IS NOT NULL`) | **YES (partial UNIQUE)** |

Evidence: `20260321_company_website_domain.sql:5-26`, `20260321_company_email_domain.sql:5-10`,
`20260322_domain_credit_hardening.sql:14-18` (drops the non-unique index, adds the
UNIQUE one). `website` predates these migrations (base table); no DDL sets a default or
NOT NULL, and Phase-10B wrote `website = NULL` successfully → confirmed nullable.

## SECTION 2 — Constraint inventory (affecting the 3 columns)

| Protection type | Present? | Detail / evidence |
|---|---|---|
| CHECK constraints | **None** | No `CHECK` references `website`/`website_domain`/`admin_email_domain` in any migration. |
| UNIQUE constraints | **One** | `idx_companies_admin_email_domain_unique` on `admin_email_domain WHERE NOT NULL` (`20260322_domain_credit_hardening.sql:16-18`). **No UNIQUE on `website_domain` or `website`.** |
| FK constraints | **None** (on these columns) | These are plain text columns, not FKs. |
| Triggers | **None on `companies` for these columns** | Triggers found are on other tables. Closest: `trg_user_company_roles_self_joined_domain_guard` + `trg_users_active_company_membership_guard` (`20260510:144-195`) which **READ** `companies.website_domain`/`admin_email_domain` via `omnivyra_self_joined_role_matches_company_domain()` to gate *membership* writes — they do **not** constrain identity writes to `companies`. |
| Generated columns | **None** | No `GENERATED ALWAYS` on these columns (generated columns exist only on unrelated cost/score tables). |
| RLS policies | **None gating these columns** | No `CREATE POLICY ... ON companies` restricting identity writes; and the service role (used by every write path) bypasses RLS regardless. |
| DB functions | Read-only | `omnivyra_self_joined_role_matches_company_domain(user_id, company_id)` (`20260510:43-76`) reads both domain columns for membership matching. It does not validate or enforce identity consistency on write. |

Related (separate table): `company_domains.domain` carries `CONSTRAINT
company_domains_domain_unique UNIQUE (domain)` (`20260406:87`) — canonical
domain-ownership uniqueness lives there, **not** on `companies.website_domain`.

## SECTION 3 — Invariant coverage matrix

| Invariant | Statement | DB enforcement | Why |
|---|---|---|---|
| A | `website IS NULL ⇔ website_domain IS NULL` | **NOT_ENFORCED** | No CHECK links the two; both independently nullable. |
| B | `website populated ⇒ website_domain populated` | **NOT_ENFORCED** | No CHECK/trigger. |
| C | `website_domain` normalized | **NOT_ENFORCED** | One-time normalization in `20260321`/`20260325`, but nothing constrains/normalizes new writes. Free text. |
| D | no partial identity writes | **NOT_ENFORCED** | No constraint binds the pair atomically. |

The database enforces **0 of 4** identity invariants. The lone `admin_email_domain`
UNIQUE index is a *duplicate-prevention* guarantee, not a *consistency* one.

## SECTION 4 — Bypass test (direct SQL, application bypassed)

Derived from the constraint inventory (no CHECK/trigger exists → the write is
accepted). No production probe writes were performed.

| Case | Direct write | Result | Evidence |
|---|---|---|---|
| 1 | `website='https://acme.com'`, `website_domain=NULL` | **ALLOWED** | No CHECK links website↔website_domain (Invariant A/B not enforced). |
| 2 | `website=NULL`, `website_domain='acme.com'` | **ALLOWED** | No CHECK; `website` nullable. (And `website_domain` non-unique.) |
| 3 | `website_domain='NOT_A_DOMAIN'` | **ALLOWED** | `website_domain` is free `text`, no format CHECK (Invariant C not enforced). |
| 4 | `admin_email_domain='INVALID'` | **ALLOWED (format)** | No format CHECK. *Only* constraint is uniqueness: rejected **only** if another row already has `admin_email_domain='INVALID'` (else accepted as-is). |

→ Every inconsistent/invalid identity write is accepted by the database, except a
literal duplicate of an existing non-null `admin_email_domain`.

## SECTION 5 — Duplicate domain protection

**Question:** Company A `website_domain='acme.com'` and Company B `website_domain='acme.com'`.

**Result: ALLOWED.** There is no UNIQUE constraint on `companies.website_domain` (only
a non-unique partial index).

**Live evidence:** ~24 QA companies in the production DB currently share
`website_domain='omnivyra.com'` simultaneously (observed in the Phase-10 drift audit) —
direct proof that duplicate `website_domain` rows coexist.

Where duplicate protection *does* exist:
- `companies.admin_email_domain` — UNIQUE partial index → two companies cannot share a
  non-null `admin_email_domain` (this is what raises the `23505` race handled in
  setup-company).
- `company_domains.domain` — `UNIQUE(domain)` → canonical one-company-per-domain.

**Risk:** because `website_domain` itself is non-unique, domain→company resolution that
keys on `website_domain` (e.g. `findMatchingCompany` step 1, setup-company domain-first
lookup, `company-domain-check`) can match the *wrong* or *multiple* companies if a
duplicate is ever written. Today this is masked because `admin_email_domain` (unique)
usually coincides — but nothing guarantees it.

## SECTION 6 — Future constraint plan (recommendations only — NO DDL)

### LOW RISK
- **Pair CHECK for Invariants A/B/D**: `CHECK ((website IS NULL) = (website_domain IS NULL))`,
  added `NOT VALID` first (instant, no table scan), validated after confirming no row
  violates it. Backstops the `companyIdentityWriter` pair guarantee at the DB.
- **`website_domain` lowercase/trim CHECK**: `CHECK (website_domain = lower(btrim(website_domain)))`
  added `NOT VALID` — cheap normalization guard.

### MEDIUM RISK
- **`website_domain` format CHECK** (e.g. must contain a dot, no scheme/`www.`): could
  reject legacy odd values; needs a data pre-scan before `VALIDATE`.
- **Normalization trigger**: `BEFORE INSERT/UPDATE` to derive/normalize `website_domain`
  from `website`. Backstops Invariant C but is a behavioral change (auto-mutates writes).

### HIGH RISK
- **UNIQUE(`website_domain`) partial index**: would **fail to create** against current
  data (the ~24 `omnivyra.com` QA duplicates) and could break legitimate multi-entity
  cases. Requires deduplication + a product decision first.
- **`NOT NULL` on `website`/`website_domain`**: breaks the nullable identity model and
  existing NULL rows (e.g. any company created without a validated website). High blast
  radius.

Recommended sequence (future, gated): clean QA/test rows → add the LOW-RISK pair +
lowercase CHECKs `NOT VALID` → `VALIDATE` → consider MEDIUM items → defer HIGH items
pending dedupe + product sign-off.

---

## Findings summary

- DB enforces **0/4** identity invariants (A–D all NOT_ENFORCED).
- Only company-level identity constraint: **UNIQUE `admin_email_domain`** (partial).
- `website_domain` is **non-unique** → duplicate domains allowed (live: 24× `omnivyra.com`).
- All 4 bypass cases would be **accepted** by direct SQL (except a literal
  `admin_email_domain` duplicate).
- The application layer (`companyIdentityWriter`, drift telemetry, setup-company
  governance) is currently the **only** thing preventing inconsistent identity — there
  is no database backstop.

No DDL, migrations, schema, or code changes were made. Recommendations are advisory.
