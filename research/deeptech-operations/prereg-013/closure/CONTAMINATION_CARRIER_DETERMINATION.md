# §13 — CONTAMINATION-DISCLOSURE CARRIER: DETERMINATION ON THE PROTOCOL TEXT

DEEPTECH-PARALLEL-013, closure stream. Decided by reading `CPG_U1_PROTOCOL_004.md`
(`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`, hash re-verified, **unchanged**).
**No protocol byte changed. No carrier was invented. No instrument code changed.**

> **SNAPSHOT NOTE.** `C:/tmp/dt013-candidate/tooling` was being edited live by another
> DEEPTECH-PARALLEL-013 stream during this session (`lib/identity.mjs` created 04:50, then
> `lib/registration.mjs`, `lib/harness.mjs`, `cpg_u1_data.mjs`, `test/mutate.mjs`, `test/selftest.mjs` up to
> 05:06). **Every file cited in this document was re-checked at 05:11 and none of them was touched by that
> stream**, so all line numbers here are stable. The tree's file count moved from 108 non-`node_modules` /
> 594 total (04:47) to 109 / 595 (05:11); where a count appears below it is the 04:47 measurement, and the
> conclusions do not depend on it. See `TOOL_VERSION_IDENTITY_MAP.md` for the full drift record.


---

## 1. THE QUESTION, PUT PRECISELY

§13 asks one question with two branches:

- **Does §5.3's disclosure mechanism already SPECIFY a carrier?** If yes -> implement the minimum
  mechanical carrier.
- **If no** -> do not invent one, and record the sentence.

The question is **not** "is a published record lawful?" A protocol can *require an act* and *permit any
vehicle for it* without *specifying the vehicle*. Only specification licenses implementation. Conflating
the two is how an unmandated artefact gets built and then cited as protocol-required.

## 2. THE AUTHORITATIVE TEXT

### §5.3, the disclosure mechanism (`CPG_U1_PROTOCOL_004.md:247`, final bullet of "frozen at registration")

> **Late-discovered contamination:** a contamination discovered after registration is recorded (company,
> basis, date, discoverer) and published. The company is **never excluded, removed or replaced**, whether
> for later CPG performance, for any outcome, or at all (§5.9, §15.2). Its observations are flagged
> `CONTAMINATION-DISCLOSED`. A pre-specified secondary analysis excluding flagged observations may be
> reported and **never changes the §10.5 outcome**.

What this sentence **does** specify, exhaustively:

| Specified | Value |
|---|---|
| the **content** | four fields: company, basis, date, discoverer |
| the **acts** | "recorded ... and published" |
| the **flag** | `CONTAMINATION-DISCLOSED` on that company's observations |
| the **prohibitions** | never excluded, removed or replaced; never changes the §10.5 outcome |
| the **permitted secondary analysis** | pre-specified, excluding flagged observations, reportable |

What this sentence **does not** specify:

- No artefact is named. No filename, no schema identifier, no field name, no JSON shape.
- No registry, publisher, channel or timestamp authority is named.
- No `[enforced]` tag and no `[NORMATIVE]` tag. **This is discriminating**: the very same bullet list in
  §5.3 carries `[NORMATIVE; APPROVED CPG-043]` on the freeze itself, `[enforced]` on the
  `unknown`-equals-`yes` rule, `[NORMATIVE, append-only, entries never removed]` on the registry, and
  "(enforced: CLI refusal before commitment; VOID at chain verification)" on the no-changes-after-
  registration rule. The author tags what is mechanised. **The late-contamination bullet is untagged.**
- No enforcement point exists for it. §5.3's other rules each name theirs; this one names none.

### §13.2 (`:809-811`) — "Hashed and published"

> Dataset seal (binding both manifests, both screening logs, sizing, the three blind-record files and the
> reconciled reference file) · archive Merkle root · CPG response set · protocol document · resolver SHA ·
> provider configuration hash · development-only registry · rater instructions · rater order artifacts
> (§12.1) and the person-to-label assignment fingerprint (§4A.3) · per-rater sheets · adjudication
> artifacts · exclusion table · results artifact. The registration record, both commitment payloads and
> both sampling records (from which both seeds are recomputable) are published.

### §13.2A (`:813-815`) — "Sampling archive (mandatory)"

> Registration record and the identity's registration listing; protocol and tooling files; the single
> frame F; the scan; development-only registry; pilot result; sizing; both payloads; both funding and
> commitment raw transactions with Merkle proofs; header ranges from a retarget boundary <= checkpoint to
> `H_rand_ho + 6` from two sources; drand chain info and rounds `R_dev`, `R_ho`; manifests; screening
> logs; both sampling records; the execution authorisation, execution log, audit output, no-preview
> declaration and stored-lookup exports (§6.5); reference and rating adjudication packets (§9.2.1, §12.2).

### §15.1 (`:834-836`) — "Observation dispositions"

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and
> `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (observation remains VALID in the primary
> analysis; §5.3). `INCONCLUSIVE` is **run-level only**.

## 3. WHICH PRIOR READING THE TEXT SUPPORTS

Two prior findings are in tension:

- **Wave 011:** §13.2 / §13.2A are *closed* lists that exclude a carrier -> every candidate carrier is
  prohibited.
- **Wave 012:** reversed this — the lists are floors, not ceilings; absence means *not mandated*, not
  *prohibited*.

> **The text supports WAVE 012. Wave 011's reading is refuted.** Three reasons, on the words:
>
> 1. **§13.2A's own heading is floor-language: "Sampling archive (mandatory)".** "Mandatory" states that
>    the listed items *must be present*. It says nothing about items not listed. A minimum is not a
>    maximum.
> 2. **Neither list carries any exhaustiveness wording.** Compare the sections that do: §10.5 is headed
>    **"Outcome vocabulary — exactly one"**; §5.10 is a state table where each row's Consequence
>    (Wait / Study VOID / Disclosed) is mutually exclusive; §15.1's *dispositions* attach one value per
>    observation. §13.2 and §13.2A contain no "exactly", no "only", no "and nothing else", no "complete".
>    They are enumerated **duty lists** — the grammar is "these are hashed and published", not "these and
>    no others may be".
> 3. **Prohibition-by-absence is valid only for a vocabulary that is exhaustive *and* selective** — one
>    where adding a value outside the list would *displace* a value inside it. §10.5 qualifies: exactly
>    one outcome, so a sixth outcome unseats one of the four. §5.10 qualifies. §15.1's dispositions
>    qualify. **A published record added to an archive displaces nothing.** Nothing in §13.2A becomes
>    unarchived because one more document is archived beside it.
>
> §15.1 supplies the decisive internal confirmation of the discriminator: `CONTAMINATION-DISCLOSED` is
> introduced there as **"and the flag"** — grammatically set apart from the dispositions — and the
> parenthesis says the observation **"remains VALID in the primary analysis"**. The flag is explicitly
> *non-selective*: it sits alongside a disposition rather than replacing one. Even inside a selective
> vocabulary, the contamination marker is the one member that displaces nothing.

**So: a published contamination-disclosure record is LAWFUL.** No protocol provision prohibits it.

## 4. THE ANSWER TO §13

**That lawfulness is not specification.** §13 asks whether the protocol *specifies* a carrier.

- §5.3 requires that the contamination be "recorded ... and published" and fixes the four content fields.
  It **names no artefact, no channel, no publisher, no timestamp authority, and carries no `[enforced]`
  or `[NORMATIVE]` tag.**
- §13.2 lists what is hashed and published. **No contamination-disclosure record appears in it.**
- §13.2A lists the mandatory sampling archive. **No contamination-disclosure record appears in it.**
- No other provision supplies one: the flag `CONTAMINATION-DISCLOSED` names a *disposition marker*, not a
  document, and §15.2's table routes the *other* post-draw findings (`identity_inadmissible` -> `INVALID`;
  `protocol_violations` -> `INCONCLUSIVE`), neither of which is this.

> ## DETERMINATION
>
> **THE PROTOCOL DOES NOT SPECIFY A CARRIER. It requires the act of publication and leaves the vehicle
> unbound. Therefore §13's SECOND BRANCH applies: no carrier is invented and none is implemented here.**

**Why this is the right reading and not evasion.** The protocol is dense with specified carriers where it
wants them — the dataset seal, the screening log, the rater sheet, the execution log, the no-preview
declaration, the adjudication packets, the sampling records are each named, and most are hash-bound and
enforced. §5.3's contamination bullet conspicuously names none of those things while sitting three lines
below a rule the author bothered to tag "(enforced: CLI refusal before commitment; VOID at chain
verification)". An author who wanted a mechanical carrier here would have named one, as he did eight times
elsewhere. **The silence is deliberate, and it is a silence about the vehicle — not about the duty.**

This also disposes of the residual honestly: a *permission* makes a disclosure, once made, publishable and
citable. It does **not** make the *absence* of a disclosure falsifiable, because there is no artefact whose
non-existence an outsider can detect. Closing that would require a pre-registered attestation field inside
the instrument — which moves the aggregate and is **pre-registration only**. That is a methodological
choice, not a reading of the text, which is exactly why it is the owner's.

### RECORDED SENTENCE

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE METHODOLOGICAL DECISION
```

(Wave 012 recorded the variant `CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION`.
The two are the same finding; the sentence above is the form §13 prescribes and is the one that governs.)

## 5. THE §15.1 FLAG IS DEAD IN THREE SENSES — RE-VERIFIED, NOT FIXED

Re-measured independently against `C:/tmp/dt013-candidate/tooling`. All three senses stand. **Nothing was
changed; no fix is proposed here.**

**Sense 1 — structurally always false.** The only write is:

```
lib/analysis.mjs:159:  contamination_disclosed: (heldOut.get(it.candidate_id)?.held_out_ineligible_basis ?? []).length > 0,
```

It reads `held_out_ineligible_basis` off the held-out row. But the held-out pool is built by:

```
lib/select.mjs:93:  const pool = admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id));
```

`ineligible` companies are filtered **out** of the pool before the draw. Every company that reaches
`heldOut` therefore has an empty `held_out_ineligible_basis`, so `.length > 0` is **false for every row, by
construction**. The field can never be true in any run.

**Sense 2 — never read.** `grep -rn "contamination_disclosed"` over the tree returns **exactly one line** —
`lib/analysis.mjs:159`, the write above. No consumer, no assertion, no report column, no gate.

**Sense 3 — the literal is absent.** `grep -rn "CONTAMINATION-DISCLOSED"` (and `CONTAMINATION_DISCLOSED`)
over **all 594 files** of the tree, `node_modules` included, returns **zero lines**. The protocol's flag
name exists nowhere in the instrument.

> Net: §15.1 declares a flag; the instrument writes a differently named boolean that is unconditionally
> false and is never consulted. **A verifier can neither set the flag nor observe it.** That is the
> semantic gap the recorded sentence refers to.

## 6. AGGREGATE EFFECT

> **Does §13 move the aggregate? NO.**

Nothing inside `research/cpg-u1/tooling` was opened for writing — the three greps above are reads.
`toolingManifest` (`lib/aggregate.mjs:8-23`) hashes only files beneath the tooling tree, and this document
is at `research/deeptech-operations/prereg-013/closure/`. `CPG_U1_PROTOCOL_004.md` is byte-unchanged (hash
re-verified). **Mutation-count effect: none** — no mutant anchor text changes, so the live 404-mutant run
is unaffected. Had the first branch applied, a mechanical carrier would have moved both; recording the
sentence moves neither, which is a further reason to get the branch right rather than build first.
