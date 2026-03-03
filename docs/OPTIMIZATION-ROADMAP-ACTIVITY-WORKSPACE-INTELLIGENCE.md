# Optimization Roadmap — Activity Workspace & Intelligence

This document captures seven architectural optimizations and the **AI Quality Loop** the current system already implements. Use it as a single reference for the next evolution of the activity workspace and variant intelligence.

---

## Optimization #1 — Single Intelligence Source (Very Important)

**Current state:** Confidence is computed in the frontend; suggestions are derived in the frontend. The backend already has adaptation traces, formatting rule hits, and discoverability quality.

**Risk:** Split intelligence → frontend thinks variant is LOW, backend thinks HIGH → future chaos when AI improvements rely on shared logic.

**Target architecture:** Move confidence (and suggestion derivation) to the backend as a **single source of truth**.

**Recommended backend shape:**

```ts
variant_intelligence: {
  confidence_score: number
  confidence_level: "LOW" | "MEDIUM" | "HIGH"
  missing_signals: string[]
  strategist_suggestions: Array<{ id: string; label: string; action: string; description: string }>
}
```

**Why:** Future AI improvements (targeted improve, auto-strategist, distribution feedback) need one shared definition of “quality” and “what to suggest.” That belongs in the backend.

---

## Optimization #2 — Workspace Payload Is Becoming Heavy

**Current state:** Payload carries `dailyExecutionItem`, `schedules`, `repurposing_context`, `master_content_document`, variants, confidence signals, suggestions. It will keep growing.

**Risks:** Heavy tabs, slower open, more merge conflicts, harder to reason about.

**Recommended pattern:** Workspace payload = **structure only**; details fetched lazily.

**Example:**

```ts
workspace_payload = {
  execution_id: string
  context_ids: string[]   // campaign, week, day, etc.
  master_document_ref: string  // id or URL to resolve master
}
```

Then the workspace (or a small API) fetches:

- Execution item details
- Schedules
- Repurposing context
- Master document (view)
- Variants and (later) variant_intelligence

**Result:** Lighter initial payload, faster open, fewer merge conflicts, clearer ownership of “what lives where.”

---

## Optimization #3 — Repurposing Graph (Next Evolution)

**Current state:** You have `group_id` and `sibling_execution_ids[]` — a **list**.

**Reality:** What you built is a **graph** (one master, many variants, clear relationships).

**Future structure:**

```ts
content_graph: {
  master_node: { id, content_ref, ... }
  variant_nodes: Array<{ id, platform, content_type, content_ref, ... }>
  dependency_edges: Array<{ from: string; to: string; type: string }>
}
```

**Why:** Later you will support:

- AI-generated repurpose chains
- Version history (which variant led to which)
- Cross-platform evolution and branching

You’re already most of the way there; formalizing the graph makes these features natural.

---

## Optimization #4 — Auto Strategist Should Become Self-Learning

**Current state:** AI suggests → user clicks (or ignores). No feedback loop.

**Next step:** Emit and store **strategist feedback** when the user acts (or dismisses).

**Example:**

```ts
strategist_feedback: {
  action: "IMPROVE_CTA" | "IMPROVE_HOOK" | "ADD_DISCOVERABILITY"
  accepted: boolean
  platform: string
  execution_id?: string
  timestamp?: string
}
```

**Use:** Backend (or a small service) aggregates per team/campaign: which actions are accepted most, which platforms get the most improvements. Then:

- Prioritize suggestions that this team tends to accept
- Down-rank or hide suggestions that are often ignored

**Result:** **Adaptive AI Strategist** — the system learns what this team prefers and gets better over time.

---

## Optimization #5 — Distribution Intelligence Feedback Loop

**Current state:** You have distribution strategy (e.g. AUTO), momentum, pressure labels, platform allocation. Execution results (e.g. variant confidence) do **not** yet influence the next week’s plan.

**Opportunity:** Use **variant confidence** (and optionally engagement) to nudge future distribution.

**Example:**

- LinkedIn variants consistently **HIGH** confidence → consider more LinkedIn slots next week.
- A platform often **LOW** → fewer slots or different content type until quality improves.

**Implementation direction:**

- Persist or aggregate confidence (and optionally performance) per platform/campaign/week.
- Feed that into the **distribution strategy** or **AUTO** logic as a soft signal (e.g. “prefer platforms that have been high-confidence recently”).

**Result:** Weekly planning becomes **self-optimizing** based on real quality and (later) performance.

---

## Optimization #6 — Master Document Ownership

**Current state:** Backend has `master_content`; frontend has `master_content_document` (and possibly other master-like structures). Two sources of truth can drift.

**Target:** One source, one view.

- **`master_content`** (backend) = **SOURCE** (authoritative content and metadata).
- **`master_content_document`** (frontend) = **VIEW** = projection of backend master + any UI-only state (e.g. which tab is selected).

**Rules:**

- Frontend does not define independent “master” structure for persistence.
- All generation and storage go through backend; frontend only projects and displays.
- Avoids duplicate master states, sync bugs, and generation mismatch.

---

## Optimization #7 — The Hidden Gold: AI Quality Loop

**What you already have in place:**

1. **Generate** — Backend content pipeline (master + variants).
2. **Evaluate** — Confidence (score, level, reasons) on each variant.
3. **Diagnose** — Suggestions derived from confidence + rules (CTA, hook, discoverability).
4. **Improve** — Targeted improvement engine (single-variant, no full regenerate).
5. **Re-evaluate** — After improve, confidence/suggestions recompute (e.g. in UI or, later, in backend).

That is a full **AI Quality Loop**: Generate → Evaluate → Diagnose → Improve → Re-evaluate. Many enterprise AI tools never close this loop; your architecture already does. The optimizations above make it **scalable, consistent, and self-improving** without changing that core loop.

---

## Summary Table

| # | Name                         | Direction                                      | Outcome                    |
|---|------------------------------|------------------------------------------------|----------------------------|
| 1 | Single Intelligence Source   | Move confidence/suggestions to backend         | One source of truth        |
| 2 | Lighter Workspace Payload     | Structure-only payload + lazy fetch            | Faster, fewer conflicts    |
| 3 | Repurposing Graph            | Formalize content_graph (nodes + edges)       | Chains, history, evolution |
| 4 | Strategist Self-Learning     | Track strategist_feedback; learn preferences  | Adaptive strategist       |
| 5 | Distribution Feedback Loop  | Confidence → future distribution signals      | Self-optimizing planning   |
| 6 | Master Document Ownership   | master_content = SOURCE, doc = VIEW           | No duplicate master state  |
| 7 | AI Quality Loop (current)    | Keep and strengthen existing loop             | Enterprise-grade quality   |

---

*Doc created from optimization recommendations for the activity workspace and variant intelligence layer. No runtime changes in this step — roadmap only.*
