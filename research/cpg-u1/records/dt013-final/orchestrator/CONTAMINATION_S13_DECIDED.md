# §13 decided — the protocol does NOT specify a carrier, and "lawful" was not the test

Verified by me against the frozen protocol `c50fc680…b719`. Nothing changed; the protocol was read only.

## The textual basis, isolated precisely

The late-discovered-contamination rule is `CPG_U1_PROTOCOL_004.md:248`. Measured on **that line alone**:

```
line 248  →  NONE — no [NORMATIVE], no [enforced], no (enforced: …)
line 247  →  (enforced: CLI refusal before commitment; VOID at chain verification)
```

Line 247 is its **immediate neighbour in the same bullet list**. The surrounding list also carries
`[NORMATIVE; APPROVED CPG-043]`, `[enforced]`, and `[NORMATIVE, append-only, entries never removed]`.

So **the protocol tags what it enforces, and this rule is deliberately untagged.** Line 248 specifies
content (company, basis, date, discoverer), acts ("recorded … and published"), a flag
(`CONTAMINATION-DISCLOSED`) and prohibitions (never excluded, never changes the §10.5 outcome) — and names
**no artefact, no channel, no publisher and no timestamp authority.** §13.2 and §13.2A list no
contamination-disclosure record.

*(Method note on my own check: my first measurement spanned lines 247–248 and returned a tag — from line
247. Isolating 248 was necessary. This is the same range-off-by-one imprecision I have been correcting in
others this wave, and it nearly produced the opposite conclusion.)*

## Wave 012's reading is upheld; wave 011's is refuted; and both were short of the actual test

**Wave 011 was wrong** that §13.2/§13.2A *exclude* a carrier. §13.2A is headed *"Sampling archive
(**mandatory**)"* — floor-language — and neither list carries exhaustiveness wording, unlike §10.5's
*"exactly one"*, §5.10's mutually-exclusive state table, or §15.1's dispositions. Prohibition-by-absence
holds only for a vocabulary that is exhaustive **and selective**, where an outside value displaces an inside
one. A published addendum displaces nothing. §15.1 confirms it internally: `CONTAMINATION-DISCLOSED` is
introduced as *"and the flag"*, explicitly non-selective, with the observation *"remains VALID in the
primary analysis"*.

**But I relayed wave 012 too strongly.** I told the owner the carrier was "answerable from the protocol".
That conflated two different things, and §13's wording is precise about which one it asks for:

> §13: *"determine whether the existing §5.3 disclosure mechanism **already specifies** a carrier."*

Wave 012's "carrier C" established that a published record is **lawful**. Lawfulness is **permission**, not
**specification**. §13's first branch requires the protocol to *specify* the carrier so a minimum mechanical
one can be implemented; it does not. **So §13's second branch fires.**

## The determination

**No carrier invented. None implemented.** Recorded exactly as §13 requires:

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE METHODOLOGICAL DECISION
```

**This is not "nothing to do".** The §5.3 **duty** to record and publish stands unchanged; only the carrier
is unspecified. And the flag remains dead in all three senses, independently re-verified and **not fixed**:
`contamination_disclosed` (`lib/analysis.mjs:159`) is structurally always false because `lib/select.mjs:93`
filters `ineligible` out of the held-out pool; there is exactly one grep hit (the write, no reader); and the
literal `CONTAMINATION-DISCLOSED` appears in **zero** of the instrument's files.

**Aggregate impact: none.** The determination is documentary and lives outside the instrument tree.

## A reusable gotcha worth keeping

`git check-ignore -v` **prints negation matches too**, so a line beginning `!` in its output means the file
is **NOT** ignored. The form without `-v` is the authoritative test. Anyone verifying the §10 negation with
`-v` alone would read a working negation as a failure — the same class of silently-inverted measurement as
`grep` exiting 1 on no match.
