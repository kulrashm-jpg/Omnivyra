# ENUMERATOR_CONTAMINATION_RULES — the four C1 attestations, and the honest limit of what you can answer

**Classification: PREPARATION.** Not evidence. **No enumerator has been recruited; no attestation
has been made.** This document contains no company name and no CPG output.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data.

- Protocol basis: §5.3 (held-out ineligibility, CPG-C1), §5.4 (scan scope), §5.1 — `CPG_U1_PROTOCOL_004.md`
  sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified).
- Instrument basis: `lib/schema.mjs` (`CONTAMINATION_ATTESTATIONS:38`, `checkFrameRow:93`) and
  `rules/development_only_registry.json`, in the registered instrument at aggregate
  `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` / 593 files (verified).

---

## 1. The six C1 rules, and which four are yours

§5.3: a company is **held-out-ineligible** if **any** of six rules holds.

| Rule | Condition | How established | Whose job |
|---|---|---|---|
| C1(1) | Name, domain or identifier appears in a committed path within scan scope at the resolver SHA | the scanner (§5.4) | **operator** — it reads the repository, which you never see |
| **C1(2)** | Used in developing the CPG resolver, the protocol, the dataset tooling, or reference-truth procedures | attestation `c1_2_used_in_cpg_work` | **you** |
| **C1(3)** | Any expected value derived from a CPG output | attestation `c1_3_values_derived_from_cpg` | **you** |
| **C1(4)** | Any prior CPG execution — smoke, live, pilot or production | attestation `c1_4_prior_cpg_execution` | **you** |
| **C1(5)** | The implementers' own company or tenant, or an entity they control | attestation `c1_5_internal_or_owned` | **you** |
| C1(6) | Matches the **development-only registry** by name (whole word) or domain (exact or parent) | scanner + `rules/development_only_registry.json` | **operator** (and see §4 — the registry is also what makes *your* four answerable) |

The four columns you fill are exactly `CONTAMINATION_ATTESTATIONS` (`lib/schema.mjs:38`):

```js
export const CONTAMINATION_ATTESTATIONS = Object.freeze([
  'c1_2_used_in_cpg_work', 'c1_3_values_derived_from_cpg', 'c1_4_prior_cpg_execution', 'c1_5_internal_or_owned',
]);
```

Each takes exactly `yes` \| `no` \| `unknown`. Blank is not an answer
(`<column> must be exactly "yes", "no" or "unknown" (blank is not an answer)`).

**What ineligibility does, and does not, do.** §5.3, verbatim: *"Ineligibility never excludes a
company from research: it can only be drawn into development."* A contaminated company is not thrown
away. It becomes unusable as a **held-out** company. That consequence is the operator's to manage,
not yours to avoid.

---

## 2. The rule that makes `unknown` fatal — confirmed against the source

§5.3, verbatim, at line **239** of `CPG_U1_PROTOCOL_004.md`:

> **For every contamination attestation, `unknown` is treated exactly like `yes`.** An unestablished
> contamination question makes a company ineligible [enforced].

**I confirmed this quotation myself.** I recomputed the protocol's sha256 in two independent trees
(`C:/tmp/dt4-people` and `C:/tmp/dt004-frozen-instrument`), got
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` in both — the value this study's
registration is keyed to — and read the sentence at line 239 of that exact file. It is quoted above
word for word, including the `[enforced]` marker.

**And I confirmed the `[enforced]` claim is true in code.** `checkFrameRow`, `lib/schema.mjs:167–169`:

```js
for (const c of CONTAMINATION_ATTESTATIONS) {
  if (r[c] === 'yes') contamination.push(LABEL[c]);
  if (r[c] === 'unknown') contamination.push(`${LABEL[c]} — NOT ESTABLISHED, treated as contaminated`);
}
```

Two branches, one effect: both `yes` and `unknown` push an entry onto the row's `contamination` list,
and any non-empty `contamination` list makes the company held-out-ineligible. The code comment above
the loop states the intent in the same terms (`lib/schema.mjs:159`):

```
// ── Contamination attestations: 'yes' AND 'unknown' both make a company held-out-ineligible. ──
```

The file carrying this rule is **byte-identical** between the registered 593-file instrument and the
worktree this document was written in, so there is no ambiguity about which version enforces it.

**There is no third option.** `no` keeps a company held-out-eligible. `yes` and `unknown` are the
same outcome. Nothing in between exists.

---

## 3. The four questions, stated so you can answer them

| Column | Question, in full |
|---|---|
| `c1_2_used_in_cpg_work` | Was this company used in developing the CPG resolver, **this protocol**, the dataset tooling, or the reference-truth procedures? |
| `c1_3_values_derived_from_cpg` | Is any expected value about this company — anywhere in this study — derived from a CPG output? |
| `c1_4_prior_cpg_execution` | Has this company been through **any** prior CPG execution: smoke, live, pilot or production? |
| `c1_5_internal_or_owned` | Is this the implementers' own company or tenant, or an entity they control? |

Notice what all four have in common: **every one of them is a question about the implementers'
history, not about the company and not about you.** Nothing you can read in a public source answers
any of them.

**One rule holds unconditionally** (§5.3): *"Own company is automatically development-only. C1(5) and
registry entry DEV-001 each independently make Omnivyra held-out-ineligible, whatever the scanner or
any attestation says."*

---

## 4. The honest problem, stated plainly

You are eligible for this role **only because** you have never implemented CPG and have never seen
any CPG output (§4A.2(a)–(b)). That is precisely what makes these four questions unanswerable from
your own knowledge. A perfectly honest enumerator, reasoning only from what they personally know,
would write `unknown` in all four columns of every row — and because `unknown` is treated exactly
like `yes`, **every company in the frame would be held-out-ineligible and the study could not
proceed.**

The protocol resolves this by giving you one, and only one, basis for answering:

> §4A.2, **Enumerators receive only:** … **the development-only registry.**

`rules/development_only_registry.json` is the implementers' own written record of their CPG history.
Its own header states what it is and how it was built:

> `"semantics": "A frame candidate matching any entry by name (whole word, any name variant) or
> domain (exact or parent) is held-out-INELIGIBLE regardless of scanner output or attestations. It
> may be drawn only into development."`
>
> `"source_policy": "Every entry cites the implementers' own history. No entry was created by
> researching companies."`

**So the operating rule for you is:**

| Situation | Your answer |
|---|---|
| The company **matches** an entry in the frozen development-only registry you were supplied, by name (whole word, any name variant) or by domain (exact or parent) | `yes` — for whichever of the four rules the entry's cited basis corresponds to. Write `yes`; do not try to be clever about which. |
| The company **does not match** any entry in that registry, and you have no other knowledge bearing on the question | `no` — **on the stated basis that the operator-supplied frozen registry does not list it, and on no other basis** |
| You have any other reason to think the company touched CPG — anything at all | `unknown` at minimum, `yes` if you believe it, and say so in writing to the operator |

**Be clear-eyed about what that `no` means.** It is not a statement that the company never touched
CPG. It is a statement that **the operator's frozen registry does not list it**. You are relaying the
implementers' own record back into the frame. That is the design, and it is the only thing available
to a person who has correctly never seen CPG.

**And the registry's completeness is explicitly not attested.** §5.3, verbatim: *"The seed's
completeness is not attested (§19.2, H2)."* The registry file says the same:

> `"status": "SEED — completeness NOT ATTESTED. Before candidate enumeration, the CPG implementer
> must attest that every company ever run through CPG (smoke, live, pilot, production) or used in CPG
> development is listed. Additions are append-only; an entry is never removed."`

So the chain is: your `no` rests on a registry whose completeness the implementers have **not yet
attested**. If the missing attestation is never obtained, every `no` in these four columns rests on
an unattested list. That is a real, live limitation of this study, it is recorded in the protocol as
one, and nothing in this package repairs it. **It is an operator blocker, not an enumerator problem**
— see §7.

The one thing you must **not** do is convert your own ignorance into a `no` for reasons of
convenience. §4A.1's standard for a declaration applies to a frame cell with equal force: an unknown
answer is not "no".

---

## 5. Two more things to know about the registry you are given

1. **It is frozen.** §5.3: *"For this study the registry is frozen at registration … held-out
   eligibility for both stages is determined solely by the registry whose SHA-256 is in the
   registration. No changes apply after registration."* The copy you receive is that registry, at
   that hash. If you are ever handed a different copy, stop and tell the operator; do not use it.
2. **It names companies, and it is the only place in this study that does.** §5: *"No company is
   named in this document and no fact about any company is asserted. The only company names that
   appear are in the development-only registry (§5.3), which records the implementers' own CPG
   history."* Treat those names as confidential study material. Do not use them as a candidate list,
   do not use them as a starting point for your search, and do not mention them to anyone.

---

## 6. The scan you will never see, and why you still matter

C1(1) and C1(6) are established by the operator's scanner over a clean clone at the frozen resolver
SHA, across two scopes (§5.4): **TEST** (`test/`, `tests/`, `__tests__/`, `fixture/`, `fixtures/`,
`__snapshots__/`, `__mocks__/`, `e2e/`, `*.test.*`, `*.spec.*`, `*.snap`) and
**CPG_IMPLEMENTATION** (CPG's own source, evaluation harnesses, routes and UI). §5.4: *"The scan is
conservative: a false positive only moves a company to development."*

Every contamination source is merged: scanner hits, registry matches, and your attestations. Your
four columns are the **only** channel through which a contamination that leaves no trace in the
repository can reach the frame at all. A company used in a CPG run that was never committed anywhere
is invisible to the scanner; the registry is the record meant to catch it, and your attestation is
what carries the registry's answer into the row.

---

## 7. Operator blockers this document cannot resolve

| # | Blocker | Owner |
|--:|---|---|
| 1 | **The registry completeness attestation of §5.3 / §19.2 H2 has not been obtained.** Until it is, every `no` in columns 16–19 rests on an unattested list. | CPG implementer |
| 2 | The registry's registered `registry_sha256` must be fixed and published before release, and the copy handed to each enumerator must hash to it. | operator |
| 3 | The operator must state, in writing, that the basis for a `no` is *"not listed in the frozen development-only registry"* and record that this is what the frame's `no` answers mean. Otherwise a later reader will take them for direct knowledge the enumerators never had. | operator |
| 4 | If the registry is extended before registration, both enumerators must be re-supplied and any row answered against the old copy re-checked. After registration, extension has no effect on this study (§5.3) and late-discovered contamination is recorded and published, never excluded (§5.3, §5.9, §15.2). | operator |

| Field | Value |
|---|---|
| Registry copy supplied to enumerators, sha256 | `<<UNFILLED: must equal the registered registry_sha256>>` |
| Date of the §5.3 / §19.2 H2 completeness attestation | `<<UNFILLED: not obtained>>` |
| Operator's written statement of what a `no` in columns 16–19 means | `<<UNFILLED: not written>>` |
