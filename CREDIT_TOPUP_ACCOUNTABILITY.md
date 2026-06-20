# OMNIVYRA — TOP-UP PAY + SEPARATE CREDIT ACCOUNTABILITY

What you described — **buy top-ups → added to the balance → validity managed → spent only after monthly credits → accounted separately** — is **already enforced by the wallet**. I verified it, then made the separation **visible** and aligned the page colors. **TypeScript: 0 errors. No ledger/financial-core change.**

## Already true (verified with code evidence)
| Requirement | Where it's enforced |
|---|---|
| Top-up payment **adds to existing balance** | `purchaseService.ts:165` → `createCredit({ category: 'paid', referenceType: 'credit_purchase' })` |
| Top-ups **spent only after monthly credits** | `creditPriorityService.computeSplit` consumes **free → incentive → paid**; top-ups are `paid` → spent **last** |
| Top-ups **never expire** (validity managed) | `creditExpiryService.ts:12` — `paid` is "NEVER expired, blocked at service + DB level" (free/incentive may expire) |
| **Separate accountability** | `organization_credits` keeps `free_balance` / `incentive_balance` / `paid_balance` + per-bucket `reserved_*` |

**Bucket mapping:** `free` = Plan credits (spent 1st, can expire) · `incentive` = Bonus credits (2nd) · `paid` = Top-up credits (3rd, never expire). So top-up credits are only ever touched once plan + bonus are exhausted — exactly your rule.

## What I added (read-only — surfaces the separation)
| File | Purpose |
|---|---|
| `backend/services/creditAccountabilityService.ts` | Read-only — maps the 3 buckets to plan/bonus/top-up with available balance, validity (`neverExpires`), and `consumptionRank` |
| `pages/api/billing/credit-breakdown.ts` | `GET …?org_id=` → the breakdown (`withOrgAccess`) |
| `components/billing/TopUpPanel.tsx` | New **"Your credits"** block: each bucket with balance + "Never expires / May expire" + a spend-order note; refreshes after a purchase |

The pay option itself (Razorpay checkout → `paid` grant) is the staging top-up flow already built in Phase A.2; this adds the **accountability view** around it.

## Color alignment (pricing page → site brand)
The page already used the brand palette (`#0A66C2`, `#071D3A`, `#5D6F83`, `#C9DDF3`, `#F7FBFF`, `#F5F9FF`). Tightened to match the landing exactly:
- Hero gradient → `linear-gradient(150deg, #0A1F44 0%, #0A3A7A 45%, #0A66C2 100%)` (the landing hero gradient).
- Primary CTA → `bg-[#0A66C2] hover:bg-[#0857A8] shadow-omnivyra` (the landing's primary-button treatment); secondary → `hover:bg-[#EEF6FF]`.

## One genuine gap (subscription side — deferred)
The **monthly subscription grant** — depositing each plan's monthly credits into the `free` (spent-first, expiring) bucket every cycle — is part of the **not-yet-built subscription billing**. Today `free` holds the one-time Free-plan grant; when subscriptions ship, the monthly allocation grants to `free` and this whole model works end-to-end with no ledger change. The accountability view already renders it correctly the moment those credits land.

*(Read-only additions + page colors only. No ledger/credit/financial-core change. Typecheck clean.)*
