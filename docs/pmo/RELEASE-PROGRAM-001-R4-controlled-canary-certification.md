# RELEASE-PROGRAM-001 — R4 / RL-004

## Controlled Canary Validation & Live Operational Certification

**Roles:** Principal Release Authority · Production Operations Lead · SRE · AI Safety Architect ·
Independent Operational Certification Authority.
**Type:** First milestone that *could* authorize a real outbound action. **Operational safety over
feature validation.**
**Question:** May the deployed GTM platform perform its first controlled live send **now**?

---

## 0. Certification Decision

# ❌ CANARY NOT AUTHORIZED

The milestone's mandatory entry rule is explicit: *"Proceed only if all are satisfied … If any
requirement fails: STOP. Return CANARY NOT AUTHORIZED."* **Two of the three entry-requirement groups
fail.** No live send may occur. Execution remains OFF. **Remain in R3.**

This is not a canary failure — it is the correct refusal to begin one. A live canary additionally
requires a deployed platform, enabled production execution flags, and an operator-chosen **consented**
recipient — none exist, and the send itself is an irreversible, outward-facing action I do not perform
autonomously (consistent with M5/M5B).

| Mandatory entry requirement | Required | Actual (2026-07-27) | Verdict |
|---|---|---|---|
| **Deployment completed** | prod deployed, runtime healthy, rollback verified | stack **UNMERGED** (`main`=`3e941441`); **not deployed**; R3 = NOT CERTIFIED | ❌ |
| **M-1 approval server-verified** | caller-asserted approval prohibited | `execution.ts` still `approved: b.approved === true` (client-asserted) | ❌ |
| **M-2 kill-switch most-restrictive layer** | cross-tenant masking prohibited | `executionControlService` layered `.find` still company-blind for connector/campaign | ❌ |
| **m-1 release RBAC enforced** | — | `case 'release'` still has **no** capability check | ❌ |
| **m-2 campaign override authz enforced** | — | `campaign.override` bound to no role (unaddressed) | ❌ |
| **m-3 audit failures observable** | — | `recordExecutionAudit` still swallows insert errors | ❌ |
| **Default-OFF until canary explicitly enabled** | OFF | `GTM_EXECUTION_ENABLED`/`GTM_LIVE_SEND` unset ✓ | ✅ |

Six of seven entry conditions are unmet. **A single failure mandates STOP; six fail.**

---

## 1. R4-401 — Execution Safety Report — ❌ NOT CERTIFIED (findings open)

Static re-verification against current code confirms the R2 execution-safety findings are **unresolved**:
- **Approval enforcement — FAILS (M-1):** the guarded bridge enforces `req.approved`, but the API sets
  it from the request body (`approved: b.approved === true`) and only checks `campaign.execute`. An
  executor can self-approve → approver/executor separation is not enforced server-side. **A live send
  under this condition is an approval bypass — disqualifying.**
- **Kill-switch precedence — FAILS (M-2):** `isExecutionEnabled` matches connector/campaign control
  rows without scoping to the owning company; a `__global__` enabled row can mask a tenant
  `emergency_stop`. Kill-switch may fail **open** cross-tenant.
- **Release RBAC — FAILS (m-1):** any authenticated tenant member can un-suppress (`release` has no
  capability gate) — a consent/compliance hole that must close before any send.
- **Override authz — FAILS (m-2):** `campaign.override` grants to no role → the kill-switch/control API
  is unreachable; the operator cannot exercise the live kill-switch.
- **Audit observability — FAILS (m-3):** audit-insert failures are swallowed; a lost audit row during a
  live send would be silent.
- **Suppression / quota / tenant isolation — verified sound (R2):** fail-closed suppression, fail-closed
  distributed quota, and application-enforced tenant isolation hold — **but they cannot compensate for
  an unenforced approval boundary or a maskable kill-switch.**

**No live operation may be gated by controls that are known-broken.** Execution Safety: **NOT CERTIFIED.**

## 2. R4-402 — Canary Configuration Report — ⛔ not configured

No tenant, campaign, operator, or recipient has been (or will be) designated. Selecting a live recipient
and a sending tenant is an **operator decision the certification authority must not make**, and there is
no deployed platform to configure. **Not configured — by rule and by state.**

## 3. R4-403 — Live Execution Report — ⛔ not performed

**No live outbound operation was performed.** It is blocked four ways: (a) entry requirements unmet;
(b) no deployed platform / execution flags OFF; (c) the connector is structurally dry-run (returns
`dispatched:false` unconditionally; live wiring is M5-deferred and absent); (d) an irreversible real
send to a real person is a human-owned action I do not take autonomously. **No dispatch, no provider
call, no send.**

## 4. R4-404 — Operational Telemetry Report — ⛔ no data

No canary ran → no execution/provider latency, no live audit/telemetry, no queue metrics to report.
Fabricating any such measurement would be trust-theater. **No telemetry — nothing was executed.**

## 5. R4-405 — Observation Report — ⛔ no observation window

No post-canary observation window opened (nothing to observe). The deployed baseline itself does not yet
exist (R3 open).

## 6. R4-406 — Rollback Readiness Report — ✅ reversibility intact (nothing to reverse)

Execution is already OFF and cannot send (flags unset + structural dry-run + no enabling control row).
The documented rollback (redeploy `3e941441`; additive/flag-dark schema ⇒ zero data loss — R3 runbook
§7) remains executable. **No queued or unintended sends exist.** Reversibility is total precisely
because no live path was opened.

## 7. R4-407 — Operational Risk Report

| Risk dimension | If a canary were forced now | Recommendation |
|---|---|---|
| Execution risk | **High** — approval bypass (M-1) + maskable kill-switch (M-2) | Do not proceed |
| Customer impact | **High** — real email under unenforced approval + no-RBAC un-suppress (m-1) | Do not proceed |
| Security risk | **High** — self-approval, cross-tenant kill-switch masking | Do not proceed |
| Infrastructure risk | Unknown — platform not deployed/observed | Do not proceed |
| Operational risk | **High** — no deployed baseline, controls known-broken | Do not proceed |

**Recommendation: REMAIN IN R3 → resolve safety findings + complete deployment before any canary.**
(Not "❌ ROLLBACK REQUIRED": nothing is deployed or executing, so there is nothing to roll back — the
system is already in the safe default-OFF state.)

---

## 8. Outstanding blockers & unblock path

**Blockers (all must close before R4 can run):**
1. **Complete R3** — resolve A1 (CI build env), approve PRs, squash-merge, apply migrations, deploy,
   verify healthy (per R3A checklist). *No deployed platform today.*
2. **Fix the five R2 execution-safety findings** (engineering — permitted to fix discovered blockers):
   - **M-1:** bridge consults a **persisted, approver-signed** approval; never accept `approved` from the client.
   - **M-2:** evaluate the **most-restrictive** matching control row per layer; scope connector/campaign matches to the owning company.
   - **m-1:** gate `release` (un-suppress) behind a capability.
   - **m-2:** bind `campaign.override` to the operator/security role.
   - **m-3:** emit a HARDEN-001 failure metric on audit-write failure.
   - Add regression tests for approval-source and cross-company kill-switch layering.

**Then, and only then**, R4 may configure exactly one tenant / campaign / operator / **consented**
recipient (operator-chosen), enable the flags **only in that controlled runtime**, perform **one** send,
measure the full chain, observe, and certify.

I can **implement the five safety fixes** (M-1, M-2, m-1, m-2, m-3) as a scoped engineering change on
your explicit go-ahead — flag-dark, additive, with tests — and re-verify. I will **not** enable
execution, choose a recipient, flip a production flag, or perform a send.

---

## 9. Certification Statement

The GTM platform is **not eligible for a controlled canary**: it is undeployed (R3 open), and every one
of the R2 execution-safety findings that must close before a live send remains open — verified in the
current code (caller-asserted approval, maskable kill-switch, un-gated `release`, unbound override,
swallowed audit errors). The one satisfied requirement — execution default-OFF — is the safe state that
must persist. A live canary requires controls that are known-broken to first be fixed, a platform to
first be deployed, and an operator to own the irreversible send.

**Decision: ❌ CANARY NOT AUTHORIZED.** Remain in R3. Execution remains OFF; no send performed;
production untouched. Re-run R4 after §8 is complete.

*Operational-safety milestone — read-only assessment + entry-gate enforcement. No merge, no deploy, no
flag change, no recipient chosen, no dispatch, no provider call, no send.*
