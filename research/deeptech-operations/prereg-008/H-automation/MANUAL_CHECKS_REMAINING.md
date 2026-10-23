# Manual checks remaining — what stays human because nothing can mechanise it

**DEEPTECH-PARALLEL-008 / stream H (personnel automation).**
**CLASSIFICATION: PROPOSAL / ENGINEERING ARTIFACT.** Not U1 evidence, not a registered artefact. No frozen
byte changed. Companion to `PERSONNEL_AUTOMATION_AUDIT.md`, which covers what *is* mechanical.

This is not a list of things nobody got round to automating. Each item below was checked against the frozen
instrument (`C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files) and the protocol
(`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`), and each is **irreducible**: the fact it
asserts is not present in any artefact the study holds, so no tool — frozen, proposed or future — can decide it.

A recurring shape is worth naming up front, because it accounts for four of the six items:

> **The value is checkable; the timing is not.** A hash can be recomputed by anyone, forever. *When* it was
> first known, published or chosen leaves no trace inside the artefact itself. Ordering claims rest on an
> external publication record, i.e. on a human reading a timestamp someone else controls.

---

## M1. Whether any declaration is true

**The check.** §4A.1 requires, per person, "a signed declaration answering items 1–4 and 6 and §4A.2(a)–(b)
with 'no'". Whether those answers are *true* — not whether a `"no"` was written.

**Why it is irreducible.** The instrument says so in its own header, `lib/personnel.mjs:1-3`:

> Personnel register checks (CPG_U1_PROTOCOL_004 §4A). The register itself is restricted; the tooling checks its
> **STRUCTURE** … **It cannot verify that declarations are true.**

§4A.3 repeats it for the CLI ("`check-personnel` verifies structure … It cannot verify that declarations are
true"), and the protocol publishes it as limitation **§20.23**: "Personnel independence rests on declarations
and organisational confirmation (§4A.1), not on verifiable proof. The tooling checks the register's structure
only." §4A.1 itself calls the whole apparatus "**procedural evidence, not proof**".

**What is mechanical, so the boundary is clear.** `lib/personnel.mjs:37` enforces that each answer is exactly
`"no"` (so §4A.1's "An unknown answer is not 'no'" holds mechanically); `:38` that the fee-agreement hash is 64
hex or `null`; `:39` that the organisation's confirmation hash is present. My
`checkDeclarationCurrency` adds that each declaration was signed against the **current** roster. **None of that
touches truth.** A declaration can be current, well-formed, hashed, confirmed — and false.

**Who must do it.** Nobody can, and the protocol does not pretend otherwise: §4A.1 specifies what happens
*afterwards* if a declaration "is later found false" (rater work → §12 UNADJUDICATED; enumerator work → the
frame is not independent, §20.18; reference work → the reference truth is not independent). **The control is
consequential, not preventive.** The human obligation is to collect the signature and to publish the finding if
falsity emerges — not to verify.

## M2. Whether the development-only registry is complete

**The check.** §5.3 seeds the development-only registry with 13 named entries from the implementers' own CPG
history, and then says, in the protocol's own emphasis:

> **The seed's completeness is not attested** (§19.2, H2).

**Why it is irreducible.** Completeness is a claim about the **absence** of a 14th company — a company someone
ran CPG against and did not record. No artefact can witness an absence of this kind. A scanner over the
repository at the frozen resolver SHA finds *textual* traces (C1(1), `cmdScan`); it cannot find a run that left
no trace in the repository, e.g. one performed locally and never committed. The registry is append-only and
"entries never removed", which protects it against later *shrinkage* but says nothing about what was in it at
the start.

**The tension inside §19.2, resolved.** §19.2 records **H2** — "Development-only registry complete to the best
of knowledge" — as **Confirmed** (verbatim in the CPG-037 record). That is not in conflict with §5.3's "not
attested": a *best-knowledge confirmation* is precisely **not** an attestation of completeness. §5.3 points at
H2 to say what exists and what does not. Anyone reading H2's "Confirmed" alone could mistake it for an
assurance of completeness. **It is not one, and the protocol takes care to say so.**

**Why it matters, mechanically.** §5.3 freezes the registry at registration and makes it the *sole* source of
held-out eligibility for both stages ("Eligibility source: held-out eligibility for **both** stages is
determined solely by the registry whose SHA-256 is in the registration"). So an omission at seed time is
*preserved* by the freeze: the freeze prevents later steering (threat 27a) but cannot repair an incomplete seed.
A frozen-at-registration incorrect input stays incorrect for the whole study. This is the single item on this
list whose consequence is locked in at registration and cannot be revisited.

**Who must do it.** The implementers, by recollection, before registration. It rests on the same people whose
history is being recorded — see M6.

## M3. Whether the §4A.3 assignment fingerprint was published *before* the held-out commitment was broadcast

**The check.** §4A.3: the assignment of individuals to `rater-1`, `rater-2` and `rating-adjudicator`

> is recorded in the personnel register, and its SHA-256 fingerprint is published, **before the held-out
> commitment transaction is broadcast** (§12.1).

§12.1's purpose (`lib/assignment.mjs:2-3`): "so no one can choose which person rates in which order after the
order becomes knowable."

**The value is checkable.** `lib/assignment.mjs:45` computes `fingerprint = sha256(canonicalJson(assignment))`,
and `checkRaterAssignment` (`:19`) binds each label to the register, refusing unless "the personnel register
assigns this role to" exactly that person (`:39`). The artefact carries a 256-bit nonce (`:26`) specifically so
that "the published fingerprint cannot be confirmed by guessing a small set of ids" (`:5-6`). Anyone can
recompute the fingerprint and confirm the artefact matches it.

**The timing is not.** The instrument states the limit itself, `lib/assignment.mjs:6-7`:

> The tooling **cannot check WHEN the fingerprint was published** — that is the publication record's timestamp
> (procedural) — only that the artifact matches it.

**Why it is irreducible.** A hash has no internal notion of when it was first known. The ordering claim is
"fingerprint published < commitment broadcast", and only one side of that comparison is self-evidencing: the
commitment broadcast has a Bitcoin block timestamp, but the *publication* side is an external record's
timestamp. A human must compare the publication record against the transaction — and must trust the publication
venue's clock and its inability to be backdated. **Note the asymmetry that makes this worth a human's
attention: everything else in §12.1 is chain-anchored, so this one procedural link is the weakest joint in an
otherwise cryptographic chain.**

**Who must do it.** An outsider following §21, reading the publication listing's timestamp against the
commitment transaction.

## M4. Whether `as_of` was chosen before registration

**The check.** §19.1's registration table, last row:

> | Provider configuration hash; `asOf` | computed / chosen **before registration** |

**Why it is irreducible.** `asOf` is a date. A date in a file is a *value*; it carries no evidence of when it
was written. Nothing distinguishes an `asOf` chosen on principle beforehand from one chosen afterwards to suit
an outcome — the bytes are identical. The registration record fixes *what* `asOf` is, which prevents later
change; it cannot evidence *when* the choice was made relative to any private knowledge.

**Why it matters.** `asOf` is not inert. It is the temporal anchor for reference truth: **§10.2**'s temporal rule makes
reference truth "the most recent authoritative value with `as_of_date` no more than **24 months** before the run
`asOf`", and an older matching value becomes `INCORRECT-FILL / STALE_VALUE`, while no recent value makes the
observation `REFERENCE-STALE` (excluded, published). So `asOf` moves which observations are admissible and how
values are scored. Choosing it with foreknowledge is a live degree of freedom, which is exactly why §19.1 puts
it before registration.

**Who must do it.** The operator, attesting; and an outsider can only confirm the *value* against the
registration, never the ordering.

## M5. The §4A.1 item 6 pairwise relational check

**The check.** §4A.1 item 6 excludes a person who

> is the spouse or partner, a family member or a household member of, or has a current or former direct
> reporting relationship with, any person who developed CPG, the operator (key custodian), or any holder of
> another §4A.3 role.

Because it quantifies over *every other role holder*, this is a **pairwise** check across the roster — with
seven independent persons plus the operator, 28 pairs, plus each holder against every CPG developer.

**Why it is irreducible.** Spouse, partner, family member, household member, former reporting line: these are
facts about human relationships. They appear in no study artefact, in no repository, in no hash. There is
nothing for a tool to read. And the register is **pseudonymous by design** — §4A.1: "a pseudonymous ID is used
in study artifacts" — so even a hypothetical external relationship database could not be joined to it without
destroying the pseudonymity the protocol requires.

**What I did make mechanical, stated narrowly so it is not mistaken for more.** Item 6's **roster dependence**
is now checkable: because the clause quantifies over the other role holders, the question changes whenever the
roster changes, so a declaration signed against an earlier roster is *stale*. `bind.mjs:110` `rosterDigest` and
`:125` `checkDeclarationCurrency` detect that, and the frozen `checkPersonnelRegister` cannot (it sees seven
`"no"` strings either way). **Detecting staleness is not detecting falsity** (`bind.mjs:108`). A declaration
re-affirmed against the current roster is current, and may still be false.

**Whose word it rests on, and why that is the sharpest point on this list.** The pairwise question includes
"a relationship with … **the operator** (key custodian)". §4A.3 lists the operator as "operator (key custodian;
**not independent**)". So the check that no role holder is related to the operator rests, in part, on the
operator — a party the protocol itself declares not independent — and on the developers, who are the same
implementers whose history M2 also depends on. **There is no independent party in a position to verify it.**
§4A.1's "procedural evidence, not proof" is doing real work here, and §20.23 publishes the residual. This is
not a defect introduced by this stream; it is a structural limit of a self-operated study, and it should be read
as such rather than as something the tooling failed to cover.

## M6. Who attests, and the independence of the attester

**Not one of the five capabilities — the thread running through the other five, recorded because it changes how
much any of them is worth.**

M1 rests on the declarants. M2 rests on the implementers' recollection. M3 and M4 rest on the operator's
ordering claims. M5 rests partly on the operator and the developers. In every case **the party attesting is the
party with an interest in the answer**, and the operator is by the protocol's own text not independent.

This is disclosed, not hidden: §20.23 publishes it, §4A.1 frames the whole register as procedural evidence, and
§19.3 lists independent personnel as a *named prerequisite* — something that "must exist before the stated act"
rather than something the tooling establishes. The honest summary is that the frozen tooling and the tools in
`tools/` can make the register **structurally impeccable and internally consistent**, and that this is a
different property from being **true**. No amount of further automation closes that gap, and a reader should not
treat a clean run of any tool in this directory as evidence that it has been closed.

---

## Summary

| # | Check | Mechanical part | Irreducibly human part | Rests on |
|---|---|---|---|---|
| M1 | Any declaration is true | answer is exactly `"no"`; hashes present; currency | **truth** | declarant |
| M2 | Development registry complete | registry hash frozen and compared | **completeness of the seed** (§5.3: "not attested") | implementers |
| M3 | §4A.3 fingerprint published before the commitment | the fingerprint **value**, and its match to the register | **the ordering** (`assignment.mjs:6-7`) | publication record |
| M4 | `as_of` chosen before registration | the **value**, fixed by the registration | **the ordering** | operator |
| M5 | §4A.1 item 6 pairwise relations | roster **staleness** of the declaration | **the relationships** | operator (**not independent**) + developers |
| M6 | Independence of the attester | — | **all of it** | — |

**Nothing on this list is closable by a frozen-byte change**, and `PERSONNEL_AUTOMATION_AUDIT.md` records that
no STOP condition fired: the five capabilities were built outside the instrument, which remains at
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`.
