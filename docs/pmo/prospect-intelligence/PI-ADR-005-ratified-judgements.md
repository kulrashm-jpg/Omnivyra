# PI-ADR-005 — the six ratified judgements

**Status:** RATIFIED by the programme owner, 2026-09-23.
**Base:** `integrate/pi-t2-001` · **Source brief:** `PI-DECISION-BRIEF-001.md`
**Effect:** documentation only. **No implementation, schema, migration, flag or provider was changed by this ratification.**

The decision surface is closed. These are owner decisions and are **not to be reopened unless new *executable* evidence demonstrates a contradiction** — reasoning alone is not sufficient, given this programme has twice found reasoning wrong under execution.

---

| # | Decision | Ratified position |
|---|---|---|
| **J-1** | Tenant hard-delete | **KEEP** — remains blocked by `prospect_lifecycle_block_delete`. Tenant offboarding is a controlled workflow, not a `DELETE`. |
| **J-2** | `uq_outreach_outcomes_id_company` | **KEEP** — the index remains; the composite evidence FK requires it. |
| **J-3** | Governance person FK | **KEEP** — `ON DELETE SET NULL (person_id)` plus the revised CHECK in `20261027000000`. **Do not revert to `NO ACTION`.** D-3 stands. |
| **J-4** | `closed_disqualified` | **KEEP** — one persisted lifecycle state. Six resting states plus initial. |
| **J-5** | Chain trigger + advisory lock | **KEEP**. |
| **J-6** | `origin='human'` | **KEEP** — requires `actor_user_id`, enforced by CHECK. |

## What each ratification locks in

**J-1.** `prospect_lifecycle_transitions.organization_id` cascades from `companies`, and the append-only trigger refuses `DELETE`, so a tenant hard-delete aborts. Precedent: `opportunity_lifecycle_states` has had this property since `20260520`. The append-only guarantee is what makes "why did this prospect move" auditable, and it is not weakened for deletion convenience.

**J-2.** `outreach_outcomes` had no `(id, company_id)` unique index; four other spine tables already carry the equivalent. Additive, idempotent, against a family verified empty at `20261011000000`. Without it, a tenant-safe evidence citation is impossible.

**J-3 — the most consequential.** `NO ACTION` would not preserve the record past the person; it would **refuse the delete**. That reverses D-3 (*"the instruction outlives the person"*), which three real-schema assertions encode, and it would force the erasure procedure to clear `person_id` by `UPDATE` — the one field mutation ADR §16 forbids. Both defects are already proven resolved under the ratified model on real PostgreSQL 17.

**J-4.** `disqualified` already exists as the ICP evaluator's **computed verdict** for an unsatisfied mandatory criterion. A resting state of that name would be the stored-copy-of-a-verdict pattern `PI-ADR-004` §4.1 bans, and would give the platform two meanings for one word.

**J-5.** Without the chain check and advisory lock, "current state = latest row" is not coherent under concurrency and deterministic reconstruction is a claim rather than a property. Both are verified on real PostgreSQL.

**J-6.** Consistent with `PI-ADR-001` §3.5.13 — a model has no user id. A rejection is the signal that a path is not actually carrying a human identity.

## Verification status at ratification

Unchanged by this document, because it changes no code:

- Real-schema: **27 suites / 505 tests / 505 passed**, 41 migrations replayed on disposable PostgreSQL 17
- Unit convergence (T2-005): **23 suites / 593 tests**
- Static guards: `check:authz`, `check:migrations`, `check:db-conventions`, `check:route-policy` — all exit 0
- Migration ordering: floor `20261026000000`; no duplicate full-version prefixes above it

## Not decided here

- POLICY-4 retention durations and lawful basis — **legal**, non-blocking
- DL-3 retention integration — **engineering**, non-blocking
- The enrichment no-evidence/billable-call observability gap — recorded, deliberately not implemented
- Production migration application — **requires explicit, separate authorization**
