# PI-ADR-008 — MarketPulse as a person/lead source

**Status:** ACCEPTED by the programme owner, 2026-09-26.
**Base SHA:** `8621b1d93cb6f6a878c0156277c9f5112949fb0a` · **Decision id:** `DECISION-A` / option **A2** (PI-LEAD-FOUNDATION-002).
**Supersedes, narrowly:** the WS-3 statement that MarketPulse is *only* tenant-level intelligence — see §2 for exactly how far.
**Does not change:** `PI-ADR-002`, `PI-ADR-004`, `PI-ADR-006`, `PI-ADR-007`. **Does not decide:** `OD-B`, `ARCH-1`.

---

## 1. The decision

> **A2 — MarketPulse may become a person/lead source and should feed canonical prospects.**

Recorded verbatim because this reverses a documented architectural decision, and a reversal reached by inference would be indistinguishable from a bug. The owner was offered A1 (no change) and chose A2 explicitly.

## 2. What is superseded, and — more importantly — what is not

The existing contract says two things that are easy to conflate. Only one of them changes.

**Statement 1 — MarketPulse account ATTRIBUTES may not reach the canonical attribute set.** `accountIntelligence.ts` states that `market_pulse_*` is *"intelligence about the TENANT'S market, never about an external company"*, carries it under `subject: 'tenant_market'`, and makes it *"structurally incapable of reaching `attributes`"*. `enrichmentCoverage.ts` asks `marketPulseAttributeCoverage()` rather than assuming, and its answer is empty. A test pins this (`piWs3MarketPulseConsumption.test.ts`: coverage contains neither `region` nor `market`).

**This statement is UNCHANGED and remains in force.** A tenant's scan region is still not an external company's geography. Nothing in this ADR lets a MarketPulse observation write an account attribute, and `marketPulseAttributeCoverage()` still returns nothing.

**Statement 2 — MarketPulse is not a source of PEOPLE.** *This* is what A2 reverses. MarketPulse may now supply person observations that enter the canonical intake path like any other source: translate → validate → identity → account → prospect → provenance → duplicate parking.

The distinction is the whole of this ADR's scope. "This market is hiring marketing leaders" is tenant-level intelligence. "This is a named person at a named employer" is a person observation. The first may not become an account attribute; the second may become a prospect. Conflating them would have made A2 look like a far larger reversal than the owner actually authorised.

## 3. What this permits

A MarketPulse-originated person observation is an ordinary source observation and gets no privileges:

- It carries its own `source_records.provider` value, so it is permanently distinguishable in the evidence store.
- It is subject to the same identity resolution, so it cannot mint a person the resolver would not mint from any other source.
- It is subject to duplicate parking.
- It is **not** authoritative for any field. Under `PI-ADR-009` it holds no precedence, which means it can be outranked on `job_title` and `current company` and is otherwise resolved by recency and confidence like any vendor.
- It supplies **no** contact detail. MarketPulse is a market signal; modelling it as a source of emails would be inventing evidence it does not hold.

## 4. What this does not permit

- No account attribute may be sourced from MarketPulse (§2, Statement 1).
- No change to `marketPulseAttributeCoverage()`, and no change to the frozen decision order in `enrichmentCoverage.ts`.
- No privileged identity path: a MarketPulse observation with only a name and an employer resolves to a person only where the resolver already would, and never mints one from a bare name.
- No enrichment spend is created by a MarketPulse observation existing. Enrichment remains governed by `PI-ADR-007` — admin-tier capability plus a required ceiling.

## 5. Verification standard

The account-attribute wall is already pinned by an existing test and that test must stay green **unchanged** — if it needed editing, this ADR's §2 would be wrong. The new capability is proven by the simulated MarketPulse source reaching canonical intake and converging on the same person as the other sources, with its provenance intact and distinct.

## 6. Honest status

This ADR authorises the capability. It does **not** claim production MarketPulse emits person observations today: the production MarketPulse modules read tenant-market intelligence and no runtime path produces a person record from them. Building that producer is downstream work, and until it exists the capability is exercised by the simulator only. `PI-SIM-001`'s `marketpulse-person-sim` is therefore promoted from "proposed behaviour" to "the authorised shape of a behaviour not yet built in production".
