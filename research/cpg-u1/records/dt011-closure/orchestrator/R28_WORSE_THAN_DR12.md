# R28 outranks DR-12: a placeholder identity reaches exit 0, not exit 4

Verified by me at `lib/registration.mjs:69-73`, read-only against the candidate `638d68e6…`.

## The mechanism

```js
const assigned  = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;
const synthetic = (v) => typeof v === 'string' && v.toUpperCase().includes(SYNTHETIC_PREFIX);
const human = (v, name, label) => {
  if (!assigned(v)) blockers.push(`${label} is UNASSIGNED (${name})`);
  else if (synthetic(v) && !allowSynthetic) errors.push(`${name} is a SYNTHETIC test value — refused outside test mode`);
};
```

`human()` has **exactly two** rejection paths: the literal `UNASSIGNED` sentinel, and any string
containing `SYNTHETIC`. There is no third. And there is **no identifier-shape validation anywhere in
the instrument** — a case-insensitive grep for `orcid|ror|isni|doi.org` across `lib/` and
`cpg_u1_data.mjs` returns zero matches outside one fixture value.

So `TBD`, `PLACEHOLDER`, `0000-0000-0000-0000`, `xxx`, `-`, or `.` in an identity leaf is:

- **assigned** — non-blank and not the sentinel ⇒ no blocker;
- **not synthetic** — contains no `SYNTHETIC` ⇒ no error.

It is accepted as a real accountable identity. The stream's run R28 shows the consequence end to end:
those placeholders in the five identity leaves, `network: bitcoin-mainnet`, **no**
`--allow-synthetic` → **exit 0**, reported *"complete, public, unembargoed, authoritative."*

## Why this is worse than DR-12, which the record has been treating as the registration-integrity defect

| | DR-12 | R28 |
|---|---|---|
| effect | verifier **understates** missing prerequisites | verifier **affirms** a record naming no real party |
| exit code reachable | **4** — bounded, cannot reach 0 (run R18: all ten fields ⇒ exit 1, 5 format errors) | **0** |
| what an outsider sees | "blocked, prerequisites missing" | "authoritative" |
| trigger | someone writes the sentinel back, with padding or wrong case — a typo | someone fills a placeholder, which is what placeholders are for |

DR-12 is a reporting-integrity defect whose worst case is a **false negative about readiness**. R28 is a
**false positive about authority** — the verifier's single most consequential output. The wave-010
record elevated DR-12 and did not record R28; that ordering is inverted.

## The critical consequence for the final edit session

**The DR-12 patch does not close R28, and was not intended to.** The DR-12 stream deliberately drew
its boundary at values that are *invisible to a human reader* (padding, casing) and explicitly declined
to invent what a valid ORCID/ROR/OSF identity looks like, referring shape validation onward as an
`EVIDENCE_SCHEMA` question. That is a defensible boundary — but it means that after DR-12 lands,
`TBD` still passes at exit 0.

Its own tests pin this: `"UN ASSIGNED"` (internal whitespace) is asserted to remain **assigned**.

So these are **two independent defects requiring two independent decisions**, both aggregate-moving,
both pre-registration-only:

1. **DR-12** — normalise the sentinel comparison. Three files, anchor count 404 → 410.
2. **R28** — reject transparent placeholders and/or validate identifier shape. **No prepared patch
   exists.** Not analysed, not scoped, not tested. It is a new finding of this wave.

And a third, from the same stream: **R15** — a plausible wrong 64-hex `provider_configuration_sha256`
also reaches **exit 0**, because `verify-registration` never compares it in any state; binding is
downstream only (`lib/harness.mjs:54`, `lib/execution.mjs:69`, `lib/evaluation.mjs:130`).

## The honest summary of verifier integrity

The registration verifier is **good at detecting absence and poor at detecting wrongness**. That
pattern now has four independent instances:

- a wrong tooling aggregate is masked while any blocker remains (`registered()` reports blockers before
  the comparison is reachable) — conditionally sound, and sound in the state a real registration is in;
- a wrong protocol SHA is masked the same way;
- a wrong provider configuration hash is **never** compared (R15) — exit 0;
- a placeholder identity is never recognised as one (R28) — exit 0.

**OWNER DECISION REQUIRED on R28 and R15.** Neither is closed by any patch prepared in this wave, and
neither can be closed after registration without a non-authoritative re-registration
(`tooling_aggregate_sha256` is a `SAMPLING_FIELDS` member; `checkAuthority` keeps the earliest
registration authoritative and yields `study VOID` on a divergent duplicate).
