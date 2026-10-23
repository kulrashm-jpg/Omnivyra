# Two defects I propagated into the record, now measured and corrected

Both originate in my own wave-009/010/011 reporting and have been repeated in several wave reports.
Verified read-only against the candidate `638d68e6…`. Anyone implementing DR-11 from the uncorrected
record would look at the **wrong line** and **overestimate the scope by nearly a factor of two**.

## Correction 1 — the DR-11 statement is at `cpg_u1_data.mjs:114`, not `:113`

```
112  if (scan.frame_hash !== frameHash) fail('scan was produced for a different frame …');
113  if (scan.registry_sha256 !== fileSha(registryPath)) fail('scan was produced with a different …');
114  const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));
115  const basis = {};
```

`:113` is the registry-mismatch guard. The last-value-wins collapse is `:114`.

## Correction 2 — `contamination()` is consumed by FIVE commands, not nine

```
$ grep -n "contamination(o" cpg_u1_data.mjs
108:function contamination(o, frame, checked, frameHash) {     ← declaration
367:    const c = contamination(o, frame, checked, frameHash);
437:  const c = contamination(o, frame, checked, frameHash);
501:  const c = contamination(o, frame, checked, frameHash);
657:  const c = contamination(o, frame, checked, frameHash);
```

**Four call sites**, serving **five commands** — `:367` `commitment-payload` (both stages), `:437`
`draw-development`, `:501` `heldOutInputs` (serving `pool-check` **and** `draw-held-out`), `:657`
`check-frame-sufficiency`.

Where "nine" came from: `loadFrame(o` has **8** grep hits — one declaration and **seven** call sites,
serving nine commands. That is `loadFrame`'s number, and it refuses a duplicate **frame row**. I carried
it across onto `contamination()`, which handles duplicate **scan results** — a different function
guarding a different artefact.

**Consequence, and it cuts in the fix's favour:** the wave-009 record declined to fix DR-11 partly
because "a guard there changes what nine consuming commands accept", citing a scope-expansion
prohibition. The true blast radius is **five commands via four call sites**, so that objection is
materially weaker than recorded.

## What does not change

DR-11 is **live, not stale** — independently established by reading seven candidate catchers, none of
which sees a duplicate inside a *supplied* `scan.results`:

- `:119` `if (!s) fail('scan has no result for …')` catches a **missing** result; a collapsed duplicate
  still returns a truthy `s`;
- `assertUnique` (`lib/select.mjs:44-51`) runs over the admissible **frame** and keys on
  `identifier_scheme|identifier_value` and `canonical_domain` — it never sees `scan.results`;
- `hashRecords` is never applied to `scan.results`; the scan is bound only by `fileSha(scanPath)`;
- `scan.results.length` is never compared to `frame.length` anywhere;
- the `scan_sha256` gates detect **substitution after** the commitment, not a duplicate **inside** the
  committed scan.

And the material consequence stands: via `lib/select.mjs:93`'s
`pool = admissible.filter((c) => !ineligible.has(…))`, **a CPG-C1-contaminated company can enter the
held-out pool**, then be written as fact into the manifest, the screening log, and the seal — silently,
if the edit precedes the development commitment, because the committed `scan_sha256` is the hash of the
*edited* file.

## The framing correction that must survive into the package

**DR-11 must not be recorded as a security control.** It does not close the pre-commitment tamper
window: an actor able to edit `scan.json` in that window can simply zero `repository_hits` on a single
entry — no duplicate, and no DR-11 guard fires.

Its real value is **input hygiene / fail-closed consistency**: it converts accidental malformation
(concatenated scans, manually merged files, a third-party generator) from a **silent wrong answer** into
a **loud refusal**. That is worth having, and it is not the same claim. Recording it as a security fix
would place an overclaim inside the registration package.

Supporting fact, verified: **no tooling version, current or historical, can emit a duplicate
`candidate_id`** — `cmdScan` emits one result per frame row after refusing duplicate frames — so the
hand-edit precondition is genuine.

## Third correction, smaller, to the `EVIDENCE_SCHEMA` count

"27 schema strings, all `/v1`" is not literally true. There are **26 distinct versioned identifiers, all
`/v1`, plus one unversioned tool-version string** — `cpg-u1-data-tooling-6` is `TOOL_VERSION`
(`cpg_u1_data.mjs:49`), not a schema. Also `cpg-u1-rater-order/v1` is one string in two roles
(`lib/raterOrder.mjs:56` as schema, `:7` as domain), so tables showing 27 rows describe 26 strings.
`grep -rn "/v2"` over all 108 non-`node_modules` files returns **zero**. Neither precision changes the
decision.

## Correction 4 — MY error: `EXIT` is declared in `cpg_u1_data.mjs:53`, not `lib/registration.mjs:53`

My wave-011 report said *"code 3 (`HALT`) is dead — declared at `lib/registration.mjs:53` and referenced
nowhere."* Wrong file. Measured:

```
cpg_u1_data.mjs:53:  const EXIT = { REFUSED: 1, POOL: 2, HALT: 3, BLOCKED: 4, WAITING: 5, VOID: 6 };
lib/registration.mjs:53:    provider_configuration_sha256: UNASSIGNED,
```

`lib/registration.mjs:53` is an unrelated template field. And the architectural point behind the
correction is worth keeping: **`lib/registration.mjs` declares no exit codes at all** — it is pure,
returning `{errors, blockers}`. The entire exit-code mapping lives in the CLI layer. The substance of the
finding stands (code 3 `HALT` is dead), but the citation was wrong.

## Correction 5 — the D-2 stream's error: `assigned()` is at `:59`, not `:57`

D-2 wrote that DR-12 targets `assigned()` at `lib/registration.mjs:57`. Measured:

```
lib/registration.mjs:57:  }
lib/registration.mjs:59:  const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;
```

Off by two, and `:57` is a closing brace. Immaterial to D-2's reasoning, but `:59` is the exact line an
implementer opens, so it is corrected here.

Confirmed at the same time: the provider field is `lib/registration.mjs:112-113` — an `assigned()`
blocker then a `HEX64` format error, **and no comparison of any kind.** R15 stands.

## The pattern worth naming

This wave has now found **four** wrong `file:line` citations — three of them mine (`:113`→`:114`,
"nine commands"→five, `registration.mjs:53`→`cpg_u1_data.mjs:53`) and one a stream's (`:57`→`:59`).

None changed a conclusion. All four would have sent an implementer to the wrong line. Since the record
is precisely what the next engineering wave will work from, and since the whole programme's discipline
rests on citations being checkable, the standing rule for the next wave is: **re-measure every
`file:line` against the candidate at implementation time rather than trusting the record, including this
report.** Line numbers drift; the anchors that do not drift are the code strings themselves, which is why
`test/mutate.mjs` keys on verbatim text rather than line numbers.
