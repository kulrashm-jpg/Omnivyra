# FIX 3 — STAGE A PACKAGE AUDIT AND CLOSURE

Independent audit of the corrected Stage A artifacts. Filesystem inspection and static analysis
only. No production access, no SQL executed or parsed by any database, no container or harness run,
no privilege change, no migration application, no commit, no deployment.

---

## 1. DISPOSITION

**READY FOR OWNER REVIEW**

The audit found **two residual defects in the v1 corrected artifacts**, both material, and both are
fixed in a new v2. One previously-reported coverage gap remains and requires an owner decision; it
does not affect read-only safety or the validity of any item's result.

This means only that the package is internally correct and suitable for review. It does **not** mean
the read-only role exists, Stage A has run, the evidence is complete, or Fix 3 is authorized.

### Defects found and fixed in v2

| ID | Defect | Severity |
|---|---|---|
| **D-1** | Item 9 step 9b presented five count statements in **one fenced block**. In PostgreSQL's simple query protocol a multi-statement string is **parsed in full before any statement executes**, so an operator pasting the block with one relation absent gets `42P01` and **zero results for all five** — reintroducing the exact G-2 failure the two-step design exists to prevent, on the most likely target state (four tables absent). Prose saying "run only those lines" was the only guard, and relying on prose is what failed the first time. | **material** |
| **D-2** | The preamble's stop list had **no server-version condition**, while Item 5 declared that a sub-15 server "stops the Stage A applicability assessment". Items 1-4 run first, so an operator would spend a production session on four items before discovering the assessment was void. `server_version_num` was already captured in gate step 3a, so the stop belonged there. An internal inconsistency between two parts of the same document. | **material** |

### Unresolved — requires owner action

| ID | Issue | Why it is not fixed here |
|---|---|---|
| **D-3** | The lifecycle-CHECK data condition is **not covered by any item**. `grep` for `23514` in the corrected package returns **0**. Fix 3's STEP 6 `v_ncons = 0` branch *adds* the lifecycle CHECK, validating every `public.content` row, and aborts with `23514` if any row holds an out-of-vocabulary value. Item 10 covers only the four composite-FK `23503` class; Item 6 reads the definition but does not probe the data. So a zero-row Item 10 plus a passing Item 6 still leaves this abort class undetected. | Adding it means adding a **query**, which is a change of substance requiring owner approval. It was proposed as Phase 99 "Correction 2" and **was not among the two corrections adopted** — owner decision 2 adopted the gap-review's Correction 1 (gate) and Correction 2 (Item 9). Silently redesigning it is prohibited. The proposal is ready at `FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` §4. |

A note on a label collision that could cause confusion: two documents each use "Correction 1/2".
The gap review's are **gate** and **Item 9** — those were adopted. Phase 99's are the
**mismatch-vs-missing-parent refinement** and the **lifecycle-CHECK condition** — neither was
adopted. D-3 is the second of the Phase 99 pair.

---

## 2. ARTIFACT PATHS AND VERIFIED HASHES

### New in this audit — execute these

| Artifact | SHA-256 |
|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V2.md` (1,279 lines) | `c2b9eaf9e14661c4a47f7eedbb77f6f9a38b4637d3c415fdc97af06f6c5aab96` |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V2.md` (179 lines) | `e5e27fc8b23f08819c3ac503b13ca25cc6631f66fddf7eba75684c1b13723542` |
| this report | recoverable with `sha256sum` |

The v2 operator steps point at the v2 package by path and by hash; **0** stale v1 references remain.

### Verified unchanged — all 13 expected hashes matched

| Artifact | SHA-256 | Role |
|---|---|---|
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED.md` | `8e751f5bf9fc5188915ac8f45ee7441bcffc89d99ef5f05b1c1a4cf5d4cddb42` | v1 — superseded, preserved, **do not execute** |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED.md` | `6b11013659b66da91c0dc70612b27e08420362431fbe8cae9f885f0fa7e032e5` | v1 — superseded, preserved |
| `FIX3_STAGE_A_CORRECTION_OUTCOME.md` | `ccbb249ae246fb6882001a34f748d94aa00d522f1ab124b93320aa96021502dd` | v1 correction report |
| `FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` | **immutable original** |
| `FIX3_PHASE100_STAGE_A_OPERATOR_STEPS.md` | `b490c648fd174c97884a7147204b098fdb7c233cce9a5f6f6455f360d975599f` | **immutable original** |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | unchanged |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | unchanged |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | unchanged |
| CI harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | unchanged |
| `FIX3_STAGE_A_PACKAGE_GAP_REVIEW.md` | `7d9a06d3e7f4ee6d2ab141fbefd86ecbab84a03ae170d46d730d964f34af32d9` | unchanged |
| `FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` | `2af19698c165e9fc6ab76e9ceeb46ad7d1b0f01483455af12151f90f6c500e93` | unchanged |
| `FIX3_PHASE99_PREFLIGHT_RECONCILIATION.md` | `67c3ef826c53f9e9f197103a4d1f4ee201026baee507efa464d73c7578e8a232` | unchanged |
| `FIX3_PHASE100_STAGE_A_HANDOFF.md` | `55bfcd2046a1c8141363e2e77f86d57f1df82d95e0bc88f3393914898f347e0e` | unchanged |

**No hash mismatched.** Nothing was blessed without verification; nothing was recreated or
overwritten.

---

## 3. RESULTS BY SECTION

### A — Artifact integrity: **PASS**

- All three expected corrected hashes verified; both immutable originals byte-identical to their
  documented values; migration, predecessor, verification SQL and harness all unchanged.
- **Item 10's approved Phase 96 §F query** was extracted independently from the original, from v1
  and from v2 and compared byte-for-byte: **identical in all three**, 20 lines,
  sha256 `e02bfecd0a16729f`.
- **Full diff reviewed, original → v1 → v2.** Every hunk falls inside a planned range. No unrelated
  text was altered.
- **Content-loss check by marker census** — original vs v1: `**Limitations` 11/11,
  `**Minimization` 11/11, `**PASS` 13/13, `**FAIL` 11/11, `**Expected columns` 11/11,
  `**INCONCLUSIVE` 11/**12** (an addition in Item 1, not a loss). Hard-prohibition bullets 7/7;
  exclusions-table rows 6/6. Result-template fields — `Session window`, `Evidence ID`,
  `Executed at`, `Exit status`, `Result summary`, `Verdict`, `Limitation / warning`, `Items PASS` —
  all present in both. **No safety caveat, result field or query was lost.**
- **Eleven item headings present and correctly ordered** in v2 (ITEM 1 … ITEM 11, lines 258-1009 in
  v1 ordering), and the operator steps' tables carry 6 pre-start rows plus 11 item rows = 17.
- Heading set comparison original → v2: **no heading lost**.

### B — Read-only safety gate: **PASS (after D-2 fix)**

Four queries reviewed line by line. The gate distinguishes and checks:

| Required | Present in v2 | How |
|---|---|---|
| Role attributes incl. superuser, `BYPASSRLS`, database creation | yes | 3a: `rolsuper`, `rolbypassrls`, `rolinherit`, `has_database_privilege(…,'CREATE')` |
| Effective table write privileges incl. inherited memberships | yes | 3b: `has_table_privilege` over `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` — this function accounts for privilege held via role membership, which 3a cannot see |
| Ownership and role-membership paths | yes | 3c: `pg_has_role(current_user, c.relowner, 'USAGE')` |
| Escalation paths incl. switching into a privileged role | yes | 3d: `pg_has_role(current_user, r.oid, 'MEMBER')` over roles with `rolsuper OR rolbypassrls` |
| Schema `USAGE` and `CREATE` | yes | 3a `has_schema_privilege(…,'public','CREATE')`; Item 1c covers `USAGE` and `CREATE` per application role |
| Limits of ACL inspection, incl. `PUBLIC` and objects outside the six | yes | stated in the gate's "what these do not establish" and again in Item 1's limitations; `granted to PUBLIC` named explicitly; "six named relations" scope stated 3× |
| Project identity confirmed out-of-band | yes | the gate states plainly that **database identity cannot be established from inside the database** and that the ref confirmation is necessarily out-of-band |

- **The package does not claim four queries prove a session read-only.** It states the narrower
  conclusion the checks support and names five uncovered classes (`SECURITY DEFINER` functions,
  event triggers, objects outside the six, `PUBLIC` grants, pooler/middleware).
- **Stop conditions: now eight, explicit and actionable**, and consistent across the package gate,
  section 7, the pre-start checklist and both result templates. `grep` for stale "seven stop
  conditions" in the v2 pair returns **0**.
- **No discipline-only fallback anywhere**: `session discipline only` returns **0** in both v2
  artifacts, and the gate states that if the bar is not met Stage A stays BLOCKED.
- Note for the record: `FIX3_STAGE_A_CORRECTION_OUTCOME.md` says "all seven stop conditions". That
  refers to v1 and is left unaltered rather than rewritten, since it is a report of a completed step.

### C — Item 1 ACL inspection: **PASS**

- `pg_class.relacl` with `aclexplode`, wrapped in
  `COALESCE(c.relacl, acldefault('r', c.relowner))` via `LEFT JOIN LATERAL … ON true`, so a relation
  with no explicit grant still produces rows and the **owner-only default is reported rather than
  looking empty**. `acl_is_default` is surfaced as a column.
- Role membership and inherited effective privileges handled separately in 1b
  (`pg_roles` ⋈ `pg_auth_members`), with the reason stated: an ACL entry naming a group role grants
  to every `INHERIT` member, which 1a cannot show.
- Schema privileges on `public` in 1c, both `USAGE` and `CREATE`.
- Direct vs inherited vs ownership all distinguished — 1a shows direct entries and the owner, 1b
  shows membership, and the gate's 3b/3c cover effective privilege and ownership for the inspecting
  session.
- **Visibility limitation stated, and it is the reason for the change**: `information_schema`
  showed only grants where a currently enabled role is grantor or grantee, so a restricted role
  could see nothing and read it as "no grants exist". `pg_class` is world-readable, so the ACL is not
  filtered that way.
- **Determinate vs inconclusive is explicit**: `acl_is_default = true` and "no non-owner ACL entry"
  are both stated to be determinate findings that must **not** be recorded as inconclusive.
- **No false claim of completeness.** The package states that **ACL inspection alone cannot
  establish a read-only guarantee — a superuser bypasses all privilege checks and appears in no ACL,
  and an owner's implicit privileges are not ACL entries** — and that Item 1 describes the
  application's grant surface, not the inspecting session. Column-level ACLs (`pg_attribute.attacl`)
  and `pg_default_acl` are named as out of scope and as the next place to look under separate
  authorization.

### D — Item 9 existence and counts: **PASS (after D-1 fix)**

| Required | v2 |
|---|---|
| Probes existence before counting | yes — step 9a, `to_regclass`, which returns NULL rather than raising |
| Never references an absent relation in a static count query | **yes, now genuinely** — five separate fenced statements, each run only if 9a reported present, plus an explicit do-not-batch warning explaining the parse-time failure. This is the D-1 fix |
| No dynamic SQL, temp table, `DO` block or any write | yes — and the package explains why: a `DO` block cannot return rows without a temporary table, which is a write |
| `ABSENT` vs confirmed `0` vs `INCONCLUSIVE` distinguished | yes — a three-row recording table making them mutually exclusive, and a verdict block stating `ABSENT` is **not** inconclusive |
| CREATE / RECONCILE / MIXED / INCONCLUSIVE preserved | yes — a five-row path table, including "mixed → escalate" and "`content` absent → escalate immediately" |
| `reltuples = -1` and NULL estimates treated as UNKNOWN, never zero | yes — both called out; `-1` is the PostgreSQL 14+ encoding for never-vacuumed-or-analyzed, reachable on a PG15+ target |
| Estimate variant lists all five names, hides nothing | yes — driven from a `VALUES` list with a `present` column, so absent relations still appear |

Checked against every presence combination: all five present; all four Fix 3 tables absent with
`content` present; mixed; `content` absent; and 9a not run. Each maps to exactly one recorded path,
and no combination can render absence as zero in either the exact or the estimated variant.

### E — Item 5 PostgreSQL compatibility: **PASS (strengthened by D-2 fix)**

- Step 5a computes `pg15_or_later` from `current_setting('server_version_num')::int >= 150000`.
- Below 15 → **FAIL and STOP** the applicability assessment. In v2 this is additionally the
  **eighth preamble stop condition**, so the stop happens **before item 1** rather than after four
  items have run against production.
- The package explains that skipping or weakening the `confdelsetcols` query would not establish the
  relevant FK delete-action semantics: without that column the result cannot distinguish
  `ON DELETE SET NULL (content_id)` from a bare `SET NULL`, the property
  `content_approval_history_content_fk` depends on — so the item would look like a pass while
  establishing nothing about the one FK whose delete action matters most.
- It also states the larger consequence: `FIX3-PRECOND-00` refuses below `150000`, so a sub-15
  target is incompatible with the migration itself, not merely awkward to inspect.
- **The gate was not removed or weakened to make the checklist pass.**

### F — All eleven items: **PASS, with D-3 outstanding**

- **SQL correctness and version compatibility.** Every statement reviewed. All function signatures
  used are valid for PostgreSQL 15+: `has_table_privilege(name, oid, text)`,
  `pg_has_role(name, oid, text)`, `has_schema_privilege(name, text, text)`,
  `aclexplode(aclitem[])`, `acldefault("char", oid)`, `to_regclass(text)`. The `"char"` columns
  (`contype`, `polcmd`, `confdeltype`, `confupdtype`, `confmatchtype`, `relkind`, `tgenabled`) all
  carry `::text` casts — the Phase 89 ambiguity defect does not recur. `unnest(…) WITH ORDINALITY`
  over `indkey`/`indclass`/`conkey` is used as in Phase 96, where those forms executed successfully
  against PostgreSQL 17.
- **Read-only behavior.** Every statement is a bare `SELECT` over `pg_catalog`,
  `information_schema.columns` (Item 11 discovery) or the five target relations. No CTE contains a
  data-modifying statement; no `DO` block; no temp object; no `SET ROLE`.
- **Target schemas and relations correct**: `public` throughout, the four Fix 3 tables plus
  `public.content`, with `user_company_roles` added where the authorization dependency requires it.
- **Expected output columns and interpretation** present for all eleven items.
- **No exposure.** Scan of the corrected package: credential/token/secret literals **0**;
  `postgres://` or host:port patterns **0**; `SELECT *` **0**. "Never paste" prohibitions present.
  Items return catalog metadata, identifiers or counts; Item 10 returns UUIDs only.
- **No inference from absent results** — three explicit anti-inference statements: absence of
  visible ACL entries is not absence of privilege; `ABSENT` is not inconclusive; NULL estimate is
  not zero.
- **Consistent stop/escalation rules** across package, operator steps, handoff and both templates.
- **Item 10 preserved verbatim.** The unapproved Phase 98 lines 649-662 refinement remains in the
  package only as the clearly-labelled `NEEDS REVIEW` proposal it already was, with its prohibition
  intact, and is referenced nowhere as an instruction. The Phase 99 proposed correction is not
  substituted.
- **Outstanding: D-3**, the lifecycle-CHECK data condition. See §1.

---

## 4. CORRECTIONS MADE IN THIS AUDIT

Both are the smallest change that resolves the defect, and neither touches owner-approved content.

| Defect | Change | Lines touched in v1 | Verification |
|---|---|---|---|
| D-1 | Step 9b split into five separately fenced statements, each labelled "only if present", preceded by a blockquote explaining the simple-query-protocol parse-time failure | 805-814 | step 9b now contains **5** `sql` fences; batch warning present; Item 10 query still byte-identical |
| D-2 | Eighth stop condition added to the preamble gate: `server_version_num` below `150000` → FAIL and escalate, with the reason and a pointer to Item 5 step 5a | 152-158 | stop bullets now **8**; stale "seven stop conditions" references **0**; operator steps row 3 updated to "eight" and to name the version condition |

Also updated together, as required: the v2 package's section 0 provenance records the revision and
what changed; the v2 operator steps point at the v2 package by path **and** by hash.

Package v1 1,244 → v2 1,279 lines; steps v1 179 → v2 179 lines. Every v2 diff hunk falls inside a
planned range; 11 item headings intact; no heading lost.

---

## 5. UNRESOLVED ISSUES AND REQUIRED OWNER ACTION

| # | Issue | Required owner action |
|---|---|---|
| 1 | **No compliant read-only session exists.** This is the standing prerequisite, not a defect. | **Provision and independently verify a dedicated, database-enforced read-only session** clearing all **eight** stop conditions in the v2 package's section 1 step 3. Stage A stays BLOCKED until it exists. Not a task for this programme. |
| 2 | **D-3 — lifecycle-CHECK data condition uncovered.** A zero-row Item 10 does not exclude a `23514` abort from STEP 6's `v_ncons = 0` branch. | Decide whether to adopt Phase 99's proposed addition (`FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` §4): one catalog query, plus a grouped scan only if that returns zero. Adopting it requires approving a new query, which is why it was not added here. |
| 3 | **Item 1's deferred layers.** Column-level ACLs (`pg_attribute.attacl`) and `pg_default_acl` are out of scope. | None now. Noted as the next place to look if a finding looks inconsistent with observed application behavior. |
| 4 | **Runtime authorization behavior is not establishable** by this package — items 1-4 give configuration only. | None now. Role-switched read testing and any write-path test remain excluded and would need separate authorization and a non-production environment. |

---

## 6. CONFIRMATION OF ACTIONS NOT TAKEN

| | |
|---|---|
| Production connection or access | **NO** |
| SQL executed, or parsed by any database — including disposable or container harness | **NO**; every statement was reviewed as text only |
| Database or role provisioning, grant change, role switch, permission change | **NO** |
| Migration applied or modified | **NO** |
| Application code, environment files, secrets or credentials changed | **NO** |
| Docker, container or harness execution | **NO** |
| Commit, push, pull request or deployment | **NO** |
| `C:\virality` accessed or traversed | **NO** |
| Original evidence modified or deleted | **NO** — both originals and both v1 corrected artifacts byte-identical, hashes verified |
| Secret values or secret-derived metadata printed | **NO** |

---

## 7. FINAL REPOSITORY STATE

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected |
| staged | **0** |
| modified | **78** |
| untracked | **30** (+3 this audit: package v2, steps v2, this report) |

No file was staged or committed. All three new artifacts are additions; no existing file was
modified. Each new path was checked against `.gitignore` before creation and is visible to git — a
necessary check here, where `*_CHECKLIST.md`, `*_READINESS*.md` and `*_REPORT.md` are ignored and
four earlier deliverables in this programme had to be renamed.

---

## 8. NEXT OWNER ACTION

1. **Provision and independently verify a dedicated, database-enforced read-only session.** Stage A
   remains blocked until this prerequisite is satisfied. There is no discipline-only route.
2. **Execute only** `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V2.md`
   (`c2b9eaf9e14661c4…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V2.md`
   (`e5e27fc8b23f0881…`). The originals and the v1 corrected pair are preserved for audit and
   **must not be executed**.
3. **Return all eleven sanitized result blocks** for review — no credentials, connection strings,
   tokens, personal data or raw row payloads.
4. Separately, **decide D-3**.

**Fix 3 application requires separate explicit authorization and is not addressed here.**

---

**READY FOR OWNER REVIEW**
