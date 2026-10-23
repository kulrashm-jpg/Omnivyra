# SECURITY_FOLLOWUP_INVENTORY

**Artefact class: ANALYTICAL RESULT (the findings) + EXECUTION EVIDENCE (§2, where a detector was
actually run).**
Not DeepTech evidence. Not a fix. **No fix is implemented in this task**, by instruction.

| Field | Value |
|---|---|
| Base SHA | `af2fb6e99ce461894bf16f18c2251f75088eba18` |
| Worktree | `C:/tmp/dt4-corp` (disposable, detached HEAD) |
| Scope | Open **non-DeepTech** security and correctness follow-ups, independent of CPG-U1 |
| Verification standard | Every "still open" claim below was verified **by this stream at `af2fb6e9`**, with the file:line or the command output shown. Nothing is taken from a document's own status column |
| Read-only | Yes. No commit, no product-code change, no network call, no database access, no credential or `.env*` read |

**Frozen-tree constraint.** All 588 tracked files under `research/` at `af2fb6e9` are under
`research/cpg-u1/` (`git ls-tree -r HEAD --name-only | grep '^research/' | cut -d/ -f2 | sort -u`
-> `cpg-u1`). **None of the findings below touches `research/**` at all** — every implicated path is
under `scripts/`, `pages/api/`, `backend/` or `supabase/migrations/`. The frozen research tree is
untouched by every recommendation in this document, and the recommended order is designed to keep it
that way.

---

## Priority summary

| # | Finding | Severity | Status at `af2fb6e9` | Touches frozen tree? | Needs a production-deployment decision? |
|---|---|---|---|---|---|
| **L-01** | `scripts/platform-isolation-check.ts` — absolute-vs-relative path handling silently disables two of three detector rules and the entire allowlist | **HIGH (detector integrity)** | **VERIFIED OPEN** — proven by running it | No | **No** — a dev-only script; nothing ships |
| **L-02** | `scripts/platform-isolation-check.ts` — overlapping scan roots double-count hits | MEDIUM | **VERIFIED OPEN** — proven by running it | No | **No** |
| **L-03** | `scripts/platform-isolation-check.ts` — 2 stale allowlist entries; 3 further entries are no-ops; detector is not wired into CI or any npm script | MEDIUM | **VERIFIED OPEN** | No | **No** |
| **L-04** | Role **value** is never validated on the user-management write path, and there is no DB-level constraint | **HIGH** | **VERIFIED OPEN** | No | **Yes** — a validation change can reject writes that currently succeed |
| **L-05** | `requireUserAdminAccess` compares against `Role.ADMIN`, which `normalizeRole` can never return — the entire company-admin branch is unreachable | **HIGH (correctness)** | **VERIFIED OPEN** | No | **Yes** — fixing it grants access that is currently refused |
| **L-06** | `scheduled_posts` has no `company_id`; tenant scope is derived | MEDIUM | **VERIFIED OPEN** (schema migration + backfill outstanding) | No | **Yes** — migration + backfill |
| **L-07** | 403-vs-404 existence oracle on campaign resources | P3 | **NOT OPEN — ACCEPTED AND DOCUMENTED**, verified | No | N/A |
| **L-08** | Stray Vercel project | — | **UNVERIFIED** — not determinable without a network call, which is prohibited in this task | No | Unknown |

---

## L-01 — `platform-isolation-check.ts` reports absolute paths, disabling two of three rules and the whole allowlist

**Severity: HIGH (detector integrity).** Status: **VERIFIED OPEN.**

### What it is

`scripts/platform-isolation-check.ts` is the static detector for platform/tenant authority-boundary
violations. It defines three rules and an allowlist. Two of the three rules and the allowlist are
keyed on a **repository-relative** path; the value actually supplied is **absolute**.

`scripts/platform-isolation-check.ts:122-124` builds an absolute root:

```
  const cwd = process.cwd();
  ...
    const root = join(cwd, d);
```

`walk()` (lines 75-86) yields `join(root, entry)` — still absolute. `scanFile()` line 89 then does:

```
  const rel = file.replace(/\\/g, '/');
```

That converts separators but **does not strip the repository prefix**, so `rel` is
`C:/tmp/dt4-corp/pages/api/super-admin/....ts`, not `pages/api/super-admin/....ts`. Three consumers
of `rel` are therefore dead:

- line 90 — `if (ALLOWLIST.has(rel)) return [];` — every allowlist entry is repo-relative, so this
  **never matches**. The allowlist is inert.
- line 98 — `if (rel.startsWith('pages/api/super-admin/') && /\brequireSuperAdminUser\s*\(/...)` —
  **never true**. Rule (1) can never fire.
- line 103 — `if (rel.startsWith('pages/api/super-admin/'))` — **never true**. Rule (2) can never fire.

Rule (3) survives, because its guards use `rel.includes(...)` (line 113), which is prefix-independent.

### Evidence it is still open — verified now, by running it

```
$ cd /c/tmp/dt4-corp && /c/virality/node_modules/.bin/tsx scripts/platform-isolation-check.ts
platform-isolation-check: 15 potential boundary issues across 4 scan roots

[role_equality] (15)
  C:/tmp/dt4-corp/pages/api/super-admin/free-credits/grant.ts:116  } else if (existingRole.role === 'SUPER_ADMIN') {
  ...
Allowlisted files: 8
```

Three things this output proves, without argument:

1. **The reported `file` values are absolute** (`C:/tmp/dt4-corp/pages/...`). That is `rel`. It
   confirms the prefix is never stripped.
2. **`super_admin_user_legacy` and `shared_cap_in_platform_route` report zero hits** — they are absent
   from the output entirely. This is a **false negative**, not a clean result:

```
$ grep -rn 'requireSuperAdminUser\s*(' pages/api/super-admin/
pages/api/super-admin/creator-operations.ts:43:  const admin = await requireSuperAdminUser(req, res);
```

   `pages/api/super-admin/creator-operations.ts:43` is exactly what rule (1) exists to find, and the
   detector does not report it.
3. **`Allowlisted files: 8` is printed while the allowlist is inert.** The report actively asserts a
   suppression that is not happening.

### Blast radius

The detector itself ships nothing, so there is no direct runtime exposure. The exposure is
**epistemic and it is the worse kind**: a detector that prints a plausible report while two of its
three rules are switched off invites the conclusion that the platform/tenant boundary is clean when
it has not been checked. One real hit is being suppressed today. Any reviewer, CI gate or audit
document that cites a clean `super_admin_user_legacy` result is citing a result the tool cannot
produce.

### Frozen tree / deployment

Touches `research/**`: **No.** Single file, `scripts/platform-isolation-check.ts`.
Needs a production-deployment decision: **No.** A dev-only script; no runtime path, no route, no
migration, no flag. **Fully isolated.**

---

## L-02 — Overlapping scan roots double-count every hit under `pages/api/super-admin` and `pages/api/admin`

**Severity: MEDIUM.** Status: **VERIFIED OPEN.**

`scripts/platform-isolation-check.ts:42`:

```
const SCAN_DIRS = ['pages/api/super-admin', 'pages/api/admin', 'components', 'pages'] as const;
```

`pages` subsumes `pages/api/super-admin` and `pages/api/admin`, and `main()` (lines 124-134) walks
each root independently with no de-duplication before pushing into `all`. Every file under the two
narrower roots is therefore scanned twice and every hit in it reported twice.

### Evidence — verified from the same run

The output reports `15 potential boundary issues`, but these two lines each appear **twice** in it:

```
  C:/tmp/dt4-corp/pages/api/super-admin/free-credits/grant.ts:116  } else if (existingRole.role === 'SUPER_ADMIN') {
  C:/tmp/dt4-corp/pages/api/super-admin/free-credits/requests.ts:117  } else if (existingRole.role === 'SUPER_ADMIN') {
```

**15 reported, 13 distinct.** The headline count is inflated by 15.4%, and the inflation factor varies
with where the hits happen to live, so the number is not comparable across runs or over time.

### Blast radius

A boundary-drift metric that cannot be trended. Combined with L-01 the report is wrong in both
directions at once — inflated in the one rule that fires, silently zero in the two that do not.

### Frozen tree / deployment

Touches `research/**`: **No.** Needs a production-deployment decision: **No.** Same single file as
L-01. **Fully isolated.**

---

## L-03 — Stale and no-op allowlist entries, and the detector gates nothing

**Severity: MEDIUM.** Status: **VERIFIED OPEN.**

### Stale entries — 2 verified

The allowlist (lines 58-73) carries a comment at lines 65-72 justifying four super-admin entries on
the ground that "the file still mentions `requireSuperAdminUser` in COMMENTS / migration notes".
Checked at `af2fb6e9`:

```
$ for f in <allowlist entries>; do
    echo "$f  requireSuperAdminUser_mentions=$(grep -c 'requireSuperAdminUser' "$f")"
    echo "  sharedCap_lines=$(grep -cE 'capability:\s*(BILLING_MANAGE|BILLING_PURCHASE|...)' "$f")"
  done
```

| Allowlist entry (line) | Exists at HEAD | `requireSuperAdminUser` mentions | Shared-cap lines | Verdict |
|---|---|---|---|---|
| `pages/api/super-admin/audit-logs.ts` (69) | yes | 1 | 0 | justification still holds |
| `pages/api/super-admin/companies.ts` (70) | yes | 1 | 0 | justification still holds |
| `pages/api/super-admin/credits/grant.ts` (71) | yes | 1 | 0 | justification still holds |
| **`pages/api/super-admin/users.ts` (72)** | yes | **0** | 0 | **STALE** — the mention that justified the entry is gone |
| **`pages/api/super-admin/purchases/complete.ts` (64)** | yes | 0 | **0** | **STALE** — allowlisted as "uses BILLING_PURCHASE intentionally per-org"; no shared-cap line remains |

### No-op entries — 3 verified

`pages/api/team/self-joined.ts` (61), `pages/api/virality/playbooks/index.ts` (62) and
`pages/api/virality/playbooks/[id].ts` (63) each have exactly 1 shared-cap line, but the only rule
that would match a shared cap is rule (2), gated on `rel.startsWith('pages/api/super-admin/')`
(line 103). These three are not super-admin routes, so **even with L-01 fixed these entries would
suppress nothing.** They are comments in the shape of code. All 8 allowlist files exist at HEAD, so
there is no dangling-path problem — the problem is that 5 of 8 entries are inert or unjustified.

### The detector gates nothing

```
$ grep -rn 'platform-isolation-check' --include='*.json' --include='*.yml' --include='*.yaml' \
    --include='*.ts' --include='*.md' . | grep -v node_modules
./scripts/platform-isolation-check.ts:2: * platform-isolation-check — static detector for ...
./scripts/platform-isolation-check.ts:29: *   npx tsx scripts/platform-isolation-check.ts
./scripts/platform-isolation-check.ts:143: console.log(`platform-isolation-check: ...`)
```

**Three hits, all self-references.** No `package.json` script, no workflow under `.github/workflows/`
(15 tracked), no documentation reference. The file's own header says it is "intended to be reviewed
during PR review or wired into CI" (lines 8-9) — **it is neither.** Nothing runs it, so L-01 and L-02
have been invisible for as long as they have existed.

### Blast radius

Allowlist rot plus zero invocation. Fixing L-01 without first pruning the allowlist would flip the
two dead rules on against a 5-of-8-inert suppression list, producing a first run whose output cannot
be triaged.

### Frozen tree / deployment

Touches `research/**`: **No.** Needs a production-deployment decision: **No** for the script itself.
Wiring it into CI *is* a separate decision, because it would begin gating pull requests. **Isolated,
but split the script fix from the CI wiring.**

---

## L-04 — The role **value** is never validated on the user-management write path, and no DB constraint backs it

**Severity: HIGH.** Status: **VERIFIED OPEN.**

### What it is

Both role-write routes accept `role` from the request body and validate only that it is truthy.
`backend/services/userManagementService.ts` then upper-cases it and writes it straight to
`user_company_roles.role`. There is **no enum check at the route, no enum check in the service, and
no CHECK constraint or enum type at the database.**

**Route layer — truthiness only:**

- `pages/api/users/invite.ts:13-16` — `const { email, companyId, role } = req.body || {};` then
  `if (!email || !companyId || !role) return res.status(400)...`
- `pages/api/users/invite.ts:19` — `await inviteUser(String(email), String(companyId), String(role), requester)`
- `pages/api/users/[userId]/role.ts:18-21` — `const { role, companyId } = req.body || {};` then
  `if (!role || !companyId) return res.status(400)...`
- `pages/api/users/[userId]/role.ts:24` — `await updateUserRole(userId, String(companyId), String(role), requester)`

**Service layer — upper-case and write:**

- `backend/services/userManagementService.ts:83` — `const normalizedRole = role.toUpperCase();`
- `:95` — `.update({ role: normalizedRole })` (existing membership row)
- `:99-104` — `.insert({ user_id, company_id, role: normalizedRole, created_at })` (new row)
- `:161` — `.update({ role: role.toUpperCase() })` in `updateUserRole`

`Role` **is** imported at `:3` (`import { getUserRole, isSuperAdmin, Role } from './rbacService'`)
and is used for the *requester's* role at `:27`. It is never used to validate the *written* value.

**Database layer — no constraint, stated in the repository's own migration:**

```
$ sed -n '8,22p' supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql
-- Role values are strings in user_company_roles.role; no enum constraint
-- exists at the DB level, so this is purely a documentation + helper view.
-- Application code (rbacService) enforces the allowed set.
```

`database/user-company-roles.sql:5` declares `role TEXT NOT NULL`. A CHECK constraint exists for
`status` (`:38-39`, `('invited','active','inactive','expired')`) and for `join_source`
(`supabase/migrations/20260510_...:14`) and for `membership_type`
(`database/user-company-roles-membership-type.sql:18`) — **but not for `role`.** The migration comment
asserts that application code enforces the allowed set; on this write path it does not.

### The escalation shape, stated precisely and with its current mitigation

`backend/services/rbacService.ts:266-276`:

```
const hasActiveSuperAdminRow = async (userId) => {
  ... .eq('role', Role.SUPER_ADMIN).eq('status', 'active') ...
```

and `:278-280` — `isSuperAdmin` and `isPlatformSuperAdmin` are both exactly this function. **An
`active` row whose `role` is the string `SUPER_ADMIN` in any company confers platform super-admin.**

Two write paths, with materially different reachability:

- **INSERT path** (`:99-104`) — no `status` is supplied, so the column default applies.
  `database/user-company-roles.sql:8` gives `status TEXT DEFAULT 'invited'`. A newly invited
  `SUPER_ADMIN` row therefore lands `invited`, and `hasActiveSuperAdminRow` requires `active`.
  **Mitigated.**
- **UPDATE paths** (`:94-96` in `inviteUser`, `:160-165` in `updateUserRole`) — both update `role`
  **only**, matched on `user_id` + `company_id`, leaving `status` untouched. **If the target row is
  already `active`, writing `SUPER_ADMIN` grants platform super-admin immediately.**

Today the caller must already be a super-admin to reach either path, because of L-05 — see there.
**That is a coincidental mitigation from a separate defect, not a control.** L-05 and L-04 must be
fixed in that order, or fixing L-05 alone converts a dead code path into a live
company-admin-to-platform-super-admin escalation.

A second, lower-severity consequence exists regardless of L-05: any unrecognised string is accepted
and persisted, and `normalizeRole` (`backend/services/rbacPrimitives.ts:28-40`) returns `null` for
anything it does not recognise. A typo therefore produces a membership row that silently authorises
nothing, with no error at write time.

### Blast radius

The `user_company_roles` table is the authority substrate for the whole tenant model: `getUserRole`
(`rbacService.ts:176-216`), `hasActiveSuperAdminRow` (`:266`), and the RLS policies across at least
seven migrations all read it (for example
`supabase/migrations/20260718000000_canonical_content_foundation.sql:143` and six sibling policies).
Unvalidated writes into it are writes into the root of the authorisation model.

### Frozen tree / deployment

Touches `research/**`: **No.** Paths: `pages/api/users/invite.ts`,
`pages/api/users/[userId]/role.ts`, `backend/services/userManagementService.ts`, and optionally a new
migration for the CHECK constraint.
Needs a production-deployment decision: **YES.** Two reasons. (1) Adding validation causes writes
that currently succeed to start failing — any caller relying on a non-canonical string breaks. (2) A
DB CHECK constraint cannot be added before the existing rows are known to satisfy it, and that
requires a read-only production listing of the distinct `role` values, which this stream may not
perform (no database access). **The code-level validation is isolated; the DB constraint is not.**

---

## L-05 — `requireUserAdminAccess` compares against a value `normalizeRole` can never return

**Severity: HIGH (correctness), and it is the reason L-04 is not currently exploitable.**
Status: **VERIFIED OPEN.**

`backend/services/userManagementService.ts:12-31`:

```
  const { role, error } = await getUserRole(requester.userId, companyId);   // :20
  ...
  if (role !== Role.ADMIN) {                                               // :27
    return { ok: false, status: 403, error: 'NOT_AUTHORIZED' };            // :28
  }
```

`getUserRole` returns `normalizeRole(...)` (`backend/services/rbacService.ts:193`, `:205`), and
`normalizeRole` maps `ADMIN` away before any other branch can see it —
`backend/services/rbacPrimitives.ts:32`:

```
  if (upper === 'ADMIN' || upper === 'COMPANYADMIN') return Role.COMPANY_ADMIN;
```

`Role.ADMIN` **is** a defined member (`rbacPrimitives.ts:5`), so the comparison type-checks; it is
simply unreachable. `normalizeRole` has no return path that yields `Role.ADMIN`. Therefore:

- every non-super-admin requester — including a legitimate `COMPANY_ADMIN` — falls through to `:28`
  and receives **403 `NOT_AUTHORIZED`**;
- the `scope: 'admin'` branch at `:30` is dead code;
- `inviteUser`, `listUsers`, `updateUserRole` and `removeUser` (`:79`, `:118`, `:157`, `:185` all call
  `requireUserAdminAccess`) are **super-admin-only in practice**, while
  `withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN])` at `pages/api/users/invite.ts:28` and
  `pages/api/users/[userId]/role.ts:33` advertises otherwise.

This is the same class the repository has already recorded elsewhere: `docs/security/SEC91_W2G.md`
carries `SEC91-W2G-N1` with the remaining action *"Functional (not security): the legacy role list
also refuses company admins — product owner to decide the approver roles."* **This instance is in the
user-management service and is a distinct occurrence.**

Note the inverse mapping in the sibling route `pages/api/company/users/[userId]/role.ts:8-13`, which
maps `'COMPANY_ADMIN' -> Role.ADMIN`, and then at `:40` performs the same `role !== Role.ADMIN`
comparison against a `getUserRole` result. **Two routes manage the same table with opposite
normalisation conventions.** Whichever direction is chosen must be applied to both.

### Blast radius

Company admins cannot manage their own users (availability and product defect). And, per L-04, this
defect is the only thing currently standing between a company admin and a platform super-admin row.
**Fixing L-05 in isolation is the single most dangerous change in this inventory.**

### Frozen tree / deployment

Touches `research/**`: **No.** Paths: `backend/services/userManagementService.ts`, and
`pages/api/company/users/[userId]/role.ts` for the convention decision.
Needs a production-deployment decision: **YES** — it grants access that is currently refused, and it
**must not ship before L-04.**

---

## L-06 — `scheduled_posts` has no `company_id`

**Severity: MEDIUM.** Status: **VERIFIED OPEN.**

`docs/security/SECURITY_CLOSURE_MATRIX_3AH91.md` line 41 records `SEC91-A2-e` with remaining action
*"Legacy remainder: `scheduled_posts` has no `company_id` — schema migration + backfill (owner)"*.
**Verified independently at `af2fb6e9`:**

```
$ sed -n '135,170p' database/comprehensive-scheduling-schema.sql
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    ...

$ grep -rn 'scheduled_posts' supabase/migrations database | grep -i 'company_id'
(no output)
```

No `company_id` column, and no migration anywhere adds one. Tenant scope must be derived through
`user_id` or `campaign_id`. Several migrations do add other columns to the table
(`supabase/migrations/20260422_creator_execution_reliability.sql:207-210`,
`20260627000400_scheduled_posts_design_attribution.sql:11`), so the omission is not for want of
opportunity.

### Blast radius

Every tenant check on `scheduled_posts` is a join away from its authority, and the RLS pattern used
across the content tables — `company_id IN (SELECT company_id FROM user_company_roles WHERE
user_id = auth.uid() AND status = 'active')`, at
`supabase/migrations/20260718000000_canonical_content_foundation.sql:143` and six siblings — **cannot
be applied to this table at all** in its direct form.

### Frozen tree / deployment

Touches `research/**`: **No.** Needs a production-deployment decision: **YES** — a schema migration
plus a backfill against live data. It is also the one item here explicitly assigned to the owner in
the repository's own matrix.

---

## L-07 — 403-vs-404 existence oracle on campaign resources: **NOT OPEN**

Status: **NOT OPEN — ACCEPTED AND DOCUMENTED.** Verified, and reported as verified rather than
assumed, because the brief named it as a candidate.

It is a real, live behaviour, and it is a **recorded, deliberate decision** rather than a follow-up:

- `backend/services/campaignAccessService.ts:183-190` — the inline comment names the decision
  (`SEC-91A (A6) — 403 for "exists, not yours" vs 404 for "no owner" is kept deliberately`), gives the
  reasons (platform-wide TenantGuard vocabulary; authenticated callers only; discloses only whether a
  random v4 UUID exists) and cites `docs/security/SEC91_A.md §A6`. `:190` is the `res.status(403)`.
- `docs/security/SEC91_A.md:31` — row `A6-a`, P3, **`INTENTIONALLY ACCEPTED`**, "pinned by
  `campaignResourceAuthzSec001`".
- `docs/security/SEC91_A.md:71-72` — the `A6` decision in full, with four stated reasons.
- `docs/security/SECURITY_CLOSURE_MATRIX_3AH91.md:47` — `SEC91-A6-a`, verdict
  **`ACCEPTED — DOCUMENTED`**, production status `Live`, remaining action `—`.
- Pinning tests present at `af2fb6e9`: `backend/tests/unit/campaignResourceAuthzSec001.test.ts`,
  `backend/tests/unit/campaignResourceAuthzSec001GenerateWeekly.test.ts`,
  `backend/tests/unit/sec91AExistenceOracle.test.ts`.
- The strictly-worse **anonymous** variant is recorded as fixed: `SEC91_A.md:52` row `A6-b`, "identical
  401, no object read".
- `docs/security/SECURITY_CLOSURE_MATRIX_3AH91.md:20` reports `OPEN — REMEDIATION REQUIRED | 0 | 0 | 0
  | 0 | 0` against a total of 128 findings (`:21`).

**Recommendation: do not "fix" this.** Changing it would contradict a documented decision, break three
pinning test files, and diverge one primitive from the platform-wide vocabulary that
`requireTenantAccess` and `requireCampaignTenantAccess` also use — which `SEC91_A.md:72` states would
not remove the oracle class anyway. **Revisiting the decision is an owner decision, not a fix.**

**Tests NOT RUN.** The three files were confirmed to exist; no test was executed in this stream.

---

## L-08 — Stray Vercel project: **UNVERIFIED**

Status: **UNVERIFIED.** Recorded as unverified rather than guessed.

Determining whether a stray or duplicate Vercel project exists requires enumerating the account's
projects (`vercel projects ls` or the Vercel API). **That is a network call, which is prohibited in
this task.** No inference is offered.

What *is* verifiable from the filesystem, recorded so the check can be completed later:

- `git ls-tree -r HEAD --name-only | grep -i vercel` -> `.vercelignore`, `vercel.json`,
  `backend/tests/unit/vercelRoutingContract.test.ts`, `scripts/ops/vercelEnvAudit.ts`,
  `scripts/sync-vercel-env.sh`, `scripts/vercel-deploy-prod.js`,
  `scripts/verify-vercel-render-parity.js`.
- No `.vercel/` directory exists in this worktree. One exists in the primary working copy and holds a
  `project.json` whose keys are `projectId`, `orgId`, `projectName`, with
  `projectName` = **`omnivyra`**. **No id value is reproduced here.**
- `.vercel` is gitignored (`.gitignore:13`, `:110`, `:144`).
- Every in-repository reference names the single project `omnivyra`:
  `docs/security/SEC91_B_CREDENTIAL_ROTATION.md:17`, `docs/security/SEC91_E.md:74`,
  `docs/security/SEC91_W2B.md:139`, `REPORT1_CLOSURE_EXECUTION_GAP_AUDIT.md:5`.
- `docs/RELEASE-FINAL-BLOCKER-ARTIFACT-CERTIFICATION.md:116` records a prior inability to verify the
  Vercel environment from an unlinked working tree — the same limitation applies here.

**The repository names exactly one Vercel project and no second one. That is consistent with there
being no stray project and equally consistent with a stray project existing outside the repository's
knowledge, which is the likelier place for one to be.** To close: operator runs `vercel projects ls`
and reconciles against `omnivyra`. **`NOT AVAILABLE IN REPOSITORY — the operator supplies it via an
authenticated Vercel listing.`**

---

## Cross-cutting note: 83 "Not deployed" rows

```
$ grep -c 'Not deployed' docs/security/SECURITY_CLOSURE_MATRIX_3AH91.md
83
```

`docs/security/SECURITY_CLOSURE_MATRIX_3AH91.md` reports `0` findings as
`OPEN — REMEDIATION REQUIRED` (`:20`) out of 128 (`:21`), while **83 rows carry a production status of
`Not deployed`**, and rows `:30`, `:31`, `:64` carry the remaining action `Merge + deploy` (`:64`
marked *priority*).

**"Fixed in the repository" and "fixed in production" are different facts, and the matrix is careful
to distinguish them.** This inventory takes no position on the deployment question — it is outside
this stream's scope and outside its authority. It is recorded because any reading of "0 open" as "0
exposed" would be wrong, and because L-04, L-05 and L-06 all land in a codebase that already has a
large undeployed-fix backlog. Rows were read as data; none of their status columns was relied on for
any finding above.

---

## Recommended order, and what can be batched

**No fix is implemented in this task.**

### Batch 1 — detector integrity. One PR. `scripts/platform-isolation-check.ts` only.

**L-03 (prune), then L-01 (path fix), then L-02 (de-duplicate).** In that order, inside one PR.

Rationale: all three live in one file; none touches a runtime path, a route, a migration or a flag;
none needs a deployment decision; and they must land together. Fixing L-01 alone would flip the two
dead rules on against an allowlist that is 5-of-8 inert (L-03), producing a first report nobody can
triage. Pruning first, then fixing the path, then de-duplicating, gives one clean baseline report.

Expected first-run delta after the batch: the `super_admin_user_legacy` rule begins reporting
`pages/api/super-admin/creator-operations.ts:43`, and the `role_equality` count drops from 15 to 13
distinct. **Both of those are the fix working, not a regression.** Triage the new hit on its merits.

**Do not wire the detector into CI in the same PR.** That is a separate decision with a separate blast
radius (it begins gating pull requests) and belongs in its own change once the report is trustworthy.

### Batch 2 — the role-write path. One PR, but strictly ordered inside it. **Deployment decision required.**

**L-04 first, then L-05. Never the reverse.**

Rationale: L-05 is currently the only thing preventing L-04 from being a live
company-admin-to-platform-super-admin escalation. Restoring the company-admin branch before role-value
validation exists would convert a dead code path into a reachable one. They belong in one PR
*because* the ordering matters and a reviewer must see both halves together; they must not be split
across two PRs that could merge out of order.

Within the PR: (1) validate the written `role` against the canonical set in
`userManagementService.ts` at `:83` and `:161`, and at both route boundaries; (2) settle the
`ADMIN`/`COMPANY_ADMIN` normalisation convention and apply it consistently to
`requireUserAdminAccess:27` **and** `pages/api/company/users/[userId]/role.ts:8-13,:40`; (3) leave the
DB CHECK constraint out of this PR — see below.

### Batch 3 — schema. Separate PRs, each needing operator action first.

**L-06** (`scheduled_posts.company_id`) and the **L-04 DB CHECK constraint** are both migration +
backfill work against live data. Each needs a read-only production listing of existing values before
a constraint or a NOT NULL can be added, and this stream has no database access. **Both are BLOCKED on
operator input, not on engineering.** Keep them out of Batches 1 and 2 so that neither of those is
held up by a migration decision.

### Not to be actioned

**L-07** — an accepted, documented, test-pinned decision. Revisiting it is an owner decision, not a fix.
**L-08** — UNVERIFIED. Close it with a `vercel projects ls` by the operator, not with a code change.

### Frozen-tree confirmation

**No item in any batch touches `research/**`.** Batch 1 touches one file under `scripts/`. Batch 2
touches two files under `pages/api/users/` plus one under `backend/services/` (and one under
`pages/api/company/users/` for the convention). Batch 3 touches `supabase/migrations/`. The frozen
CPG-U1 tree (588 files, all under `research/cpg-u1/`) is untouched throughout.

---

## Status legend as used above

| Term | Meaning here |
|---|---|
| **VERIFIED OPEN** | The defect was confirmed by this stream at `af2fb6e9`, from file:line or from command output shown in the entry. No fix is present |
| **NOT OPEN — ACCEPTED AND DOCUMENTED** | Live behaviour, confirmed present, and confirmed to be a recorded deliberate decision with pinning tests |
| **UNVERIFIED** | Not determinable within this task's prohibitions. No inference offered |
| **NOT RUN** | No test or build was executed. The only thing executed in this stream was `scripts/platform-isolation-check.ts`, a read-only dev script, whose output is quoted in L-01 and L-02 |
| **DEFERRED** | Not used — nothing in scope was deferred |
| **IMPLEMENTED** | Not used — **nothing was implemented**, by instruction |

---

*Artefact class: ANALYTICAL RESULT + EXECUTION EVIDENCE (§L-01/L-02 detector run). Not DeepTech
evidence. No fix implemented. No commit, PR, product-code change, network call, database access,
credential or `.env*` read. No secret value appears anywhere in this document.*
