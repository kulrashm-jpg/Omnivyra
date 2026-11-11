# Shared contracts (D4): Billing owner, SC-7 ratification, social/community consent

Step D4 of the Outreach Foundation completion, 2026-11-05. Documentation and decisions only: no code, schema or store is added by D4.

Each section ends with what is **completed** and what **awaits an owner decision**.

## 1. Billing owner (CR-BL1, C-BL-1)

### What the ownership records say

| Record | Entry | What it establishes |
|---|---|---|
| `docs/programme/milestones.json` | `SF-08` "Credit reservation / confirm / release / reconciliation contract", owner **"Billing track"**, status In Progress | A Billing track exists as an owner role, and it owns the credit contract CR-BL1 depends on |
| `.github/CODEOWNERS:50-51` | `/backend/services/billing/**` → the repository owner account | Review authority over billing code sits with the repository owner |
| Session roster (2026-11-04) | No live session owns Billing (`orch-integration-c8` and `virality-0b` own neither PI nor Billing) | Nobody can receive and answer CR-BL1 |

### Gap for appointment

The Billing track is a named role with **no appointed lead**: no person or session is recorded against it. CR-BL1 therefore stays unsent, and nothing substitutes for it: Outreach writes nothing to the ledger, and charged sends stay blocked.

**Owner decision BL-A:** appoint the Billing track lead, or confirm that the repository owner answers CR-BL1 directly.

CR-BL1 is ready to send unchanged:
- one credit action per channel through the existing feature registry and `apply_credit_reservation` (the only ledger writer): `outreach.email.send`, `outreach.whatsapp.send`, `outreach.social.publish`, `outreach.community.action`;
- charge only on a provider-accepted action (`sent_unverified` / `executed`), never on `uncertain`;
- idempotency key: the attempt id, the recipient claim id or the post id.

## 2. SC-7: message classification, for explicit ratification

Source: `docs/outreach/platform/SC-7-CLASSIFICATION-VOCABULARY.md` (vocabulary `sc7-draft-1`), code in `backend/services/engagementClassification/` (`c889087b9`, on the foundation branch). The persistence columns are migration `20270125000000`: written and disposable-DB tested, **not applied**. The vocabulary is not yet wired into any runtime path.

### 2.1 The 16 codes

| # | Code | Governance | Meaning | Proposed effect (PI / Orchestration) |
|---|---|---|---|---|
| 1 | `positive_interest` | no | Interest in the offer or the conversation | `replied` → `engaged`; exit journey; hand to human |
| 2 | `enquiry` | no | Commercial enquiry about product, service or fit | `replied` → `engaged` |
| 3 | `information_request` | no | General, non-commercial question | `replied` → `engaged` |
| 4 | `pricing` | no | Price, cost, plans or terms | `replied` → `engaged` |
| 5 | `meeting_request` | no | Asks for or accepts a meeting, call or demo | `replied` → `engaged`; task: schedule |
| 6 | `objection` | no | Pushback that does not end the conversation | `replied` → `engaged`; hand to human |
| 7 | `not_interested` | no | Declines this approach; not an opt-out | `replied`; `rejected` only when an operator confirms |
| 8 | `follow_up` | no | Contact me later | `replied`; propose a re-entry timer (Q-4) |
| 9 | `complaint` | **yes** | Complaint about being contacted (spam, harassment, "never signed up") | `unsubscribed` → `closed_disqualified`, plus a `complaint` restriction on every channel (`*`); operator alert |
| 10 | `support_request` | no | Problem with the product or service | `replied`; route to support |
| 11 | `unsubscribe` | **yes** | Remove me from a list / all future messages | `unsubscribed` → `closed_disqualified`, plus a restriction |
| 12 | `stop` | **yes** | Channel STOP instruction | `unsubscribed` → `closed_disqualified`, plus `dnc_channel` (`stop` is not a governance type) |
| 13 | `wrong_recipient` | no | Reached the wrong person | No prospect transition; propose `invalid_contact` on the contact point |
| 14 | `out_of_office` | no | Automatic absence reply | No outcome; **do not** exit the journey |
| 15 | `spam_suspicious` | no | The inbound message looks like spam or a bot | No transition; flag |
| 16 | `ambiguous` | no | Nothing determinable; never governance | No outcome; operator review |

### 2.2 Deterministic STOP / unsubscribe / complaint (preserved)

These rules are part of what is ratified, and D4 changes none of them:
1. `stop`, `unsubscribe` and `complaint` are assigned only by the deterministic detector (`detectGovernanceClasses`): no model, network or database.
2. Detection runs before any classifier.
3. A classifier may add labels but can never remove or replace a governance class. An AI-suggested governance class is reported as a candidate for human review and is never enforced.
4. No legacy mapping targets a governance code.
5. Precedence: `complaint` > `stop` > `unsubscribe`.
6. The WhatsApp keyword governance write (`recordWhatsAppOptOut`) is unchanged. The SES complaint restriction (D2) is a transport fact, written independently of SC-7.

Verified 2026-11-05: the four SC-7 suites pass, 321/321, on the foundation tree.

### 2.3 Questions for ratification

| Q | Question | Recommendation | Decides |
|---|---|---|---|
| **Q-1** | Should phrase-level and channel-signal governance matches **record** a restriction, or only classify? | Channel signals (List-Unsubscribe, a provider complaint) record. **Every phrase match, including `stop` and `unsubscribe`, goes to operator review before anything is recorded**, because `closed_disqualified` is irreversible (PI review 2026-11-04) | Owner, with PI |
| **Q-2** | Community-shaped labels (`competitor_complaint`, `problem_discussion`) have no reply-shaped code | Keep them as a separate community dimension; do not add canonical codes | Owner |
| **Q-3** | Who produces `not_interested`, `follow_up`, `wrong_recipient`, `out_of_office`? | Deterministic rules first (`Auto-Submitted`, `X-Autoreply` headers for out-of-office); operator labelling for the rest; no new AI call by default | Owner, Platform AI |
| **Q-4** | `follow_up` and `out_of_office` imply re-timing a journey, which has no outcome-driven branching | Orchestration decides: out-of-office must not end a journey (today any non-STOP WhatsApp reply does) | Orchestration |
| **Q-5** | Thread vs message: triage is thread-level, canonical is message-level | A thread's governance is the union of its messages' governance, never overwritten by a later message | Owner |

**Acknowledgements:**
- **PI (virality-b6):** technical read received 2026-11-04. Its amendments are in the draft:
  - `stop` → `dnc_channel`;
  - `wrong_recipient` → `invalid_contact`;
  - `ambiguous` → no outcome;
  - phrase matches go to review.
- **Orchestration (c7):** request sent 2026-11-04; no response yet (c7 is closing Prompt 3).

**Owner decision SC7-R:** ratify the 16 codes and §2.2 as they stand, and answer Q-1, Q-2, Q-3 and Q-5. Q-4 is Orchestration's. Until ratified, the persistence migration stays unapplied and nothing is wired (B closure blocked).

## 3. Social/community consent: can the existing record be extended?

### 3.1 The existing model

`contact_governance_records` is PI's canonical store, written only through `recordContactGovernance` and read through `evaluateCanonicalGovernance`.

| Dimension | What it supports | Evidence |
|---|---|---|
| Tenant | `organization_id`, tenant-first everywhere | `contactGovernanceWriter.ts` |
| Who | `person_id` (composite FK, same tenant) or a normalised target | `contactGovernanceWriter.ts:125-153` |
| Channel | **Free text** ("a new channel must never require a migration"); `*` = all channels | `contactGovernance.ts:65-70` |
| What | A closed vocabulary of **restrictions**: `dnc_permanent`, `dnc_channel`, `unsubscribe`, `consent_withdrawn`, `invalid_contact`, `bounce_hard`, `complaint`, `deferred`, `campaign_exclusion` | `contactGovernance.ts:52-62` |
| Purpose | `purpose_scope` `outreach` / `account`, only on `unsubscribe`, `consent_withdrawn`, `complaint`; NULL = every purpose | `contactPurpose.ts:142,160` |

**It already serves social and community.**
- The community L-3 recheck evaluates it with channel = platform (`communityRecipientRecheck.ts:27-31,190-213`), and it fails closed on any read failure.
- The operator "do not engage" writer records `dnc_channel` on the platform channel (`communitySocialDoNotEngage.ts`).

### 3.2 What it cannot express (the exact gaps)

| Gap | Detail | Effect today |
|---|---|---|
| **CG-1: no positive consent** | Every type is a restriction. "Allowed" means "no restriction recorded"; the recheck says so explicitly: "a missing record is not proof of consent" | Public replies to a person's own public comment run on "not restricted". **DMs are refused** (`dmDispatchSafety`), so nothing yet depends on positive consent |
| **CG-2: no action dimension** | A restriction applies to a whole channel (platform). There is no way to record "may reply publicly, may not DM" or "do not connect" | Any platform restriction blocks every action on that platform: over-blocks, fails safe |
| CG-3 (known, PI) | A social target is casefolded, but LinkedIn ids are case-sensitive (G2) | Possible collision; over-blocks |
| CG-4 (known, PI) | `purpose_scope` is limited to 3 types; a channel DNC cannot be purpose-scoped (G3) | Unscoped = every purpose; fails safe |
| CG-5 (known, PI) | No actor column; the actor lives in the evidence summary (G1) | Auditable, not indexed |

### 3.3 Assessment

**The existing model is viable and is reused. No new consent store.**
- For restrictions, which is all that runs today, it already covers social and community channels with no change.
- For action-specific restrictions (CG-2), it can be extended inside the same table. Two options, both PI-owned:
  - **(a)** an `action_scope` column like `purpose_scope` (NULL = every action), with an evaluator rule that a NULL-scoped restriction blocks every action;
  - **(b)** a channel sub-key convention (`linkedin:dm`) plus an evaluator rule that `linkedin` also blocks `linkedin:dm`. This is a semantic change to channel matching.

  **Recommendation: (a).** It mirrors the precedent PI already built for purpose scoping, and it cannot widen any existing restriction.
- Positive consent (CG-1) is a different kind of fact: a grant, not a restriction. Adding grant types would change the ADR's "restriction vocabulary" contract. It is needed only before DMs or other recipient-initiated-permission actions are enabled, so it is an owner decision, not a build item.

**Owner decisions:**
- **CN-1:** confirm `contact_governance_records` as the canonical consent store for social and community recipients. PI confirmed it is canonical (CR-PI1); social/community use was returned to the owner.
- **CN-2:** decide whether action-scoped restrictions are needed now. If so, PI adds them as option (a). If not, platform-wide restrictions stay, which over-blocks and fails safe.
- **CN-3:** decide whether any social action (DMs, connection requests) will require positive consent. If yes, PI decides how grants enter its ADR; DMs stay refused until then.

## 4. Summary

| Item | Completed | Awaiting owner |
|---|---|---|
| Billing | Ownership records searched; Billing track exists (SF-08), no lead recorded; CR-BL1 ready | **BL-A:** appoint the lead or answer directly |
| SC-7 | 16 codes, effects, deterministic rules and Q-1..Q-5 presented; PI technical read in; 321/321 tests | **SC7-R** (codes, §2.2, Q-1/2/3/5); Q-4 Orchestration; c7 acknowledgement |
| Consent | Existing model assessed; reused; exact gaps CG-1..CG-5 | **CN-1, CN-2, CN-3** |
