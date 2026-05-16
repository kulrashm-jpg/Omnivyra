# Billing Authenticated Operator Smoke Checklist (FULL-GA gate)

The machine-verifiable layers are certified (see
[final-enterprise-billing-certification.md](./final-enterprise-billing-certification.md)).
The items below require an **authenticated browser session as real
roles** and **commit real (small) financial mutations to the production
immutable ledger** — they can only be performed by a human operator, not
the automated harness, and were deliberately NOT executed automatically
(no fabricated results, no irreversible test rows written by tooling).

Each step lists the exact UI action, the **expected terminal UX**, and
the **DB assertion already proven** by `validate-billing-live.ts` /
`billing-readiness-recon.ts` so you are only confirming the live wiring,
not re-deriving correctness.

> Use a disposable/internal test organization for grant/revoke so the
> permanent ledger rows are intentional. Capture the `correlationId`
> shown in each terminal state.

---

## A — Super Admin small grant (`<5000`)

1. Login **SUPER_ADMIN** → `/super-admin` → Credits & Billing.
2. Select test org → Grant → e.g. `100` credits, reason, Confirm.

- [ ] Green terminal: **"Credits granted successfully"**, `correlationId` shown
- [ ] No infinite spinner (resolves < 30 s; timeout state otherwise)
- [ ] Ledger Explorer shows a new immutable row (UPDATE/DELETE blocked — proven)
- [ ] Wallet balance increased by the grant
- [ ] Financial timeline shows the `ledger` event
- [ ] `GET /api/admin/billing/health` still `overall: ok`

## B — Approval-gated grant (`>=5000`)

1. Same panel → Grant `5000+` → Confirm.

- [ ] Blue terminal: **"Awaiting approval signatures"**, `approvalId` + required-sig count
- [ ] HTTP **202** (not 200); no ledger row yet
- [ ] Row visible in Approval Queue
- [ ] Proposer cannot sign own request (self-sign blocked — proven `APPROVAL_SELF_NOT_ALLOWED`)

## C — Multi-admin signature

1. Login a **second SUPER_ADMIN / FINANCE_APPROVER** → Approval Queue → Approve.

- [ ] Threshold enforced (N-of-M from `required_approvals_for_action` — proven)
- [ ] Approval transitions pending → approved → executed
- [ ] Grant applies **exactly once** (idempotency_key unique — proven; 0 dupes live)
- [ ] One immutable ledger row; wallet updated once
- [ ] Approval row frozen after execute (proven `APPROVAL_FROZEN`)

## D — Revoke

1. SUPER_ADMIN → Revoke → category + amount + reason → Confirm.

- [ ] Green terminal: **"Credits revoked successfully"** (revoked/requested), `correlationId`
- [ ] Immutable revoke ledger row; balance reduced correctly
- [ ] Approval chain enforced if amount ≥ threshold

## E — Freeze / Unfreeze

1. Freeze billing (reason) → then Unfreeze (reason).

- [ ] Freeze: green **"Billing frozen successfully"**; org shows frozen
- [ ] A credit-consuming action while frozen is blocked
- [ ] Unfreeze: green **"Billing unfrozen successfully"**; consumption restored

## F — Company Billing Portal (isolation)

1. Login **COMPANY_ADMIN** of the test org → `/company/billing`.

- [ ] Wallet balance + the grant reflected
- [ ] Consumption / burn-rate / activity feed render
- [ ] Switching to a different org's id in the URL/API → **denied**
      (all 3 portal endpoints enforce `assertOrgAccess` — verified)

## G — Exports

1. Generate ledger / timeline / usage export.

- [ ] Download succeeds
- [ ] A `billing_export_manifests` row with `content_sha256` (immutable —
      proven UPDATE blocked)
- [ ] Export audit event emitted; `correlationId` traceable

## H — Idempotency / recovery

1. Double-click Confirm on a grant rapidly (or resubmit same Idempotency-Key).

- [ ] Exactly one ledger row / one settlement (replay blocked — 0 dup keys live)
- [ ] No permanent stuck state; failure terminal shows retry guidance
- [ ] No infinite loading (AbortController 30 s terminal — implemented)

---

## I — Health + reconciliation (already executed, read-only)

- `overall: ok`, reconciliation/approvals/postgrest/rollout = **ready**
- 0 negative balances · 0 stuck billing_operations · 0 duplicate
  idempotency keys · 0 systemic drift
- **One pre-existing legacy-data item (operator decision, not a system
  fault):** org `4bdbec26-4f7e-4e77-a965-d499e1472f5c` has a wallet
  balance that predates the freshly-migrated immutable ledger (wallet
  free=120 vs ledger sum -60) and one stale >24 h hold
  (`total_reserved=0`). Not introduced by this work (zero mutations
  committed by tooling). Reconcile by posting an adjusting ledger entry
  to align that wallet, or formally accept it as pre-ledger legacy.

## Sign-off

- [ ] A–H all green in the live UI (operator initials + date)
- [ ] Legacy org `4bdbec26…` reconciled or accepted (operator decision)

When both boxes are checked, the verdict is **READY FOR FULL GA**.
Until then it remains **READY FOR LIMITED GA** (system certified;
authenticated smoke pending operator).
