# Orchestrator verification — VP-2 barriers, and a correction to my own wave-011 report

Read-only against the candidate `638d68e6…` and the frozen protocol `c50fc680…`. Nothing written to
either; the protocol was not touched.

## 1. The third machine barrier — CONFIRMED, and wave 011 missed it

Wave 011 named two chokepoints for frame sufficiency. There are **three**, and the third is the one that
earns the word "impossible".

```
cpg_u1_data.mjs:659-660   check-frame-sufficiency   → FRAME_INSUFFICIENT
cpg_u1_data.mjs:369-370   commitment-payload        → FRAME_INSUFFICIENT, before the payload is written
cpg_u1_data.mjs:444-445   draw-development          → STAGE_VOID_FRAME_INSUFFICIENT, EXIT.VOID
```

`:444-445`, verbatim:

```js
const suffDraw = sufficiencyOf(checked, c);
if (!suffDraw.ok) fail(`STAGE_VOID_FRAME_INSUFFICIENT: the committed frame was insufficient — ${describeShortfall(suffDraw)}`, EXIT.VOID);
```

This **re-derives sufficiency from the committed frame** after the payload and the broadcast. So a
hand-crafted payload and a broadcast OP_RETURN still yield **no sample**. That is what a binding barrier
looks like in this instrument.

**And all three route through `sufficiencyOf(checked, c)` → `frameSufficiency`**, whose entire body
(`lib/frame.mjs:41-50`) reads only `expected_outcome_class` and `candidate_id`. So making a
jurisdiction-coverage requirement *binding* means changing that predicate — i.e. the registered
instrument.

**Conclusion, accepted:** option A cannot satisfy §7's *"impossible to authorize"*. The constraint as
written selects **B**. And because a refusal contradicts §5.7.1 clause (c) — which prescribes that
missing families be *declared as a scope limitation*, not refused — B also needs a protocol amendment,
moving `protocol_sha256`. The stream's recommendation to **withdraw the constraint rather than satisfy
it** is the sound reading: it would install a refusal where the protocol prescribes a declaration.

## 2. §13.2 / §13.2A are mandatory minimums, not closed lists — I WAS WRONG IN WAVE 011

My wave-011 report stated that *"every candidate carrier is excluded by a closed enumeration or a
freeze"*, listing §13.2 and §13.2A as "both closed lists, both omit it". **That inference was wrong.**
The text does not support it.

`CPG_U1_PROTOCOL_004.md:809-815`:

- §13.2 is headed **"Hashed and published"** and is an enumeration joined by `·`, ending *"The
  registration record, both commitment payloads and both sampling records … are published."* There is
  **no** exhaustiveness language — no "exactly", "only", "and no other".
- §13.2A is headed **"Sampling archive (mandatory)"**. The word **mandatory** is floor-language: it says
  these items are required. It does not say nothing else may be archived.

Contrast the vocabularies that genuinely *are* closed, and note why: §10.5 *"exactly one"*, §5.10's state
table, §15.1's dispositions. Those are **exhaustive and selective** — a value outside the list would have
to displace one inside it. A published addendum displaces nothing.

So the correct discriminator is the stream's: **prohibition-by-absence is valid only for a vocabulary
declared exhaustive *and* selective.** Neither §13.2 nor §13.2A is either.

**Consequence — this changes the contamination disposition materially.** Wave 011 concluded there was
*"a disclosure duty with no disclosure channel"*. That is too strong. §5.3 names no artefact, carries
**no `[enforced]` tag** (unlike `:239` and `:200`), and the protocol already uses unbound "published" for
other late-discovered findings and already makes published OSF records load-bearing (`:456`, `:461`,
`:1089`). So an **existing procedural publication route lawfully carries the disclosure** — at zero
aggregate cost and zero protocol cost.

## 3. What the correction does NOT fix — the honest residual

Adopting the procedural carrier makes a **made** disclosure timestamped and verifiable. It does **not**
make the **absence** of one falsifiable. An outsider still cannot distinguish "nothing was discovered"
from "something was discovered and never disclosed".

Only the aggregate-moving option — a mandatory sealed attestation, including a negative one — closes
that, and it is **pre-registration only**. Once registration proceeds on `638d68e6…` that option is gone.

So the split the stream drew is right and worth preserving exactly: **the carrier is answerable from the
protocol (procedural, lawful, free); the semantics are not.** The sentence §8 requires still stands:

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

Likewise the three senses in which the §15.1 flag is dead were re-verified independently and all hold —
that finding is unaffected by this correction. What changes is only the *carrier* question, not the
state of the implementation.
