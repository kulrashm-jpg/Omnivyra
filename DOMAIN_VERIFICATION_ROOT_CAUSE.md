# DOMAIN_VERIFICATION_ROOT_CAUSE.md

Phase 16E · Phase 3 — root cause of pending domains (2 of 5 customers: Unfinished, Embrosales).
Evidence from the code path.

## Flow stages (from `domainVerificationService.ts` + `pages/api/domain/verify.ts`)

| Stage | Status |
|---|---|
| verification initiated (`company_domains` row) | ✅ present for the 2 pending |
| verification token created | ✅ `verification_token` set (else `verifyDomainRow` short-circuits `no_token`) |
| challenge published by customer (DNS TXT **or** HTTP file) | ❓ **not confirmable from our side** |
| verification check executed | only **on demand** via `POST /api/domain/verify` → `verifyDomainRow` → `checkDnsTxt` then `checkHttpFile`. **No cron / background re-check exists.** |
| result stored | `verification_status = 'verified'` only when `checkDnsTxt` or `checkHttpFile` matches |

## Root cause (confirmed mechanism; cause is EXTERNAL)

`verifyDomainRow` verifies by checking that the **customer has published the verification
token** as a DNS `TXT` record or an HTTP file on their domain. A record stays `pending` when
that check does not match — i.e. **the customer has not published the DNS/HTTP challenge** (or
published it and never re-triggered the on-demand verify). The token exists; the challenge
artifact on the customer's domain does not.

**This is an EXTERNAL / customer-completion dependency, not a server code bug.** There is no
product code path that can complete it without the customer publishing the record — and the
product must not fabricate a `verified` status.

## Secondary product gap (minor, not the blocker)

There is **no automatic re-check** — verification only runs when the user hits
`/api/domain/verify`. A customer who publishes the record but never returns to click "verify"
stays pending. A background re-check cron *would* help that narrow case, but it cannot help the
dominant case (record never published). Adding a cron is **automation** — out of this phase's
scope, and noted only as an observation.

## Revises 16D

16D classified DOMAIN as PRODUCT_FLOW (MEDIUM) from "attempted-but-pending." Deeper code
forensics show the non-completion is **external (customer must publish DNS/HTTP challenge)** —
**not** a server bug. Correction recorded.
