# Campaign AI Simulation – Comparative Diagnostic Report

**Date:** February 13, 2025  
**Scope:** Behavioral simulation of 4 campaign configurations using current `campaignAiOrchestrator` logic  
**Method:** Prompt trace analysis + structured output prediction (no live API calls)  
**Base Assumptions:** Mental clarity / decision-making platform; Platforms: LinkedIn, Facebook, YouTube, Blog; 1 pillar/week capacity

---

## 1. Prompt Payload Analysis (What Each Case Receives)

### CASE A — Pure Brand Awareness

| Component | Value |
|-----------|-------|
| `build_mode` | `full_context` |
| `company_context` | Full profile (commercial strategy, marketing intelligence, campaign purpose, brand positioning, competitive advantages, growth priorities) |
| `campaign_intent_summary` | `{ types: ["brand_awareness"], weights: { brand_awareness: 100 }, primary_type: "brand_awareness" }` |
| `weightedInstruction` | "WEIGHTED CAMPAIGN OBJECTIVES:\n- brand awareness: 100%\nAllocate strategic emphasis proportionally..." |

**Expected AI behavior:** Full company DNA available. Single objective, so no allocation tension. Model infers “brand awareness” → top-of-funnel, educational, soft CTA from label only.

---

### CASE B — Lead-Heavy Hybrid

| Component | Value |
|-----------|-------|
| `build_mode` | `full_context` |
| `company_context` | Same as Case A |
| `campaign_intent_summary` | `{ types: ["lead_generation","brand_awareness"], weights: { lead_generation: 70, brand_awareness: 30 }, primary_type: "lead_generation" }` |
| `weightedInstruction` | "WEIGHTED CAMPAIGN OBJECTIVES:\n- lead generation: 70%\n- brand awareness: 30%\nAllocate strategic emphasis proportionally..." |

**Expected AI behavior:** 70/30 split. “Lead generation” is a strong semantic cue (CTAs, gated content). “Allocate proportionally” suggests earlier conversion push, stronger mid-campaign CTA phase.

---

### CASE C — Authority-Only Focused Context

| Component | Value |
|-----------|-------|
| `build_mode` | `focused_context` |
| `context_scope` | `["brand_positioning"]` |
| `company_context` | Only `brand_positioning` from profile |
| `campaign_intent_summary` | `{ types: ["authority_positioning"], weights: { authority_positioning: 100 }, primary_type: "authority_positioning" }` |
| `weightedInstruction` | "WEIGHTED CAMPAIGN OBJECTIVES:\n- authority positioning: 100%\n..." |

**Expected AI behavior:** Minimal context; authority positioning as objective. Model must infer thought leadership, opinion content, possibly more LinkedIn/Blog, fewer hard CTAs.

---

### CASE D — Network Expansion, No Context

| Component | Value |
|-----------|-------|
| `build_mode` | `no_context` |
| `company_context` | `null` |
| `campaign_intent_summary` | `{ types: ["network_expansion"], weights: { network_expansion: 100 }, primary_type: "network_expansion" }` |
| `weightedInstruction` | "WEIGHTED CAMPAIGN OBJECTIVES:\n- network expansion: 100%\n..." |

**Expected AI behavior:** No company data. “Network expansion” suggests reach and engagement tactics. Model must infer polls, questions, community-building from label alone.

---

## 2. Structured Output Predictions (Simulated Blueprints)

### CASE A — Pure Brand Awareness

| Dimension | Predicted Output |
|-----------|------------------|
| Phase structure | Weeks 1–4: Awareness; 5–8: Consideration; 9–12: Light conversion |
| CTA intensity | Low until Week 9; soft “learn more” / “follow” CTAs |
| Platform prioritization | Linked to `platform_strategies` (LinkedIn, FB, YouTube, Blog). Likely balanced. |
| Content type mix | Educational posts (60%), how-to (25%), stories/testimonials (15%) |
| Conversion timing | Late (Weeks 10–12) |
| Messaging tone | Informative, supportive, problem-focused |

---

### CASE B — Lead-Heavy Hybrid

| Dimension | Predicted Output |
|-----------|------------------|
| Phase structure | Weeks 1–2: Warm-up; 3–6: Lead gen; 7–12: Nurture + conversion |
| CTA intensity | Higher from Week 3; gated content, lead magnets, sign-ups |
| Platform prioritization | Similar mix, but more lead-oriented formats on LinkedIn |
| Content type mix | Gated guides (40%), problem-solution (30%), brand (30%) |
| Conversion timing | Early to mid (Weeks 3–6) |
| Messaging tone | Problem-focused, value-driven, clear offers |

---

### CASE C — Authority-Only Focused

| Dimension | Predicted Output |
|-----------|------------------|
| Phase structure | Weeks 1–12: Thought leadership, framework/opinion content |
| CTA intensity | Low; “subscribe” / “follow” only |
| Platform prioritization | LinkedIn/Blog emphasized (from authority semantics) |
| Content type mix | Opinion pieces (40%), frameworks (35%), Q&A (25%) |
| Conversion timing | Minimal; reputation and engagement as goals |
| Messaging tone | Expert, opinion-driven, framework-heavy |

---

### CASE D — Network Expansion, No Context

| Dimension | Predicted Output |
|-----------|------------------|
| Phase structure | Weeks 1–12: Engagement and reach |
| CTA intensity | Soft engagement CTAs (share, comment, tag) |
| Platform prioritization | Facebook and LinkedIn if network-heavy; YouTube for reach |
| Content type mix | Polls (25%), questions (25%), shareable content (30%), UGC-style (20%) |
| Conversion timing | Not primary |
| Messaging tone | Conversational, participatory, community-oriented |

---

## 3. Comparative Diagnostic Report

### 3.1 Strategic Divergence Summary

| Metric | Case A | Case B | Case C | Case D |
|--------|--------|--------|--------|--------|
| Context depth | Full | Full | Focused (brand only) | None |
| Primary objective | brand_awareness | lead_generation | authority_positioning | network_expansion |
| Weight mix | Single (100%) | Dual (70/30) | Single | Single |

**Structural divergence:** Moderate to low. All plans likely share:

- 12-week layout
- Weekly themes
- Daily content ideas
- Platform-specific variants

Differences arise mainly from labels (“lead_generation,” “authority_positioning”) and context depth, not from explicit behavioral rules.

---

### 3.2 CTA Behavior Comparison

| Case | When CTAs appear | Aggression | Gated content |
|------|-------------------|------------|---------------|
| A | Weeks 9–12 | Low | No |
| B | Weeks 3–12 | High | Yes (lead magnets) |
| C | Throughout, minimal | Very low | No |
| D | Throughout, engagement-focused | Low | No |

**Finding:** “Lead generation” drives stronger CTA behavior. Others rely on model inference and may converge toward similar soft-CTAs without explicit rules.

---

### 3.3 Platform Allocation Differences

| Case | LinkedIn | Facebook | YouTube | Blog |
|------|----------|----------|---------|------|
| A | High | Medium | Medium | Medium |
| B | High (lead forms) | Medium | Medium | High (landing) |
| C | Very high | Low | Low | High |
| D | High | High | Medium | Low |

**Finding:** Platform choice is mostly implicit (from objective semantics) rather than from instruction-level guidance. No explicit platform-type mapping exists.

---

### 3.4 Phase Logic Differences

| Case | Phase model |
|------|-------------|
| A | Classic funnel: Awareness → Consideration → Conversion |
| B | Early conversion: Quick awareness → Lead gen → Nurture |
| C | Flat authority: Thought leadership across weeks |
| D | Engagement loop: Community and participation |

**Finding:** Phase design is model-inferred, not defined by the instruction block.

---

### 3.5 Messaging Tone Differences

| Case | Tone |
|------|------|
| A | Educational, supportive |
| B | Value proposition, offer-focused |
| C | Expert, opinion-driven |
| D | Conversational, participatory |

---

### 3.6 Weight Influence Evaluation

**Does 70% lead generation change structure?**

Yes, but only because “lead_generation” has strong, natural semantics. Differences likely include:

- Earlier CTA introduction (Weeks 3–4 vs 9–10)
- More gated content and lead magnets
- More problem–solution framing

**Limitation:** The instruction says “allocate proportionally” but never defines:

- What “lead generation” implies (CTAs, gating, offers)
- What “brand awareness” implies (reach, education, light CTAs)
- How 70/30 should change phase sequencing

So the model guesses from labels, not from explicit rules.

---

## 4. Scoring (1–10)

| Case | Objective alignment | Distinctiveness vs others | Strategic clarity |
|------|---------------------|---------------------------|-------------------|
| A | 7 | 5 | 6 |
| B | 8 | 7 | 7 |
| C | 6 | 6 | 6 |
| D | 5 | 5 | 5 |

**B** performs best due to a clear, familiar objective (“lead_generation”). **D** is weakest (no context, abstract objective).

---

## 5. Side-by-Side Comparison Table

| Dimension | Case A | Case B | Case C | Case D |
|-----------|--------|--------|--------|--------|
| Build mode | full_context | full_context | focused_context | no_context |
| Context scope | All | All | brand_positioning | — |
| Types | brand_awareness | lead_gen + brand | authority_positioning | network_expansion |
| Weights | 100% | 70/30 | 100% | 100% |
| Company context | Full | Full | brand only | None |
| CTA timing | Late | Early–mid | Minimal | Engagement |
| Platform emphasis | Balanced | LinkedIn/Blog | LinkedIn/Blog | FB/LinkedIn |
| Phase model | Funnel | Early conversion | Authority | Engagement |
| Tone | Educational | Value-focused | Expert | Conversational |

---

## 6. Conclusion

### Is weighted strategic allocation affecting behavior meaningfully?

**Partially.**

- **Strong effect:** “Lead generation” drives earlier CTAs and gated content because of clear semantic meaning.
- **Weak effect:** “Authority positioning,” “network expansion,” and even “brand awareness” rely on inference and can produce similar, generic plans.

### Are outputs still too generic?

**Yes, for most types.** Reasons:

1. **No type definitions** — The instruction lists objectives and percentages but does not define:
   - What each type implies
   - How each type should affect phase structure, CTA pacing, or platform choice
2. **Generic allocation rule** — “Allocate strategic emphasis proportionally” is vague and leaves interpretation to the model.
3. **No phase-type mapping** — There is no mapping from campaign types to phase logic (e.g. lead_gen → early conversion phase).
4. **No platform-type mapping** — Objective-specific platform prioritization is not defined.
5. **No CTA-type mapping** — CTA intensity and type (soft vs hard, gated vs ungated) are not linked to campaign types.

---

## 7. Instruction Refinement Suggestions (No Refactor)

Target: **`buildPromptContext` weighted instruction block** (lines 208–219 in `campaignAiOrchestrator.ts`).

### Suggestion 1: Add type-specific behavioral hints

Append after the existing weighted instruction:

```
Campaign type behavioral guidance:
- brand_awareness: Top-of-funnel focus. Soft CTAs only (follow, learn more). Educational tone. Prioritize reach.
- lead_generation: Introduce CTAs by week 3. Use gated content, lead magnets, sign-up prompts. Problem-solution framing.
- authority_positioning: Thought leadership tone. Opinion pieces, frameworks, expert POV. Minimize direct conversion. Prioritize LinkedIn and Blog.
- network_expansion: Engagement-first. Polls, questions, share prompts, community-building. Prioritize network-heavy platforms.
- engagement_growth: Interactive content, replies, discussions. Strong engagement CTAs.
- product_promotion: Feature showcases, demos, offers. Clear product CTAs.
```

### Suggestion 2: Make weight allocation explicit for hybrids

When `campaign_types.length > 1`:

```
For hybrid objectives: the highest-weight type drives phase structure and CTA pacing. Lower-weight types complement (e.g., 70% lead_gen + 30% brand = early conversion phase with educational brand content mixed in).
```

### Suggestion 3: Add phase–type mapping

```
Phase guidance by primary type:
- lead_generation: Awareness (1–2) → Lead gen (3–6) → Nurture (7–12)
- brand_awareness: Awareness (1–6) → Consideration (7–9) → Light conversion (10–12)
- authority_positioning: Thought leadership across all weeks; no conversion phase
- network_expansion: Engagement loop across all weeks
```

### Suggestion 4: Platform–type hint

```
Platform prioritization by primary type:
- lead_generation: LinkedIn (lead forms), Blog (landing)
- authority_positioning: LinkedIn, Blog
- network_expansion: Facebook, LinkedIn, YouTube (reach)
```

---

## 8. Implementation Note

These changes are additive only. Add the behavioral hints and mappings after the current weighted instruction string. No architectural changes required.

---

---

# RERUN: Post–Instruction Refinement Results

**Date:** February 13, 2025  
**Version:** With Campaign Type Behavioral Guidelines + Weight/Phase/Platform rules applied  
**Method:** Prompt trace + expected output prediction (instruction block now includes explicit definitions)

---

## R1. Updated Prompt Components (All Cases)

Each case now receives:

- **Weighted objectives list** (unchanged)
- **Campaign Type Behavioral Guidelines** — Full definitions for all 6 types (focus, CTA style, phase logic, content mix, platform emphasis)
- **Weight Allocation Rule** — Primary type dominates; secondary influences content mix only
- **Phase-Type Influence Rule** — Structure arc around dominant type; examples (lead-heavy → Week 2–3, authority-heavy → first 4 weeks credibility, network-heavy → engagement activation)
- **Platform Emphasis Hint** — Prioritization must align with dominant type

---

## R2. Structured Output Predictions (Post-Instruction)

### CASE A — Pure Brand Awareness

| Dimension | Predicted Output (Post-Instruction) |
|-----------|-------------------------------------|
| Phase structure | Strong top-of-funnel Weeks 1–6; minimal conversion push Weeks 7–12 (per guideline) |
| CTA intensity | Soft only (follow, subscribe, share) throughout |
| Platform prioritization | Broad distribution across LinkedIn, FB, YouTube, Blog |
| Content type mix | Educational (60%), storytelling (25%), value-first (15%) |
| Conversion timing | Late (Weeks 10–12), minimal |
| Messaging tone | Informative, supportive, educational |

**Guideline drive:** Explicit “Soft CTA,” “minimal hard conversion push,” “educational, storytelling, value-first,” “broad distribution.”

---

### CASE B — Lead-Heavy Hybrid

| Dimension | Predicted Output (Post-Instruction) |
|-----------|-------------------------------------|
| Phase structure | Weeks 1–2: Warm-up; **Weeks 2–3: Conversion push** (per Phase-Type rule); 4–12: Nurture + conversion |
| CTA intensity | Direct (book, sign up, download) from Week 2–3; gated content |
| Platform prioritization | LinkedIn + landing pages emphasized; Blog for gated value |
| Content type mix | Problem-solution (40%), gated guides (35%), proof/testimonials (25%) |
| Conversion timing | **By Week 2–3** (explicit in guideline) |
| Messaging tone | Value-driven, offer-focused |

**Guideline drive:** “Conversion push introduced by Week 2-3”; “Direct CTA”; “lead_generation dominates”; “secondary (brand) influences content mix only.”

---

### CASE C — Authority-Only Focused

| Dimension | Predicted Output (Post-Instruction) |
|-----------|-------------------------------------|
| Phase structure | **First 4 weeks: Credibility build** (per Phase-Type rule); Weeks 5–12: Thought leadership continuation |
| CTA intensity | Light, credibility-based (subscribe, follow) only |
| Platform prioritization | **LinkedIn + long-form blog** emphasized |
| Content type mix | Opinion pieces (40%), deep dives (35%), proprietary frameworks (25%) |
| Conversion timing | None; reputation focus |
| Messaging tone | Expert, opinion-driven, framework-heavy |

**Guideline drive:** “Authority-heavy → spend first 4 weeks building credibility”; “Light, credibility-based CTA”; “LinkedIn, long-form blog.”

---

### CASE D — Network Expansion, No Context

| Dimension | Predicted Output (Post-Instruction) |
|-----------|-------------------------------------|
| Phase structure | **Interaction-first weeks** (per Phase-Type rule); engagement loop throughout |
| CTA intensity | Engagement prompts (comment, connect, DM) |
| Platform prioritization | **LinkedIn, Facebook** (network-driven) |
| Content type mix | Polls (30%), questions (25%), discussion starters (25%), community themes (20%) |
| Conversion timing | Not primary |
| Messaging tone | Conversational, participatory |

**Guideline drive:** “Network-heavy → begin with engagement activation”; “Engagement prompts (comment, connect, DM)”; “LinkedIn, Facebook.”

---

## R3. Side-by-Side Comparison (Post-Instruction)

| Dimension | Case A | Case B | Case C | Case D |
|-----------|--------|--------|--------|--------|
| Build mode | full_context | full_context | focused_context | no_context |
| Primary type | brand_awareness | lead_generation | authority_positioning | network_expansion |
| Phase rule applied | Top-funnel early | Conversion Week 2–3 | Credibility first 4 weeks | Engagement activation |
| CTA style | Soft | Direct (Week 2–3) | Light, credibility | Engagement prompts |
| Platform emphasis | Broad | LinkedIn/landing | LinkedIn/Blog | LinkedIn/Facebook |
| Content mix | Educational, storytelling | Problem-solution, gated | Opinion, frameworks | Polls, questions |

---

## R4. Scoring (Post-Instruction) — 1–10

| Case | Objective alignment | Distinctiveness vs others | Strategic clarity |
|------|---------------------|---------------------------|-------------------|
| A | 8 | 7 | 8 |
| B | 9 | 8 | 9 |
| C | 8 | 8 | 8 |
| D | 7 | 7 | 7 |

---

## R5. Before vs After (Key Improvements)

| Metric | Before | After |
|--------|--------|-------|
| Case A distinctiveness | 5 | 7 |
| Case C distinctiveness | 6 | 8 |
| Case D distinctiveness | 5 | 7 |
| Case B CTA timing | “Earlier” (inferred) | “By Week 2–3” (explicit) |
| Case C phase logic | “Flat authority” (inferred) | “First 4 weeks credibility” (explicit) |
| Case D content mix | “Polls, questions” (inferred) | “Polls, questions, discussion starters” (explicit) |
| Platform allocation | Implicit | Explicit per type |

---

## R6. Conclusion (Rerun)

### Is weighted strategic allocation influencing behavior meaningfully now?

**Yes.** With explicit behavioral guidelines:

- **CTA timing** is anchored (e.g., lead gen → Week 2–3)
- **Phase logic** is prescribed (authority → first 4 weeks credibility; network → engagement activation)
- **Platform emphasis** is defined per type
- **Content mix** follows type-specific definitions

### Are outputs still too generic?

**No.** The instruction block now provides:

1. Operational definitions for each campaign type
2. Clear weight hierarchy (primary dominates)
3. Phase–type mapping (e.g., lead-heavy → Week 2–3)
4. Platform–type alignment

Plans should be structurally and tonally distinct across cases.

---

*End of rerun diagnostic report.*
