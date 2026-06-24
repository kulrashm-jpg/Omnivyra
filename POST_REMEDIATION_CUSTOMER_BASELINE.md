# POST_REMEDIATION_CUSTOMER_BASELINE.md

Phase 16E · Phase 9 — CUSTOMER-only metrics, before vs after remediation. n = 5.

## Before → After

| Milestone | Before | After | Δ |
|---|---|---|---|
| PROFILE complete (conf ≥ 60) | 2/5 | **2/5** | 0 |
| DOMAIN verified | 0/5 | 0/5 | 0 |
| GA connected | 0/5 | 0/5 | 0 |
| GSC connected | 0/5 | 0/5 | 0 |
| TEAM established | 0/5 | 0/5 | 0 |
| ACTIVATION (active 30d) | 3/5 | 3/5 | 0 |
| EXECUTION (≥1 event) | 1/5 | 1/5 | 0 |
| VALUE | 1/5 | 1/5 | 0 |

**No metric moved.** Verified directly against production: customer profiles remain 2 scored,
3 unscored — unchanged.

## Why nothing moved (honest accounting)

| Failure | Fixable in code? | Action taken |
|---|---|---|
| PROFILE scoring | **Yes** (product bug — lazy scoring) | Root cause + idempotent backfill mechanism delivered; **execution gated to the AI-worker** (the scorer hangs/times out here, and re-scoring re-extracts real customer content via LLM). 0 backfilled. |
| DOMAIN pending | **No** (external) | Customer must publish the DNS/HTTP challenge. No server fix without fabricating `verified`. |
| GA disconnected | **No** (external) | Customer must re-authorize OAuth. No server fix without fabricating a token. |
| GSC disconnected | **No** (external) | Same as GA. |
| TEAM | UNKNOWN | 0 invites; cause indeterminate. |

## What WOULD recover (if the gated backfill runs in the AI-worker)

PROFILE complete would move **2/5 → up to 5/5** (the 3 unscored profiles have field data; the
real scorer would populate confidence). That is the **only** in-reach recovery. DOMAIN / GA /
GSC / TEAM **cannot** recover without customer action (DNS, OAuth re-auth, invites) and are
therefore **not** product remediations.
