# The §15.1 `CONTAMINATION-DISCLOSED` flag is dead in three independent senses

The contamination stream raised this as a cautious "second-order finding … recorded as a finding
for the owner's decision, not as a defect claim." I verified it myself and it is **stronger than
the stream stated**. Recording it as CONFIRMED, with the full chain, because it is the most
consequential thing wave 011 has found.

All measurements read-only against the candidate `638d68e6…` (594 files). Nothing written to it.

## Sense 1 — the value is structurally always `false`

A five-link chain, each link verified by reading the file:

| # | Location | What it does |
|---|---|---|
| 1 | `lib/select.mjs:93` | `const pool = admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id));` |
| 2 | `lib/select.mjs:98` | the held-out set is drawn **only** from that `pool` |
| 3 | `cpg_u1_data.mjs:559` | `held_out: result.heldOut.map((x) => entry(x, 'held-out', c.basis))` |
| 4 | `cpg_u1_data.mjs:138` | `entry()` sets `held_out_ineligible_basis: basis[c.candidate_id] ?? []` |
| 5 | `lib/analysis.mjs:114`, `:159` | `heldOut` is built from `hoManifest.held_out`; the flag is `(…held_out_ineligible_basis ?? []).length > 0` |

`c.ineligible` is `new Set(Object.keys(basis))` (`cpg_u1_data.mjs:126`) — *exactly* the companies with a
non-empty basis. Link 1 removes every one of them from the pool. So every entry that reaches link 4
has `basis[id] === undefined`, hence `[]`, hence **length 0**.

**`contamination_disclosed` is `false` for every row of every well-formed run.** It is not merely
"unlikely to be true" — it cannot be true.

## Sense 2 — the value is never read

```
grep -rn "contamination_disclosed" --include=*.mjs .   →   lib/analysis.mjs:159   (one hit)
```

One occurrence in the entire instrument: the line that **writes** it. It is never read, never
aggregated into a count, never checked in a disposition, never asserted by any test. Even if link 1
were removed and the flag could go true, **nothing downstream would consume it.**

## Sense 3 — the protocol's named flag does not exist in the instrument at all

```
grep -rn "CONTAMINATION-DISCLOSED\|CONTAMINATION_DISCLOSED" --include=*.mjs --include=*.json --include=*.md .
→ no matches
```

§15.1 names the flag `CONTAMINATION-DISCLOSED` and defines it as *"observation remains VALID in the
primary analysis"*. That string appears **nowhere** in the 594 files — not in code, not in rules
JSON, not in the in-tree documentation. The `contamination_disclosed` boolean is the only thing that
gestures at it, and it is not the flag: it is a different name, always false, and unread.

## What this does and does not mean

**It is not automatically a defect.** §5.3 says a late contamination is *"recorded (company, basis,
date, discoverer) and published"* — an unbound verb with **no object**, as the stream established.
The protocol may well intend disclosure to be a published human act outside the tooling. On that
reading the instrument is not wrong; it is simply silent, exactly as the protocol is.

**But the consequence is sharp either way.** §5.3 imposes a real disclosure duty. The instrument
provides no carrier for it, no witness to it, and no flag implementing the one §15.1 defines. So:

- an outsider **cannot distinguish** "no contamination was ever discovered" from "contamination was
  discovered after the seal and disclosed somewhere outside every hash";
- the two post-seal channels that *do* exist both produce protocol-**prohibited** results —
  `identity_inadmissible` → `INVALID` (`lib/analysis.mjs:146`), forbidden by §5.3 and §15.1;
  `protocol_violations` → `INCONCLUSIVE` (`:205`, `:211`), forbidden by §5.3's *"never changes the
  §10.5 outcome"*;
- therefore **the duty is unfalsifiable as implemented.**

## Verdict

**OWNER DECISION REQUIRED**, and this materially raises the stakes of the decision the stream
already recorded:

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

It is not only that the carrier is unspecified. It is that **the flag the protocol names is not
implemented, the field that resembles it is provably always false and never read, and both available
post-seal channels are non-compliant.** Any option that claims to "already handle" late contamination
should be checked against the three senses above before it is believed.

Note the ordering constraint this inherits: the only option that makes the disclosure verifiable
inside a hash edits `lib/analysis.mjs:59`, which **moves the aggregate `638d68e6…`** and is therefore
pre-registration-only. If registration proceeds on the current aggregate, that option is gone.
