# ENUMERATOR_EVIDENCE_HANDLING — sources, citation, and the CPG-contact prohibition

**Classification: PREPARATION.** Not evidence. **No enumerator has been recruited; no source has been
cited.** This document names no company and contains no CPG output.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data.

- Protocol basis: §4A.2 (what enumerators receive), §5.1 (A2, A3, A4, the representation rules),
  §5.2, §5.3, §5.4, §13.1 — `CPG_U1_PROTOCOL_004.md` sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified).
- Instrument basis: `lib/schema.mjs` (`isHttpsUrl:78`, `checkFrameRow:93`), `lib/identifiers.mjs`,
  registered aggregate `<NEW_AGG>` / <NEW_N>
  files (verified).

---

## 1. The only sources you may use

§4A.2 gives an exhaustive list, and the first item is the whole of your research material:

> **Enumerators receive only:** **public sources**; the frame template; §4A, §5.1–§5.4; the
> jurisdiction-family list; the development-only registry.

**Public source** means a source any outsider could reach and read for themselves, at a stable
`https:` URL. In practice, in descending order of what this study values:

| Preferred | Why |
|---|---|
| The jurisdiction's own company registry — the SEC's EDGAR-class record for `US-SEC`, the French business register for `FR-SIRENE`, the Brazilian register for `BR-CNPJ`, the GLEIF-class LEI record for `LEI-ONLY` | It is the authority for the identifier, and A3 is an identifier question |
| The entity's own website, at the canonical domain | It is the authority for A2, and often carries the identifier↔domain tie for A4 |
| A public index or listing that led you to the entity | It is what `enumeration_source_url` records |

| Never | Why |
|---|---|
| **Any CPG output, in any form** | §4A.2(b); disqualifying, and it makes the frame non-independent (§20.18) |
| Any Omnivyra product surface, report, export or screenshot | Omnivyra is the developing organisation's product; see §5 |
| Any AI system, agent or language model — as a source, a summariser, a checker, or a search assistant | An AI-produced row is not independent work; see §6 |
| A paywalled, login-gated or otherwise unreachable page as the cited URL | An outsider must be able to check your citation |
| A private communication, a phone call, or anything a company told you | See §4 |
| The repository, or any clone of it | You never see it; the scan is an operator task (§5.4) |
| The other enumerator's work, notes or findings | See your allocation file |

---

## 2. What you cite, and where

Three URL-bearing or note-bearing fields, three different jobs. Confusing them is the most common
error in this format.

| Field | The question it answers | Validation |
|---|---|---|
| `enumeration_source_url` (col. 22) | **How did this company enter the frame?** The public listing, registry search or index where you *found* it. | must be `https:` with a non-empty hostname; **required in every row** |
| `identifier_domain_evidence_url` (col. 8) | **Where is the identifier↔domain tie evidenced?** The page that ties the decisive identifier to the canonical domain. | may be empty, but A4 cannot pass without an `https:` URL here |
| `identifier_domain_evidence_note` (col. 9) | **What does that page actually say** that ties identifier to domain? One line, in your own words. | may be empty, but A4 cannot pass without non-blank text here |

These are frequently two different pages, and that is normal and expected — you find a company on an
index, and you evidence its identifier↔domain tie on a registry record or on the company's own legal
page.

**Both URL fields are validated by exactly this** (`lib/schema.mjs:78`):

```js
export function isHttpsUrl(v) {
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname; } catch { return false; }
}
```

So the tooling checks **three things and nothing more**: the string parses as a URL, its scheme is
`https:`, and it has a hostname. It does **not** fetch the page, does **not** check that the page
exists, does **not** check that the page is about the company, and does **not** check that the page
says what your note claims. **A well-formed URL pointing at the wrong page passes every automated
check.** The correctness of a citation is entirely yours.

What fails validation: `http:` URLs, bare hostnames, `www.example` without a scheme, `file:` paths,
`ftp:`, a search phrase, a document title, "see attached", a note in place of a URL, and an empty
string in column 22.

---

## 3. A4 — the one criterion that is about *independence from CPG*, not about the company

§5.1, A4: *"Identifier↔domain tie evidenced independently of CPG (URL + note required)."*

A4 asks whether **you** established the link between the decisive identifier and the canonical
domain **without CPG**. Since you have never seen CPG output, the honest answer is normally `yes` —
*provided you actually established the tie and can point to where.* The code turns a `yes` without
evidence into a **fail**, which is worse than `unknown` (`lib/schema.mjs:144–145`):

```js
const evidenceOk = isHttpsUrl(r.identifier_domain_evidence_url) && !!r.identifier_domain_evidence_note.trim();
adm.A4 = a4 === 'pass' && !evidenceOk ? 'fail' : a4;
```

So: `a4_tie_independent_of_cpg = yes` **requires** both column 8 (https URL) and column 9 (non-blank
note). If you cannot supply both, answer `unknown` and move on — an honest `unknown` is a correct
outcome (`A4_NOT_ESTABLISHED`), and a `yes` you cannot evidence is a harder failure.

**What the note should say.** One line, concrete, checkable: what the cited page states that connects
this identifier to this domain. Not "official source". Not "verified". Not "see URL". A reader who
opens your URL should be able to see the thing your note describes.

`lib/identifiers.mjs` puts the boundary between A3 and A4 in its own header, and it is worth keeping
in mind while you cite:

> Validation proves an identifier is WELL-FORMED, never that it names the intended entity — that tie
> is A4, established by a human against a registry.

The checksum tells you the identifier is a valid identifier. **Only you** can establish that it is
*this* entity's identifier, and column 9 is where you say how you know.

---

## 4. Handling sources, in practice

1. **Read the source yourself.** Do not cite a page you have not opened.
2. **Cite what you read, not what you found it through.** If a search engine result led you to a
   registry record, cite the registry record in column 8, and the listing or search in column 22 if
   that is genuinely where the candidate came from.
3. **Prefer a stable URL.** A permalink or a record-id URL over a session-scoped search result. If
   the only available URL is a search result, keep your own dated copy of what you saw (see item 5)
   and note the instability.
4. **Keep your own record.** For each row, keep the URLs you used, the date you read them, and what
   you took from each. You will need it if the operator returns a row, and it is what makes your work
   reconstructible. This is your working record — it is not the frame, and only the frame is
   submitted unless the operator asks for the record explicitly.
5. **Date honestly.** `enumerated_at` is the date you did that row's work. The tooling checks only
   that it is a real calendar date; it cannot catch a wrong one.
6. **Never contact a company in the frame.** Every fact comes from a public source, citable at an
   `https:` URL. A fact a company told you privately is not checkable by an outsider and does not
   belong in this frame.
7. **`UNKNOWN`/`unknown` is a legitimate finding.** If the source does not establish something, say
   so with the explicit token. §5.1: a blank cell is always malformed; an explicit token is a
   deliberate, respectable answer. Nobody is scoring you on how many rows come out admissible.
8. **Confidentiality.** Treat your rows, your notes and the development-only registry as
   confidential until the study's results are published. Do not discuss them with the other
   enumerator, with the developing organisation, or publicly.

---

## 5. The prohibition on CPG contact — absolute

**You must not contact, use, query, run, view, or request anything from CPG, Omnivyra, the developing
organisation, or any of its people, products, APIs, demos or support channels, for any purpose
connected to this work, at any time before this study's results are published.**

This is not a preference. It is the condition that makes your work usable:

- §4A.2(b): an enumerator must *"not have run CPG or seen any CPG output (including the development
  pilot and instrument check) before completing the frame."*
- §4A.2's exhaustive never-receive list: *"They never receive: pilot results, sizing output, quotas or
  any CPG output."*
- §4A.1 items 1–3 put any engagement, work or benefit from the developing organisation outside
  independence, with the single fixed-fee exception of item 5.
- Declaration key `ran_or_saw_cpg_output` must be the string `"no"`, and §4A.1 states plainly: *"An
  unknown answer is not 'no'."*

Concretely prohibited, and this list is illustrative rather than exhaustive — if it involves the
developing organisation, the answer is no:

| Prohibited |
|---|
| Running CPG, or any Omnivyra product, on anything |
| Opening a CPG or Omnivyra report, export, screenshot or dashboard |
| Signing up for, trialling, or logging into the developing organisation's product |
| Asking anyone at the developing organisation a question about a company, an identifier or a domain |
| Asking anyone at the developing organisation, or the operator, whether a company is "a good candidate" |
| Accepting any payment or benefit from the developing organisation other than the single fixed, non-contingent study fee of §4A.1 item 5 |
| Reading the developing organisation's product marketing to decide what a good candidate looks like |
| Looking at the repository, or any clone of it |

**The one permitted channel is the operator**, and only for restatements of §5.1–§5.4 or of the
submission procedure. The operator records every question and answer, answers both enumerators
identically, and does not supply candidates, judgements or examples.

**If a breach happens — including by accident.** Stop, and tell the operator **immediately and in
writing**: what you saw or did, when, and how. Do not try to unsee it and do not decide for yourself
whether it mattered. §4A.1 is explicit about the consequence of a false declaration: the frame is
published as non-independent (§20.18). A disclosed accident is a recorded fact the study can handle.
An undisclosed one invalidates the frame silently, which is the worst available outcome.

| Field | Value |
|---|---|
| Breach reported? | `<<UNFILLED: none reported>>` |
| Date, what happened, what was seen | `<<UNFILLED>>` |
| Operator's recorded disposition | `<<UNFILLED>>` |

---

## 6. No AI, no ghost-writing

No part of your work may be produced, drafted, suggested, summarised or checked by an AI system,
agent or language model. Not for finding candidates, not for deciding an attestation, not for writing
an evidence note, not for validating a row, and not for translating a registry page.

A role performed or ghost-written by an AI is not independent human work. The §4A.1 consequences for
a false declaration apply, and the frame is published as non-independent (§20.18).

**The author of this document is an AI and therefore holds no role in this study.** This document is
an instruction; it is not a source, and nothing in it may be cited in a frame row.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

