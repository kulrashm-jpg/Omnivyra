# CPG-U1 — Invitation packet (BLANK TEMPLATE, per role)

**Classification: PREPARATION.** This is the text a candidate is shown **before** accepting a role.
It names no person and no organisation-internal detail. **It is not outreach**: nobody has been
contacted, and this document does not authorise contacting anyone.

Read with `ROLE_DESCRIPTIONS.md` and `INDEPENDENCE_DECLARATION_TEMPLATE.md`. The operator sends the
role-specific section and nothing else; the "what you will not be told" section is sent **with** it,
so the candidate can see the blinding is deliberate.

| Field | Value |
|---|---|
| Role offered | `UNASSIGNED` |
| Candidate | `UNASSIGNED` |
| Pseudonym to be used in study artifacts | `UNASSIGNED` |
| Study id | `CPG-U1-2026-01` |

---

## 1. Purpose — what every candidate is told

You are invited to take a paid, one-off, independent role in a pre-registered methodological study.
The study asks **one** narrow question about a software system: **when it reports a fact about a
company, is that fact actually supported by an authoritative source, and when no authoritative
source exists, does the system withhold the claim rather than fill it in?**

Facts in scope: exactly three fields — **founding year**, **employee count**, **revenue**.

The study is **single-arm**: there is no treatment and control, no product comparison, and no arm
identity to hide from you. The companies involved are drawn by a public, verifiable random procedure
before anyone sees any result, and the answers you will work with are fixed and hashed before the
software is ever run. Your work is one input to a published result; it is not a review of anyone's
product, and it is not an endorsement.

**The system's own output is not evidence in this study.** That is the point of your role: the
study needs values, or judgements, that were produced **without** the system's involvement.

---

## 2. Purpose at the level each role is permitted to know

> Send exactly **one** of these.

### 2.1 Enumerator

You will build a list of candidate companies from public, registry-anchored sources, and answer a
fixed set of yes / no / unknown admissibility questions per company, recording the source URL for
each. You also record a prediction of what the study should find for that company. You will be given
the frame template, the admissibility rules (§5.1–§5.4), the independence rules (§4A), the
jurisdiction-family list, and a small registry of companies to exclude. **Nothing else.** You will
not know how many companies will be drawn, or which ones.

### 2.2 Reference Author / Reference Confirmer

You will look up, for each company on a fixed list, the founding year, employee count and revenue —
each from an **authoritative source** of a specified class, with its URL, publication date and
as-of date — and record them in a fixed format. Where no authoritative source states the value, you
record that plainly, with a note on what you searched. Two people do this task **independently**,
from scratch, and neither sees the other's answers. That duplication is the measurement.

### 2.3 Reference adjudicator

Where the two independent lookups disagree, you will be shown the two candidate records
**unlabelled**, with the company's identifying details, the field definition, the value-format rules
and the authority table, and you will choose one of them — or declare that neither can be
established. You will **not** be able to supply a value of your own; that is a deliberate
restriction, not an oversight.

### 2.4 Rater 1 / Rater 2

You will be shown, one observation at a time: a field, the value the software reported (or the fact
that it reported nothing), the source URLs the software cited for that value, and a reference record
stating what an authoritative source says. You apply a **fixed decision procedure** to reach one of
seven categorical labels. The procedure is written down for you; you follow it rather than forming
an overall impression. Two people rate every observation independently.

### 2.5 Rating adjudicator

Where the two independent raters chose different labels, you will be shown the same material they
saw plus the **two labels, unlabelled as Label A and Label B**, and you choose one — or declare the
reference material insufficient to decide. You will not know which rater gave which label, and you
will not know how many disagreements there are.

---

## 3. Time commitment

| Item | Value |
|---|---|
| Estimated total hours for this role | `UNASSIGNED` |
| Expected calendar window (start / end) | `UNASSIGNED` |
| Working arrangement | Your own schedule inside the window; the work is not interactive and not supervised. |
| Turnaround once material is released | `UNASSIGNED` |

Fixed, non-negotiable scheduling facts, from the protocol:

- **Reference Author / Confirmer:** both record sets must be complete and submitted **before** any
  disagreement is adjudicated and **before** the study's inputs are sealed (§9.2.1 Timing).
- **Reference adjudicator:** works only **after** both record sets are submitted, and only **before**
  the seal.
- **Raters:** the rater packets exist only **after** the software has been run against the sealed
  inputs. Both raters must submit **complete** sheets (every item labelled, or explicitly `pending`).
- **Rating adjudicator:** works only **after** both raters have submitted complete sheets
  (§12.2 Timing).
- **≥ 90%** of observations must be completely rated or the whole run is INCONCLUSIVE — so an
  abandoned rating sheet is not a neutral outcome.

The role is **one-off**. There is no ongoing engagement, and none may be offered or implied.

---

## 4. The blinding rules that bind you

By accepting, you agree to these for the duration of the study, up to publication of its results:

1. **You will not seek out, run, or look at the software's output** beyond exactly what your packet
   contains. (Raters and the rating adjudicator are shown the software's value for an item — that is
   part of the packet. Enumerators and the reference team are shown **none**.)
2. **You will not discuss the study, your task, or any value or judgement in it with any other person
   holding a study role.** For the reference Author and Confirmer this is explicit in §9.1: the two
   **never communicate before both have submitted**.
3. **You will not ask for, and will refuse if offered,** running totals, tallies, aggregates,
   provisional results, other people's answers, or the number of items in anyone else's work.
4. **You will not use an AI system, language model or agent** to produce, draft, suggest or check any
   part of your work. Your judgement is what the study is measuring. A role performed with AI
   assistance is not independent work, and the study would publish that finding.
5. **You will record `unknown` or the designated "not available" value** rather than guess. Every
   part of this study treats an unknown as an unknown; nothing rewards a filled-in answer.
6. **You will use your assigned pseudonym** in every artifact you return, and will not put your legal
   name, employer or contact details in any returned file.
7. **You will not publish, blog, post or present anything about the study** before its results are
   published.

There is **no confidentiality obligation about the fact that you were paid, or about these rules
themselves.** They are published protocol.

---

## 5. Fee arrangement (placeholder)

| Field | Value |
|---|---|
| Fixed fee for this role | `UNASSIGNED` |
| Currency | `UNASSIGNED` |
| Payment trigger | Completion and submission of the role's work — **never** a particular result or finding. |
| Written agreement signed on (must be **before** any role material is released) | `UNASSIGNED` |
| `study_fee_agreement_sha256` | `UNASSIGNED` |

Terms fixed by §4A.1 item 5, which are not negotiable:

- The fee is **fixed** and agreed **in writing before any role material is released**.
- The fee is **not contingent** on any result, finding, or future engagement.
- **No other payment or benefit** of any kind may pass between you and the developing organisation,
  in either direction, at any time in the exclusion period.
- The agreement is hashed and its SHA-256 recorded in the personnel register.
- If you would prefer no fee, that is permitted: the register records `null`.

Accepting requires you to complete and sign the independence declaration
(`INDEPENDENCE_DECLARATION_TEMPLATE.md`). **Every one of its seven questions must be answered `no`.**
An `unknown` answer is not `no` and disqualifies the role. The developing organisation must
separately confirm in writing that its records show no employment, contract, payment or financial
relationship with you.

---

## 6. What you will **not** be told — and why

This section is part of the invitation, so you can see what is withheld before you accept.

### 6.1 Enumerators will not be told

- Any output of the software, including the development pilot and the instrument check (§4A.2(b));
- pilot results, sizing output, or quotas (§4A.2);
- how many companies will be drawn, or which;
- who holds any other role.

### 6.2 Reference Author and Confirmer will not be told

- **Any CPG output whatsoever** — not one value the software produced, not the development pilot,
  not the instrument check (§9.1, §9.2, §11: pilot outputs are "**never** shown to the reference
  team");
- **the other's records** — not before submission, not at all before both are in (§9.1, §9.2);
- **the class prediction** for any company — i.e. whether the study expects a value to exist
  (§9.2);
- whether your value later agreed or disagreed with the other record;
- the identity or pseudonym of the other reference person, or of the adjudicator;
- any tally of agreements or disagreements.

### 6.3 The reference adjudicator will not be told (§9.2.1)

- any CPG output, including pilot and instrument check;
- class predictions, identity-hazard notes, stratum or split;
- screening logs, attestations or contamination bases;
- **agreeing records** — you see only the items that disagree;
- the identities **or pseudonyms** of the Author and the Confirmer, or which record is whose;
- **any count or tally of adjudication outcomes.**

### 6.4 Raters will not be told (§12)

- the other rater's labels, or the other rater's identity;
- running tallies, aggregates or provisional endpoint values;
- anything about the **development pilot** or the instrument check;
- the class prediction, stratum, split or identity-hazard note for any company — the packet format
  mechanically excludes them;
- how the study is doing, at any point.

### 6.5 The rating adjudicator will not be told (§12.2)

- which rater gave which label, or rater identities;
- other observations' labels;
- tallies, aggregates or provisional endpoint values;
- class prediction, stratum, split or identity-hazard note;
- pilot outputs;
- **the number of disagreements.**

**What cannot be hidden** (§12.2): the study is single-arm, so raters and the rating adjudicator
necessarily see the company and the software's output for the item they are judging. The protocol
states this limitation rather than pretending otherwise.

---

## 7. Declining, and withdrawing

You may decline without giving a reason. If you accept and then discover that any declaration answer
would not be `no`, tell the operator immediately and stop work — a late-discovered relationship is a
published finding, and stopping early avoids it. Withdrawal before submission means your role is
unfilled and the study cannot proceed past `check-personnel` (exit 4) until it is refilled; that is
the intended behaviour and is not held against you.

---

**Human dependency: H1** for the packet itself (fully prepared; the candidate only reads, decides and
signs). **H2** for the act of accepting a role, and **H3** for everything the acceptance asserts —
no automation can supply an independent person's consent or independence.
