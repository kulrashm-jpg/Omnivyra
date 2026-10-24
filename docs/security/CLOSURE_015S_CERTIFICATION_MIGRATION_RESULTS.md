# CLOSURE-015S — Certification migration and post-apply verification

**Result: APPLIED AND VERIFIED.** On the designated local certification database I applied exactly one migration, `20261211000001_rbac_config_pre_c7_privilege_reduction.sql`, and recorded it in the ledger once. Every post-apply check passed (0 probe failures), and the probes left no residue.

**Untouched:**
- production;
- the deferred RBAC contract step;
- migrations 0001–0004;
- every other database and container, including the retained `c15r-*` resources.

Nothing was pushed, merged, deployed or committed. This report is untracked.

## 1. Repository baseline

| Item | Value |
|---|---|
| Worktree / branch / HEAD | `C:/tmp/closure-014a` / `integration/closure-014a` / `5444b0afca4cdec86753f8db3997407f1a9c2d93` (as expected) |
| Worktree | 0 staged, 0 tracked modifications; untracked: the 015P/015Q/015R reports and `supabase/proposals/closure015n/05_…` (unchanged) |
| Migration file | `supabase/migrations/20261211000001_rbac_config_pre_c7_privilege_reduction.sql`, committed in `5444b0af`, **unchanged** vs HEAD (checked again immediately before applying); sha256 `51453281b3cbba04a50f6ce1cc7e88c3f544275c70fbc8a98957b854126f0122`, git blob `0854da61…` |

## 2. Certification target: identity and isolation (verified before every phase)

| Check | Evidence |
|---|---|
| Container | `supabase_db_cert-supabase`, id `59f0d074f49e…` (unchanged since 015P), label `com.supabase.cli.project=cert-supabase`, image `public.ecr.aws/supabase/postgres:17.6.1.167` |
| Network | only `supabase_network_cert-supabase` (the local stack's own network) |
| Database | PostgreSQL 17.6, `system_identifier=7684462104593874982`, database `postgres`; databases `_supabase, postgres, storage_vectors`; not in recovery |
| Connection | `docker exec … psql -U postgres` over the container's **local socket**. No credential was read, typed or stored, and no environment or credential file was inspected. |
| Isolation | 0 foreign servers, 0 subscriptions, no remote-capable extensions (`dblink`, `postgres_fdw`, `pg_net`, `http`). The one logical replication slot is consumed by `supabase_analytics_cert-supabase` (172.18.0.7) on the same local network. |
| Not production | local container, not a managed host; no link to project `klkiseupptzbecbxwrky` or to any shared database |
| Re-verification | container id, project label, network, system identifier and database list were re-checked before phases B, C, D1 and D3. The script stops on any mismatch. |

## 3. Migration status and ledger

| | Value |
|---|---|
| Before | `supabase_migrations.schema_migrations` = 20261210000001 … 20261210000004 (4 rows); `20261211000001` **absent** |
| Apply | `psql -v ON_ERROR_STOP=1 < 20261211000001_…sql` as `postgres`, the procedure used for 0001–0004 in 015P → **exit 0**, no output besides command tags (the pre/post-condition DO blocks raised nothing) |
| Ledger | `INSERT (version, name) VALUES ('20261211000001', 'rbac_config_pre_c7_privilege_reduction')` |
| After | 5 rows: 0001, 0002, 0003, 0004, **20261211000001 exactly once** |
| No unrelated change | schema fingerprint (md5 per category) **identical before and after** in every category: relation ACLs of all `public` and `supabase_migrations` relations except `rbac_config` and its sequence; rbac relation structure and RLS flag; all `public` columns; all `public` function definitions, ACLs and owners; constraints; triggers; policies; default ACLs |

**Not done:** 0001–0004 were not re-applied, and the deferred contract was not applied (after the run, service_role still holds INSERT). No other migration, seed, reset, repair or schema command ran.

## 4. Effective privileges (`has_table_privilege` / `has_sequence_privilege`, inheritance included)

| Role | Table, before | **Table, after** | Sequence, before | **Sequence, after** |
|---|---|---|---|---|
| service_role | SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN | **INSERT, SELECT** | USAGE SELECT UPDATE | **–** |
| authenticated | – | – | USAGE SELECT UPDATE | **–** |
| anon | – | – | – | – |
| authenticator | – | – | – | – |
| PUBLIC | – | – | – | – |

**Strict checks after apply**, each of which would have stopped the run:
- the five lines above equal the expected interim contract exactly;
- **all-role scan** (every non-superuser role that does not inherit the table owner):
  - unexpected table writers: none (only `service_role:INSERT`);
  - sequence users: none;
  - extra column privileges: none;
  - members of `pg_write_all_data` / `pg_maintain`: none.

`save_rbac_config` is **unchanged** (md5 `2682223b…`):
- SECURITY DEFINER;
- owner `postgres`;
- `search_path=public`;
- EXECUTE for service_role only (authenticated and anon false);
- RLS on `rbac_config` still enabled.

Full matrices: `matrix_before.txt`, `matrix_after.txt`. `matrix_before.txt` is identical to the end-of-015R read, so cert had not changed in between.

## 5. Runtime behaviour

Every probe ran in its own transaction that was **never committed**, under `SET LOCAL ROLE <role>`. That is the role PostgREST switches to for the server key or a user JWT. Each probe asserted its exact outcome.

**Pre-apply (baseline, F-1 still present):**

| Probe | Result |
|---|---|
| B1 service_role read | ok |
| B2 governed save + read-back | ok |
| B3 service_role direct UPDATE | **allowed** (F-1) |
| B4 authenticated `setval` on the sequence | **allowed** (F-1) |

**Post-apply (18/18 PASS):**

| Probe | Role | Expected → observed |
|---|---|---|
| P01 read | service_role | ok |
| P02 governed `save_rbac_config` + read-back of the head (version, permissions) | service_role | ok |
| P03 second save with the same expected version | service_role | `RBAC_CONFIG_STALE` |
| P04 fresh save with the current head | service_role | ok, version advances |
| P05 legacy direct INSERT (the PGRST202 fallback the interim contract keeps) | service_role | **allowed**, identity version assigned without any sequence privilege |
| P06 / P07 / P08 UPDATE / DELETE / TRUNCATE (an owner row present in the transaction) | service_role | permission denied ×3 |
| P09 `LOCK … ACCESS EXCLUSIVE` | service_role | permission denied |
| P10 `CREATE TRIGGER` on the table | service_role | permission denied |
| P11 / P12 `setval` / `nextval` | service_role | permission denied ×2 |
| P13 `setval` | authenticated | permission denied |
| P14 / P15 SELECT / INSERT | authenticated | permission denied ×2 |
| P16 SELECT | anon | permission denied |
| P17 / P18 EXECUTE `save_rbac_config` | authenticated / anon | permission denied ×2 |

## 6. Cleanup and proof of no residue

| Item | Before 015S | After probes | After cleanup |
|---|---|---|---|
| `rbac_config` rows | 0 | 0 (all probes rolled back) | **0** |
| `rbac_config_version_seq` (last_value, is_called) | `4, true` | `12, true` (governed and legacy saves draw values; `nextval` is not transactional) | **`4, true`**: restored with `setval` as the owner, then verified |
| Probe trigger `c15s_probe` | absent | absent (denied) | absent |
| Privileges / matrix / schema fingerprint | (post-apply) | identical | identical |

**Notes:**
- **Sequence history.** The pre-015S value `4, true` is a remnant of 015P's rolled-back probes, which drew values 1–4 and did not restore the sequence. It is harmless, because version numbers only need to increase. 015S preserved it exactly.
- **An earlier aborted attempt.** The first run stopped in phase A on a type error in my own read-only fingerprint query (`"char"` needed `::text`), before any probe or change. It was fixed and re-run from the start; that read-only failure is the only deviation in the run.

## 7. Deviations and unresolved risks

- **D-1. Not exercised on cert: `rbacService` through cert's PostgREST.** Doing so needs the stack's service key or JWT secret, and this task forbids reading credentials. On cert, the runtime was exercised as the **same database roles** PostgREST uses (`SET LOCAL ROLE`). The full `rbacService` → PostgREST v16.2 → DB path, including the interim legacy-insert behaviour, was proven 12/12 in 015R on an isolated copy built from cert, with the same images and identical effective privileges.
- **D-2. No `NOTIFY pgrst, 'reload schema'`.** The migration changes grants only, not schema, and privileges are checked at execution time.
- **Risks (unchanged):**
  - production's role graph and default privileges are unknown; the migration aborts cleanly on an unexpected writer, but that must be observed there;
  - C-7 remains an operator gate.

## 8. Explicit confirmations

- **Production:** not accessed; no production C-1…C-9 checks run.
- **Deferred RBAC contract step:** not applied (service_role still holds the interim INSERT).
- **Release:** no push, PR, merge or deployment; no browser passkey tests.
- **Other resources:** `c15r-ci`, `c15r-ci2`, `c15r-db`, `c15r-rest` and `c15r-net` were not touched (still stopped and retained). No other container, volume or database was used.
- **Repository:** no application code or migration file was modified, and nothing was committed.

## 9. Evidence files

Session scratchpad, `c15s/`:
- `cert_015s.sh`: the exact procedure;
- `cert_015s.log`: the full run log;
- `matrix_before.txt`, `matrix_after.txt`, `matrix_final.txt`;
- `eff_before.txt`, `eff_after.txt`, `eff_expected.txt`, `eff_final.txt`;
- `fp_before.txt`, `fp_after.txt`, `fp_final.txt` (schema fingerprints);
- `apply.out`;
- `probe_B*.{sql,out,err}`, `probe_P*.{sql,out,err}`.

## 10. Remaining blockers (not authorized here)

1. **Production:** C-1…C-9; inspection of default privileges and the role graph; migration of 0001–0004 and 20261211000001 (operator action, by explicit file, ledgered).
2. **Release path:** push / PR / merge / deploy of `integration/closure-014a` (`4301771a` + `5444b0af`, which must ship together); then C-7; then promote the deferred contract with a fresh version.
3. **Browser passkey (WebAuthn) verification** of the step-up flows.
4. **Carried over:**
   - the `governance_performance_guard` race;
   - pinning `disable_company_cascade`'s `search_path`;
   - locking the 3 resolved type-check baseline errors;
   - the 53 pre-existing test failures;
   - removal of the retained `c15r-*` throwaways after review.
