# DR-11 — protocol-determined by entailment, and one cited support does not hold

Stream A's conclusion is **sound and I accept it**. But I checked its citations and one is misapplied, so
the *basis* must be recorded accurately or the registration narrative would carry an overclaim.

## What holds up — and it is enough

**1. §5.7.2 `:383` / `:389` — the load-bearing clause. Directly on point and tagged.**

```
:383  #### 5.7.2 Frame sufficiency [NORMATIVE; DERIVED; APPROVED CPG-043]
:389  - `E_c` is determined by §5.1–§5.4, using the scan committed in the development payload
        and the registered registry.
```

The protocol asserts `E_c` **is determined** by the committed scan. A `scan.results` carrying two entries
for one `candidate_id` supplies **two answers**, so the quantity the protocol declares determinate becomes
indeterminate. That is the entailment, and it is the whole verdict.

**2. `:390-391` — the enforcement points are exactly the defective commands.**

```
:390  ... (enforced: `check-frame-sufficiency`, `commitment-payload`)
:391  ... STAGE_VOID_FRAME_INSUFFICIENT ... (enforced at `draw-development`)
```

Three of the four commands that inherit `contamination()` are named as enforcement points of the very
clause the collapse defeats.

**3. `:414` — the consequence is an unconditionally forbidden state.** *"Ineligible admissible companies
not drawn are `DEVELOPMENT_SURPLUS` and **never enter held-out**."* The collapse puts a contaminated
company into the held-out pool — precisely what this forbids.

**4. `:380` — the protocol's posture on duplicates.** *"**Uniqueness** [enforced]: one row per legal
entity. Duplicate identifiers or duplicate canonical domains are refused."* This governs **frame rows**,
not scan results, so it is context rather than mandate — but it shows the protocol refuses duplicates
rather than resolving them.

**5. The strongest corroboration is inside the instrument.** `lib/evaluation.mjs:5-8` already states the
identical rule for the sibling artefact — *"a **duplicate** … is REFUSED. **A company cannot be dropped
silently.**"* — enforced at `:144`: `ARCHIVE_REFUSED ${id}: duplicate record`. So silent duplicate-collapse
is **already treated as unacceptable** in this codebase. `scan.results` is the one artefact where the
settled reading was never applied.

## What does NOT hold up — my correction

Stream A listed as governing text:

> **`:791`** (§12.3, `[NORMATIVE; APPROVED CPG-045]`) — *"refused … it is never silently dropped or
> repaired."* → **forecloses both alternatives** (first-wins, union).

**`:791` is §12.3 "Cited source URLs".** I read it: it governs *"a `sourceUrl` that is present but is not
an https URL"* in a **final evidence record**. The phrase "never silently dropped or repaired" is about
**malformed URLs**, not duplicate scan entries.

Applying it to `scan.results` is an **analogy**, not a mandate. It is a good analogy — it shows the
protocol's disposition toward malformed input is refusal rather than repair — but presenting it as text
that "forecloses" the alternatives overstates it. **Removed from the basis.**

## The honest verdict

**DR-11 is protocol-determined by entailment from §5.7.2, not by an explicit sentence.** The protocol
nowhere says "exactly one result per frame row"; it says `E_c` is determined by the scan, and a duplicate
makes that false. Stream A flagged this itself in its Risk 1, correctly.

**This does not change what to do, and that is the point.** Both readings — protocol compliance or owner
decision — lead to the same action: refuse the duplicate. And the direction is strictly conservative:

- a **refusal** can only reject input that the protocol already calls malformed; §5.4 notes the scan is
  conservative, so refusing excludes no legitimate frame;
- the **collapse** can put a contaminated company into held-out, which `:414` forbids outright.

The asymmetry is total. There is no reading on which the collapse is safer.

## How it must be recorded

Not as "the protocol mandates a duplicate check" — it does not say that. As:

> **DR-11 is an instrument defect in the implementation of §5.7.2's determinacy requirement, closed before
> registration by refusing malformed scan input. It is not a protocol amendment and not a rule change.**

That is the same form the owner already accepted for DR-10 (`DECISION_DISCLOSURES.md:277-280`: *"It is a
defect in the instrument's implementation of CPG-C1(1)/CPG-C1(6) contamination scanning, not a rule
change."*) — cited as the owner's characterisation of the **class**, not as a ruling on DR-11.

**Disclosure is still owed** in the decision log and OSF narrative, in DR-10's form.

## What DR-11 does NOT close — must not be overstated

A **replacing** edit (rather than an appended duplicate) remains uncaught, because `scan_sha256` is
`fileSha(scanPath)` — the hash of the *edited* file. That is the pre-existing §22/§23 posture, defended
only by an outsider re-running `scan`. **DR-11 must never be described as closing it.**

Stream A raised a genuine follow-on worth someone's attention: whether §21 step 9 obliges the outsider to
**re-run** the scanner or merely **re-use** the archived scan. If the latter, the residual hole is wider
than the attack matrix implies. Recorded, not resolved.

## Sequencing decision

The fix touches **three files** — `cpg_u1_data.mjs` (the guard, ~8-12 lines), `test/selftest.mjs`
(fixtures + assertions), `test/mutate.mjs` (M468–M471 into the reserved block at `:524-526`) — and
**moves the aggregate**.

Two streams are currently working against `b9250356…`. Applying DR-11 now would invalidate their
measurements mid-flight. **It lands after they complete, as the final change, followed by one
re-derivation** — which is exactly the "produce the final candidate once" requirement.
