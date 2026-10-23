# FIX 3 — STAGE A READ-ONLY ACCESS PREREQUISITE (v2)

**For the owner.** Supersedes `FIX3_STAGE_A_READONLY_PREREQUISITE.md`
(`24c3b07a819e03af…`), which is preserved unchanged as audit history. This revision implements the
owner decisions **L-1, L-3 and L-5**.

Static review only. No production access, no database connection, no SQL executed or parsed, no role
provisioned, no privilege changed, no Stage A run, no commit.

---

## 1. DISPOSITION

**READY FOR OWNER VERIFICATION**

The checklist is complete and the three approved decisions are implemented here and in a new
executable pair. **The session has still not been provisioned or independently verified**, so this is
not `READY FOR STAGE A`.

| Artifact | SHA-256 | Role |
|---|---|---|
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V4.md` | `63498ef76eae0d7443b1cd02dbd66d9007ed54f18da4990bddb143d9c6f46e0c` | **execute this** |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V4.md` | `7dc7b0863d9fce1dbd03897019eaa79e5ee53cca66f87eec43c82f39be2e548e` | **execute with this** |
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V3.md` | `27680e1e70a24facc70b68fc7e17f7118e389f055d7ed3a5bd226d65fbb3b423` | audit history — not for execution |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V3.md` | `3749c93633524669b8f6b28316d16edef7124d7762754b47b84dfac959af3a4d` | audit history — not for execution |
| `FIX3_STAGE_A_READONLY_PREREQUISITE.md` (v1) | `24c3b07a819e03afeb8d7dad7246f4b7cc457ddf97e15e14d67d8072b08e5ded` | audit history |

Documentation, a proposed role, a console screenshot or an operator assurance cannot move this to
`READY FOR STAGE A`. That needs evidence from the actual intended session.

---

## 2. WHAT THE THREE DECISIONS CHANGED

| Decision | Effect |
|---|---|
| **L-1** | SC-6's evidentiary meaning is now defined: `transaction_read_only` must be **observed `on` in the actual intended session**, recorded against the 3f backend PID. Issuing the statement is not the evidence. SC-6 is described as a **session safeguard**, not as persistent, non-bypassable, or sufficient on its own. The condition itself is unchanged |
| **L-3** | `supabase_migrations.schema_migrations` is now covered by the 3b privilege check and the 3c ownership check — **seven relations, not six** — and a new **3e** covers schema `CREATE` and schema ownership for **both** `public` and `supabase_migrations` |
| **L-5** | A new **3f** records `pg_backend_pid()` before Item 1; it is matched against a capture taken after Item 11. Mismatch, missing or failed observation is FAIL/INCONCLUSIVE. Transaction-pooling connection modes make the evidence INCONCLUSIVE by construction |

**Still eight stop conditions.** Three were widened in scope, one was clarified in meaning. **None
was weakened, and no ninth was added.** The scope extensions are itemised for owner review in
`FIX3_L1_L3_L5_ADOPTION.md`.

---

## 3. THE EIGHT STOP CONDITIONS, AS REVISED

In source order. Changes from v1 are marked **[v4]**.

| # | Condition | Establish | Clear pass | STOP / INCONCLUSIVE | Out-of-band? |
|---|---|---|---|---|---|
| **SC-1** | 3a `is_superuser = true` | the role is not a superuser | `false` | `true` — a superuser bypasses every privilege check | no |
| **SC-2** | 3a `can_create_in_public = true`, **[v4] or 3e `create_priv = true` for either `public` or `supabase_migrations`** | the session cannot create objects in either schema Stage A touches | both `false` | either `true` — schema `CREATE` is a write capability | no |
| **SC-3** | 3b any of `ins/upd/del/trunc/refs/trig` true on **any** relation — **[v4] seven relations, including the migration ledger** | no write privilege, **including privilege inherited through group roles** | all false across all seven | any `true`. **A NULL is `UNKNOWN`, not a pass**; `present = false` is `ABSENT` | no |
| **SC-4** | 3c `is_or_inherits_owner = true` for **any** relation — **[v4] seven** — **[v4] or 3e `is_or_inherits_schema_owner` for either schema** | the session neither is nor inherits the owner of any relation or either schema | all false | any `true` — an owner may `ALTER`/`DROP` regardless of grants, and ownership is in no ACL | no |
| **SC-5** | 3d returns any row | no `SET ROLE` path into a `rolsuper` or `rolbypassrls` role | zero rows | any row | no |
| **SC-6** | the read-only transaction cannot be established — **[v4] meaning `transaction_read_only` was not OBSERVED `on` in the actual intended session, or the observation is missing, ambiguous or failed** | that read-only mode was observed on, in the session that then runs the items, recorded against the 3f PID | observed `on`, tied to the PID | not observed, ambiguous, or silently reset. **SC-6 alone does not establish database-enforced read-only access** | no |
| **SC-7** | the project ref cannot be confirmed out-of-band | the session is on project ref `klkiseupptzbecbxwrky` | confirmed from the console and recorded as out-of-band | cannot be confirmed | **YES — irreducibly** |
| **SC-8** | 3a `server_version_num` below `150000` | server is PostgreSQL 15 or later | `>= 150000` | below — record **FAIL** and escalate; `FIX3-PRECOND-00` refuses, so the target is incompatible with the migration itself | no |

**Who verifies:** the owner, or a delegate who is not the person who provisioned the role. SC-7 is
the owner's, from the console.

### Not a stop condition, preserved unchanged

*"If 3b reports `sel = false` for a relation an item needs, that item's result is incomplete rather
than unsafe. Record that item INCONCLUSIVE and continue."* This is **not** a ninth condition.

### Session continuity — separate from the eight **[v4]**

3f start PID and the post-Item-11 PID **must match**. Missing, failed or differing → **FAIL /
INCONCLUSIVE**, stop for review. Never combine results from different sessions and label them one
session's evidence.

### And the standing rule

*"There is no discipline-only route."* A database-enforced read-only session is required; operator
discipline is not accepted as a substitute.

---

## 4. WHERE THE ENFORCEMENT ACTUALLY COMES FROM

| Layer | What it is |
|---|---|
| **Database-enforced** | **SC-3, SC-4 and the 3e schema checks.** A role with no write privilege, no ownership and no schema `CREATE` cannot write, whatever it intends. This is a catalog property, not operator conduct |
| **Session safeguard** | **SC-6.** Set by the session on itself. A new transaction is read-write unless `default_transaction_read_only` is on, and that parameter is `USERSET` — any session may turn it off. It protects against **accident**. Required, valuable, and **not** the enforcement |
| **Continuity marker** | **3f PID.** Detects a reconnection between the gate and the items — which would also have silently discarded the read-only transaction and the gate's findings. Not proof of identity, privilege safety or enforcement |
| **Out-of-band** | **SC-7.** No query establishes the project ref |
| **Explicitly not proven** | that no write path exists anywhere. The gate covers seven relations and two schemas; `SECURITY DEFINER` functions, event triggers, every other object, `PUBLIC` grants and pooler behavior are disclosed as uncovered |

---

## 5. REMAINING LIMITATIONS

L-1, L-3 and L-5 are **resolved** by the v4 pair. Three persist, unchanged in substance:

- **L-2 (was: SC-6 is accident protection)** — now **resolved as a documentation matter**: the v4
  package states it. The underlying fact persists and is correctly described rather than fixed,
  because it cannot be fixed by configuration. The only physically read-only mechanism is a
  standby/replica, which is a different database with replication lag — named, not recommended.
- **L-4 — session-to-target binding is irreducibly out-of-band.** The only in-SQL evidence would be
  host and port, which the package forbids recording. A cluster-identifier candidate exists but its
  executability by a restricted role is unverified, so it remains a candidate, not a recommendation.
  **L-5's PID does not close this**, and the v4 package says so explicitly: PID equality does not
  prove the same target project.
- **L-6 — production privileges and ownership cannot be predicted from this repository.** The
  committed baseline contains **0 `GRANT` and 0 `OWNER TO` statements**; Phase 96's "6,146 grants all
  to `postgres`" came from the restored local database, where `postgres` performed the restore.
  Whether any existing role can satisfy SC-3, SC-4 or the 3e checks is **unknown** until the gate is
  run.

### New limitation introduced by L-5 itself

- **L-7 — connection mode governs whether PID continuity means anything.** In a transaction-pooling
  mode consecutive transactions may be served by different backends, so a PID observed at 3f need not
  belong to the backend serving a later statement, and equality is not evidence of continuity. If the
  mode is a transaction pooler, or cannot be determined, continuity is **INCONCLUSIVE by
  construction**: stop and refer to the owner or platform administrator. Use a session-mode or direct
  connection. Note that if all eleven items genuinely run inside one transaction the PID cannot
  change, so a match is expected and a **mismatch is the signal**.

---

## 6. OWNER PROVISIONING AND VERIFICATION CHECKLIST

None of this is performed here. Where the platform-specific procedure is not established by this
repository's approved materials, it is named as an owner or platform-administrator action requiring
separate review rather than prescribed.

| # | Action | Required evidence |
|---|---|---|
| **P-1** | **Provision a dedicated read-only mechanism.** Required *properties*: holds `SELECT` on the relations the items read; holds none of `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` on any of the **seven**; owns none of them; is not a superuser; lacks `CREATE` on **both** `public` and `supabase_migrations`; neither is nor inherits either schema's owner; is a member of no `rolsuper`/`rolbypassrls` role | gate queries 3a-3f run **as that role, in the session that will run the items**. **No provisioning command is prescribed** — platform-administrator action, separate review |
| **P-2** | **Verify database identity out-of-band.** Confirm project ref `klkiseupptzbecbxwrky` from the console | a record that the check was visual and out-of-band, plus `current_database()` and `server_version` from 3a |
| **P-3** | **Establish that the session cannot write, do DDL, alter privileges or escalate** | 3b all-false over seven; 3c all-false over seven; 3e `create_priv` and schema-owner false for both schemas; 3d zero rows; 3a `is_superuser` and `can_create_in_public` false |
| **P-4** | **Check inherited memberships, ownership, schema privileges and role attributes** — not role names | 3b (inheritance-aware), 3c and 3e (`pg_has_role`), 3a and 3e (`has_schema_privilege`), 3d (membership in privileged roles) |
| **P-5** | **Confirm the identity, enforcement and continuity of the session that runs the items** | `current_user`/`session_user`; `transaction_read_only` **observed** `on`; 3f start PID matched to the post-Item-11 PID; connection mode recorded |
| **P-6** | **Record evidence safely** | booleans, counts, catalog metadata, role names, version numbers, PIDs. **Never** credentials, connection strings whole or partial, host, port, tokens, API keys, passwords, personal data or raw row payloads. If a result cannot be summarised without one, write `WITHHELD — contains sensitive data` |
| **P-7** | **Stop and escalate on any failure** | the failing condition named, with what was observed. **No discipline-only route.** Stage A stays BLOCKED |

**Sequence:** P-2 before connecting · P-1 before P-3 · P-3, P-4 and 3f in the session that will run
the items, before Item 1 · the post-Item-11 PID capture after the last item · P-6 throughout · P-7 at
any failure.

---

## 7. BOUNDARY AND REPOSITORY STATE

| | |
|---|---|
| Production accessed or any database connection | **NO** |
| SQL executed or database-parsed | **NO** |
| Role provisioned, grant or privilege changed, role switched | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Stage A run | **NO** |
| Commit, push, PR or deployment | **NO** |
| `C:\virality` accessed | **NO** |
| Secrets, credentials, connection strings, tokens or secret-derived metadata printed | **NO** |
| Prior artifacts modified | **NO** — v1 checklist, v3 pair, v2 and v1 pairs, D-3 artifacts and all reports unchanged |

HEAD `5604b50bdebd23efd6d040b90f5802954413b656`, detached. Worktree counts are recorded in
`FIX3_L1_L3_L5_ADOPTION.md`.

---

## 8. EXACT NEXT ACTION

1. **Review the three scope extensions and the SC-6 clarification** itemised in
   `FIX3_L1_L3_L5_ADOPTION.md` — in particular the new 3e schema check, which is the one genuinely
   new element.
2. **Provision the dedicated read-only mechanism (P-1)** — platform-administrator action. L-6 means
   nothing here predicts whether an existing role qualifies.
3. **Run gate queries 3a-3f as that role, in the session that will run the items**, and return all
   eight condition results plus the continuity evidence, sanitized.
4. Then, and only then, execute the **v4 pair** and return the eleven sanitized result blocks with
   the post-Item-11 PID.

Stage A is not ready and Fix 3 application requires separate explicit authorization.

---

**READY FOR OWNER VERIFICATION**
