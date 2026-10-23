# Q2_EVIDENCE_REQUEST_MATRIX

**Artefact class: PREPARATION + HUMAN-REQUIRED INPUT.**
This document is **not** DeepTech evidence and is **not** Q2 evidence. It is a request list.
Q2 evidence exists only when the external documents themselves exist, signed and dated by the
party competent to issue them. Nothing in this repository, and nothing any engineer can build,
converts into a single row of Q2 evidence.

| Field | Value |
|---|---|
| Base SHA | `af2fb6e99ce461894bf16f18c2251f75088eba18` |
| Worktree | `C:/tmp/dt4-corp` (disposable, detached HEAD) |
| Source of the item list | `DEEPTECH_BASELINE_001.md` §14 (lines 785–795) and §17 BG-04 (line 895), BG-05 (line 896), BG-08 (line 899), BG-09 (line 900) |
| Prepared by | Stream Q / Part K, DEEPTECH-PARALLEL-004 |
| Read-only | Yes. No commit, no product code change, no network call, no database access |

---

## 1. Why this list and no other

The item list below is **derived**, not invented. It is the literal enumeration in the baseline's
own Q2 table and its BG-04 row:

- `DEEPTECH_BASELINE_001.md:785` — `### Q2 — R&D intensity & capital -> ABSENT (approx. 85% outside the repository)`
- `DEEPTECH_BASELINE_001.md:789` — `| Development period, volume, cadence | 931 commits, 2026-01->09, 1,410 tests | PROVEN |`
- `DEEPTECH_BASELINE_001.md:790` — `| Architecture/design deliberation | docs/pmo/, docs/company-intelligence/ | SUPPORTED |`
- `DEEPTECH_BASELINE_001.md:791` — `| Model/API spend | tracking code only (usageLedgerService, pricingService) | PARTIAL |`
- `DEEPTECH_BASELINE_001.md:792` — `| R&D expenditure; CA certification; payroll; personnel; qualifications; time allocation; infrastructure invoices; grants/AIF; board records | (absent) | ABSENT |`
- `DEEPTECH_BASELINE_001.md:794` — `Q2 is the binding constraint on DPIIT readiness and no engineering work can close it.`
- `DEEPTECH_BASELINE_001.md:895` — BG-04: `All Q2 financial/personnel evidence outside the repository | CRITICAL | DPIIT readiness entirely | No — longest external lead time`
- `DEEPTECH_BASELINE_001.md:908` — `BG-04 and BG-05 are the two gaps engineering can never close, and together they gate DPIIT readiness completely.`

Two rows of the baseline's Q2 table (lines 789, 790) are the only ones the repository touches, and
they are recorded there as *development-activity* facts. Those are carried here as items **Q2-14**
and **Q2-15** and are the entire scope of `Q2_REPOSITORY_RECOVERABLE.md`. Line 791 (model/API spend)
is `PARTIAL` because the repository holds *tracking code*, never *amounts paid* — it is split below
into the engineering half (Q2-09a, H0) and the invoice half (Q2-10b, H3).

**The 3-to-15 ratio between recoverable and external items is the whole finding.** It is consistent
with the baseline's own "approx. 85% outside the repository" (line 785).

---

## 2. Human-dependency classes

| Class | Meaning | Can engineering close it? |
|---|---|---|
| **H0** | RECOVERABLE-FROM-REPOSITORY — computable read-only from git history and tracked files | Yes, and it is already done (see `Q2_REPOSITORY_RECOVERABLE.md`) |
| **H1** | OPERATOR-ONLY — only the founder/operator holds or can author it (internal records, time allocation, declarations) | **No** |
| **H2** | EXTERNAL-PROFESSIONAL — requires a retained chartered accountant, company secretary or counsel to issue or certify | **No** |
| **H3** | EXTERNAL THIRD PARTY — issued by a bank, vendor, investor, or a government registry; neither the operator nor a retained professional can author it | **No** |

**Lead time.** Absolute durations are `NOT AVAILABLE IN REPOSITORY — operator and retained
professionals to confirm`. No calendar figure is asserted here, because inventing one would be
exactly the class of error this programme exists to avoid. What *is* derivable is a **relative
rank**, from the baseline's own statement that BG-04/BG-05 carry "the longest external lead times
in the program" (line 908):

- **L1** — operator can produce from records already in hand, no third party in the loop
- **L2** — operator must assemble from vendor portals / statements, still no professional
- **L3** — requires a retained professional to review and sign
- **L4** — requires a professional *plus* a registry, bank or investor turnaround outside anyone's control

---

## 3. The matrix

### 3.1 R&D expenditure and its accounting treatment

| ID | Item | Why Q2 needs it | Who supplies it | Class | Lead | Engineering can close? |
|---|---|---|---|---|---|---|
| **Q2-01** | Period-wise R&D expenditure statement covering the development window (see Q2-14 for the window this repository can prove) | Q2 is titled "R&D intensity & capital". Intensity is a ratio of R&D spend to total spend or revenue. Without a spend figure there is no ratio and therefore no Q2 answer at all | Operator prepares the underlying ledger; **chartered accountant** derives and states the R&D figure | **H2** | L3 | **NO** |
| **Q2-02** | Chartered-accountant certificate of R&D expenditure | Baseline line 792 names "CA certification" explicitly as ABSENT. A self-declared spend figure is not evidence of spend; a certified one is | **Chartered accountant** (retained, with UDIN) | **H2** | L3 | **NO** |
| **Q2-03** | Capitalised vs expensed R&D split, with the accounting policy applied and the basis for each classification | Determines whether the R&D appears as an intangible asset or as P&L expense. A reviewer reading a capitalisation claim will ask which standard was applied and to which cost pools | **Chartered accountant** (policy and treatment); operator supplies the cost pools | **H2** | L3 | **NO** |
| **Q2-04** | Payroll records for the development window — salary registers, payslips, PF/ESI/TDS filings where applicable | Named ABSENT at line 792. Personnel cost is normally the dominant component of software R&D spend; it is the bridge between "effort" (Q2-14, which this repository proves) and "expenditure" (Q2-01, which it cannot) | Operator supplies registers; **chartered accountant** reconciles to the filings | **H1** then **H2** | L3 | **NO** |
| **Q2-10b** | Model / API spend **actuals**: OpenAI billing statements and paid invoices for the development window | Baseline line 791 rates this **PARTIAL** precisely because the repository has `usageLedgerService` / `pricingService` — *tracking code*, not amounts paid. A metering implementation is not a receipt | **Vendor** (OpenAI billing portal); operator downloads; bank or card statement corroborates | **H3** | L2 | **NO** — the tracking code already exists and adds nothing further |

### 3.2 Personnel, qualifications and R&D time allocation

| ID | Item | Why Q2 needs it | Who supplies it | Class | Lead | Engineering can close? |
|---|---|---|---|---|---|---|
| **Q2-05** | Personnel roster for the development window: each individual, engagement type (employee / contractor / consultant / founder), start and end dates | Named ABSENT at line 792 ("personnel"). Q2 asks who performed the R&D. This repository can enumerate **git identities** (3, see Q2-14) but an identity is a commit-signing string, not a person, and the mapping from identity to person is an operator declaration | Operator | **H1** | L1 | **NO** |
| **Q2-06** | Qualifications of each person on the roster: degrees, certifications, relevant experience | Named ABSENT at line 792 ("qualifications"). Establishes that the effort was *R&D-capable* effort | Operator collects; each individual supplies their own documents | **H1** | L1 | **NO** |
| **Q2-07** | R&D time-allocation record: for each person and each period, the proportion of time spent on qualifying R&D vs non-R&D (support, sales, admin, routine maintenance) | Named ABSENT at line 792 ("time allocation"). This is the single item that makes Q2-01 computable from Q2-04, and it is the item most often challenged, because a 100% R&D allocation for a founder who also runs the business is not credible on its face | Operator authors the record; **chartered accountant** reviews it before it supports Q2-01 | **H1** then **H2** | L3 | **NO** — and note that commit timestamps are *not* a time-allocation record; see §4 |
| **Q2-08** | Employment / contractor / consultant contracts and any assignment-of-work or IP-assignment instruments for every person on the Q2-05 roster | Q2 needs the cost to be contractually attributable. Q3 and copyright separately need the chain of rights. Baseline §13.2 records that the copyright basis is BLOCKED pending an authorship determination (line 777) — contracts are one input to that, but they do not resolve it; see `BG05_AUTHORSHIP_POSITION.md` | Operator holds; **counsel** reviews sufficiency | **H1** then **H2** | L3 | **NO** |

### 3.3 Infrastructure, tooling and third-party spend

| ID | Item | Why Q2 needs it | Who supplies it | Class | Lead | Engineering can close? |
|---|---|---|---|---|---|---|
| **Q2-09** | Infrastructure and tooling invoices for the development window, per vendor, with proof of payment | Named ABSENT at line 792 ("infrastructure invoices"). This is the non-personnel half of R&D spend | **Vendors**; operator downloads from each billing portal; bank or card statements corroborate | **H3** | L2 | **NO** |
| **Q2-09a** | The vendor list the invoices must cover | *This sub-item is H0 and is already answered.* Baseline §14 Q6 (lines 812–817) and the dependency manifest name the external services; `Q2_REPOSITORY_RECOVERABLE.md` §6 reproduces the manifest at `af2fb6e9`: **52 production dependencies, 18 dev dependencies, `openai` the sole AI/ML dependency**, and the external services Supabase, Railway, Vercel, Upstash | Repository (engineering) | **H0** | — | Yes — done |

### 3.4 Capital: grants, investment, statutory record

| ID | Item | Why Q2 needs it | Who supplies it | Class | Lead | Engineering can close? |
|---|---|---|---|---|---|---|
| **Q2-11** | Grant, AIF or investment capital records: sanction or award letters, term sheets, share subscription agreements, bank credit advices evidencing receipt | Named ABSENT at line 792 ("grants/AIF"). Q2 is "R&D intensity **and capital**" — the capital half is a wholly separate evidentiary question from the spend half, and is entirely external | **Investor / grant authority** issues; **bank** evidences receipt; operator holds the file | **H3** | L4 | **NO** |
| **Q2-12** | Statutory filings for the relevant years: audited financial statements, income-tax returns, GST returns where applicable, and MCA/ROC annual filings | An uncertified internal spend figure that cannot be tied to a filed statement is worth very little under adversarial review. The filings are what make Q2-01 and Q2-02 checkable by a third party | **Chartered accountant** / **company secretary** prepare and file; the **registry** is the authoritative copy | **H2** + **H3** | L4 | **NO** |
| **Q2-13** | Board and shareholder records: board resolutions authorising the R&D programme and its budget, minutes recording the technical deliberation, shareholding pattern and cap table, statutory registers | Named ABSENT at line 792 ("board records"). Establishes that the R&D was an authorised, governed activity rather than reconstructed after the fact — which is the specific suspicion an ABSENT Q2 invites | **Company secretary** maintains; operator and board author the substance | **H2** | L3 | **NO** |

### 3.5 The two items the repository does answer

| ID | Item | Status | Class | Engineering can close? |
|---|---|---|---|---|
| **Q2-14** | Development period, volume and cadence | **RECOVERED at `af2fb6e9`** — see `Q2_REPOSITORY_RECOVERABLE.md` §3–§5. Baseline line 789 recorded this `PROVEN` at SHA `82754497`; the figures at `af2fb6e9` are materially larger and are restated there rather than carried over | **H0** | Yes — done |
| **Q2-15** | Architecture / design deliberation record | Baseline line 790 records `SUPPORTED` on the basis of `docs/pmo/` and `docs/company-intelligence/`. The tracked-file inventory at `af2fb6e9` is in `Q2_REPOSITORY_RECOVERABLE.md` §5 (`docs/` — 900 tracked files, 7,821,038 bytes). **This is a record of *engineering* deliberation, authored in the repository. It is not board deliberation (Q2-13) and must never be offered as a substitute for it** | **H0** | Yes — done |

---

## 4. The boundary, stated once and without hedging

**Repository activity is evidence of development effort. It is not evidence of R&D expenditure,
and it is not evidence of capitalisation.**

A commit proves that a change was written and when it was recorded. It does not prove that anyone
was paid, how much, by whom, under what contract, against which cost centre, or how that cost was
treated in the books. Only a chartered accountant working from payroll, invoices and the time
allocation of Q2-07 can map effort to cost, and only a filed and certified statement makes that
mapping checkable.

Three specific misuses to refuse in advance:

1. **Commit timestamps are not timesheets.** A commit at 03:42 does not evidence a paid hour, and
   the count of commits in a month does not evidence the proportion of a person's time. Q2-07 is an
   operator declaration reviewed by a CA; it is not a derivation from git.
2. **Git identities are not personnel.** `Q2_REPOSITORY_RECOVERABLE.md` §4 enumerates 3 author
   identities over 2 email addresses at `af2fb6e9`. That is a fact about commit metadata. The number
   of *people*, their engagement type and their qualifications are Q2-05/Q2-06 and are H1.
3. **Metering code is not a receipt.** `usageLedgerService` and `pricingService` (baseline line 791)
   are the reason Q2 model/API spend is `PARTIAL` rather than `SUPPORTED`. The remedy is the vendor
   statement (Q2-10b), not more instrumentation.

---

## 5. Request wording the operator can forward verbatim

Each block below is drafted to be forwarded as-is. **No figure, date, name or professional opinion
is pre-filled**; every `<...>` is a value only the operator or the professional can supply. Sending a
request that already contains a number would defeat the purpose of asking.

### 5.1 To the chartered accountant — Q2-01, Q2-02, Q2-03, Q2-04, Q2-07

> Subject: Request for a certified R&D expenditure statement — DPIIT evidence
>
> We are assembling evidence for the R&D intensity and capital question (Q2) of a DPIIT DeepTech
> assessment for `<entity legal name>`, `<CIN / registration number>`.
>
> We are asking you to prepare and certify, for the financial periods `<periods>`:
>
> 1. A period-wise statement of research and development expenditure, with the cost pools you
>    included and the basis on which each was included.
> 2. The split between capitalised and expensed R&D, the accounting policy and standard you applied,
>    and your basis for each classification.
> 3. A reconciliation of that statement to our filed financial statements and returns for the same
>    periods.
> 4. Your certificate of the R&D expenditure figure, with UDIN.
>
> We will supply: payroll registers and statutory payroll filings; vendor invoices and proof of
> payment for infrastructure, tooling and model/API usage; contracts for all engaged personnel; and
> a time-allocation record stating, per person and per period, the proportion of time spent on
> qualifying R&D.
>
> Two things we specifically need your view on, rather than our own:
>
> - whether our time-allocation record is adequate as prepared, or needs to be reconstructed on a
>   different basis before it can support a certificate; and
> - whether any of our cost pools should **not** be treated as R&D.
>
> Please tell us what else you require and your expected turnaround. **We would rather receive a
> smaller certified figure than a larger uncertified one**, so please do not accommodate any
> expectation on our side.

### 5.2 To the company secretary — Q2-12, Q2-13

> Subject: Request for board, shareholder and statutory filing records — DPIIT evidence
>
> For a DPIIT DeepTech assessment of `<entity legal name>`, `<CIN>`, covering `<periods>`, we need
> certified or attested copies of:
>
> 1. Board resolutions authorising the research and development programme and its budget, and the
>    minutes recording the technical deliberation behind it.
> 2. The shareholding pattern and cap table as at `<date>`, and any changes during the period.
> 3. Statutory registers as maintained.
> 4. MCA/ROC annual filings for the period, with filing acknowledgements.
>
> If any resolution authorising the R&D programme was **not** passed at the time, please tell us
> plainly. We will record the gap. Please do not pass a resolution now and date it earlier, and
> please do not prepare minutes for a meeting that did not take place — a reconstructed record is
> worse than an acknowledged absence, and we will treat any such suggestion as a reason to change
> advisers.

### 5.3 To counsel — Q2-08, and the separate BG-05 question

> Subject: Request for review — personnel and IP instruments, and an AI-assisted-development
> authorship position
>
> Two separate matters for `<entity legal name>`.
>
> **First**, please review the employment, contractor and consultant contracts and any
> assignment-of-work or IP-assignment instruments for the individuals listed in the attached roster,
> covering `<periods>`, and tell us whether the chain of rights in the software is complete, and
> where it is not.
>
> **Second**, and please treat this as the more consequential of the two: a substantial proportion of
> the commits in our repository carry a co-authorship trailer naming an AI coding assistant. The
> measured figures at a fixed commit are in the attached `BG05_AUTHORSHIP_POSITION.md`, which is a
> factual git-history report and deliberately states no legal conclusion. We need your opinion on
> what we may and may not state about authorship and copyright subsistence in any DPIIT filing or
> external material. We are **not** asking you to confirm a position we have already taken; we have
> not taken one, and we have instructed our own team not to.

### 5.4 To vendors, or operator self-service — Q2-09, Q2-10b

> For each of `<vendor list — see Q2-09a>`, download from the billing portal, for `<periods>`: every
> invoice, the payment receipt or statement line evidencing payment, and the account or organisation
> identifier the invoices are issued against. Keep them unedited and in the vendor's own format.
> Where a vendor's portal does not retain the full period, request the missing invoices from the
> vendor in writing and keep the request and reply. Do **not** retype any amount into a summary
> spreadsheet as a substitute for the invoice.

### 5.5 To the bank, investors or grant authority — Q2-11

> Subject: Request for records evidencing capital received
>
> For `<entity legal name>`, `<account / facility reference>`, covering `<periods>`, we require:
> bank statements for all operating accounts; credit advices for each capital receipt; and, from
> each investor or grant authority, a copy of the sanction or award letter, term sheet and executed
> subscription or grant agreement as the case may be.

---

## 6. What this document explicitly does not do

- It states **no financial figure**. Every Q2 amount is `NOT AVAILABLE IN REPOSITORY — operator and
  chartered accountant supply it`.
- It states **no date, period or lead-time duration**. Every one is `NOT AVAILABLE IN REPOSITORY —
  operator to confirm`.
- It identifies **no person**. Git identities are commit metadata and are not personnel (§4.2).
- It offers **no accounting, secretarial or legal opinion**, and it does not pre-empt one. Where a
  professional's view is needed, the request asks for that view rather than proposing one.
- It asserts **no patentability and no authorship**, consistent with baseline §13.2 (no
  patentability assertion may be made until a qualified practitioner completes a prior-art review)
  and BG-05.

---

## 7. Sequencing note

Baseline §18 (line 926) instructs that BG-04 be started immediately and in parallel with all
technical work, on the ground that it has the longest external lead time. Within BG-04 the internal
ordering is forced by dependency, not by preference:

1. **Q2-05, Q2-06, Q2-08** (H1, L1) — the roster, the qualifications and the contracts. Nothing
   downstream can be prepared without knowing who to prepare it for.
2. **Q2-09, Q2-10b** (H3, L2) — vendor invoices. Independent of everything else; start in parallel.
3. **Q2-07** (H1 then H2, L3) — the time-allocation record. Requires the roster; gates Q2-01.
4. **Q2-04** (H1 then H2, L3) — payroll. Requires the roster.
5. **Q2-01, Q2-02, Q2-03** (H2, L3) — the CA engagement. Requires 1–4 in hand.
6. **Q2-13** (H2, L3) and **Q2-12** (H2+H3, L4) — secretarial and statutory. Q2-12 depends on Q2-01/02.
7. **Q2-11** (H3, L4) — capital records. Independent; longest turnaround outside the entity's control.

**Q2-14 and Q2-15 are complete and are not on the critical path.** They were the cheapest items and
they are the only ones engineering could touch. Their completion moves DPIIT readiness by nothing,
because the binding constraint is the other fifteen rows.

---

*Artefact class: PREPARATION + HUMAN-REQUIRED INPUT. Not DeepTech evidence. Not Q2 evidence.
No commit, PR, product-code change, network call, database access or credential read was involved
in producing this document. No financial figure, date, identity, professional opinion or legal
conclusion is asserted anywhere in it.*
