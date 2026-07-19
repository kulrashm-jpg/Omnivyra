# Diagram — Execution Flow

The end-to-end lifecycle from evidence to consumers. Derived from DESIGN-001 §6/§14 and the context programs.

## The intelligence lifecycle

```
Website / Sources
      │  [DET] collect
      ▼
┌─────────────────┐
│ EVIDENCE        │  immutable, attributed, versioned Evidence Objects
│ (collection     │  refresh gate · change detection · fingerprint · SSRF
│  policy engine) │
└────────┬────────┘
         │  evidence as basis
         ▼
┌─────────────────┐        ┌──────────────────────────────┐
│ GENERATION      │◀──────▶│ DISTRIBUTION                 │
│ (one runtime)   │ ground │  Grounding Authority          │
│  workflows ·    │◀──────▶│  (knowledge/evidence/         │
│  prompts ·      │validate│   constraint/gap sections)    │
│  models · packs │        │  Validation Pipeline          │
│  conversation   │        │  (S/Sem/Con/B + tokens)       │
└────────┬────────┘        └──────────────┬───────────────┘
         │  ProposeFact/ObserveFact               │ projections
         │  (validated, provenance-stamped)       ▼
         ▼                              ┌──────────────────┐
┌─────────────────┐   confidence +      │  CONSUMERS       │
│ KNOWLEDGE       │◀──provenance────────│  content ·       │
│ (one write      │   [TRUST]           │  campaigns ·     │
│  authority)     │                     │  reports · UI ·  │
│  Facts · state  │──KnowledgeChanged──▶│  recs · pulse    │
│  · versions     │   (event)           └──────────────────┘
└────────┬────────┘
         │  every signal
         ▼
┌─────────────────┐
│ LEARNING        │  correction-rate metric · calibration recommendations
│ (recommends,    │  → governed adoption by Trust/Generation/Grounding
│  never applies) │
└─────────────────┘
```

## Stage nature ([DET] deterministic / [AI])

| Stage | Nature | Notes |
|---|---|---|
| Collect | [DET] | refresh gate can stop the pipeline (cost discipline, P24) |
| Ground | [DET] | identical inputs → identical Grounding Context |
| Generate | [AI] | one runtime; governed prompt+model; consumes grounding |
| Validate | [DET] | universal; issues the token that gates persistence (P19) |
| Classify | [DET] | labeled opinion; never overrides user (P8) |
| Confidence | [DET] | five-dimension composite; reversible (P12) |
| Persist | [DET] | single write authority; append-only (P15) |
| Project | [DET] | derived read models; ProjectionUpdated is sole freshness signal |
| Learn | [DET] | recommends parameters; determinism preserved (P14) |

## The three mediation guarantees (post-migration)

The `company_profiles` table ends fully mediated on all three axes:

```
        WRITE ──────▶ one Knowledge write authority   (P3)
company_profiles
        READ  ──┬───▶ one Grounding Authority (AI)     (P11)
                └───▶ one Projection Runtime (display) (P26)
```

No direct read, no direct write, no ad-hoc grounding — enforced by CI census.
