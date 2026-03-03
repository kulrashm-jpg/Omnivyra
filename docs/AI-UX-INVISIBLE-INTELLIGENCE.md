# AI UX Strategy: Invisible Intelligence

AI enhances workflow without becoming visually dominant. It should feel like **system intelligence**, not a separate feature.

---

## 1. AI visibility guidelines

### Where AI may appear

| Location | Allowed AI presence | Form |
|---------|---------------------|------|
| **Radar narrative summary** | Yes | Rule-based narrative (overall health, insight, soft recommendation). No "AI" label required. |
| **Recommended actions section** | Yes | Top 3 suggested actions; small labels/icon (e.g. lightbulb). No chat, no assistant avatar. |

### Where AI must not appear

| Location | Rule |
|----------|------|
| **Activity cards** | No AI branding, no "AI suggested" badges, no assistant icons on cards. |
| **Message threads** | No AI as a visible participant (e.g. no "AI assistant" bubbles); system messages are neutral (e.g. "System" or automated status only). |
| **General workflow UI** | No AI-only panels, no persistent "Ask AI" or chat entry points in pipeline/board/panel. |
| **Headers / global chrome** | No AI logo or "Powered by AI" in main nav or layout. |

### Critical alerts

- **Allowed only when workflow is truly blocked** (e.g. cannot proceed, access denied, system error).
- Do not use "urgent" or alert styling for AI suggestions or recommendations.
- Reserve prominent alerts for real blockers, not for "AI thinks you should…".

---

## 2. UI usage rules

1. **Indicators must be subtle**
   - Prefer small labels or small icons (e.g. lightbulb for recommendations, document for summary).
   - No large badges, no "AI" logos, no animated characters or assistants.

2. **No chat-style UI**
   - No chat input, no conversation bubbles, no "Ask AI" in Radar or execution workflow.
   - Narrative and recommended actions are read-only surfaces; no back-and-forth dialogue in this experience.

3. **No animated assistants**
   - No avatars, no typing indicators, no motion that suggests an agent is "thinking" or "speaking" in the main workflow.

4. **Tone = system intelligence**
   - Copy reads as system-generated insight (e.g. "Recommended focus: consider…") not "I recommend…" or "As your AI assistant…".
   - No first-person AI voice in narrative or recommendations.

5. **Consistency**
   - Same subtle treatment everywhere AI is allowed: small icon + short label, no dominance over primary content.

---

## 3. Consistency checklist

Use this when adding or changing any AI-related UI:

- [ ] **Placement** — Is this only in Radar narrative or Recommended actions? If elsewhere, revert or get an explicit exception.
- [ ] **Labeling** — Are we using a small icon/label only (e.g. "Weekly Summary", "Recommended Actions") with no "AI" or "Assistant" in the label?
- [ ] **No chat** — Is there any chat input, thread, or "Ask AI" in the workflow? If yes, remove or relocate outside execution UI.
- [ ] **No animation** — Are there any animated avatars, typing indicators, or assistant animations? If yes, remove.
- [ ] **Alerts** — Is any alert or urgent styling used for AI suggestions? If yes, reserve for true blockers only; keep recommendations non-intrusive.
- [ ] **Tone** — Does copy sound like system insight (neutral, "recommended focus", "consider") rather than a person or assistant?
- [ ] **Cards / threads** — Are activity cards and message threads free of AI branding and AI-only features? Confirm no new AI surfaces there.

---

## 4. Summary

| Do | Don’t |
|----|--------|
| Keep AI in Radar narrative + Recommended actions only | Put AI on activity cards, in message threads, or in global chrome |
| Use small icons and short, neutral labels | Use chat UI, animated assistants, or "AI" branding |
| Treat AI as system intelligence (neutral, professional) | Use first-person AI voice or "Powered by AI" |
| Limit critical alerts to real workflow blockers | Use urgent/alert styling for suggestions or recommendations |
