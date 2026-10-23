# Orchestrator finding — what the instrument mechanically enforces about distinct people

Read directly from the frozen instrument (`C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`). Nothing modified.

## Enforced today: seven distinct person ids

`lib/personnel.mjs` — `checkPersonnelRegister`:

```
INDEPENDENT_ROLES = ['enumerator','reference-author','reference-confirmer','reference-adjudicator',
                     'rater-1','rater-2','rating-adjudicator']
```

- every role unfilled → **blocker** (`role <r> is UNFILLED`);
- every role other than `enumerator` must be held by **exactly one** person;
- the operator holding any independent role → `ROLE COLLISION — the operator may hold no independent role`;
- any `person_id` appearing twice → `ROLE COLLISION — <id> already holds <role>; all independent roles are mutually
  exclusive`.

So the seven-person minimum of §4A.3 is **enforced in code**, not merely documented. A two-human register is
refused by `check-personnel` as it stands.

## The irreducible pairwise checks, which live elsewhere

These are enforced independently of the register, in the modules that consume the work:

| Check | Location | What it protects |
|---|---|---|
| `author and confirmer must be different people (§9.4)` | `lib/reconcile.mjs:52` | double-entry — two independent observations of the same fact |
| adjudicator ∉ {author, confirmer} | `lib/reconcile.mjs:59` | the resolver is not a party to the disagreement |
| `the two sheets were rated by the same person — ≥ 2 independent raters are required` | `lib/ratings.mjs:97` | inter-rater agreement, and therefore α |
| `the rating adjudicator must be neither rater (§4A.3)` | `lib/ratings.mjs:98` | as above |
| `sheet1.rated_by === sheet2.rated_by` → INCONCLUSIVE | `lib/analysis.mjs` condition 3 | a second, run-level guard on the same property |

## The resulting floor

Two of those five checks are **substantive**: *author ≠ confirmer* and *rater-1 ≠ rater-2*. They are not role
bureaucracy — they are the whole content of double-entry and of inter-rater agreement. Both are satisfied by the
**same two people**:

```
Human A = reference Author  and  rater-1
Human B = reference Confirmer and rater-2
```

The other three checks exist only because adjudicators exist. So the gap between 7 and 2 decomposes exactly:

| From | To | What must change |
|---|---|---|
| 7 | 5 | eliminate both adjudicators — each is a third party *by construction* (`reconcile.mjs:59`, `ratings.mjs:98`) |
| 5 | 4 | eliminate the enumerator as a separate person (fold into A/B, which §4A.2(b) permits temporally, or mechanise the frame) |
| 4 | 2 | relax the register's **7-way** mutual exclusion to the two **pairwise** rules above |

**The theoretical minimum consistent with every substantive machine check is therefore two** — and the two checks
that survive are exactly the ones that stop a two-human design collapsing into one person wearing masks. That is the
line that must not be crossed: a design with one human is refused by the instrument in three independent places.

## What this does not establish

That two is *methodologically* defensible. The machine checks bound the count from below; they say nothing about
self-consistency bias, about whether α still measures inter-rater reliability when both raters previously authored
the reference records, or about the coverage cost of rule-based resolution. Those are the open questions.
