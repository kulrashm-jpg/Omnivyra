# User View vs System View — Design Principle

**Summary:** We build the product **for users**. Content Architect is responsible for **functioning** (how the system works). Users need to be **informed**, not to understand the machinery.

---

## 1. Two audiences

| Audience | Goal | What they need |
|----------|------|----------------|
| **End users** (company admin, campaign manager, creator) | Get work done; know what’s happening and what to do | **What** is happening, **where** (platforms), **when** (week/day), **how often**, and **what I need to do** — in plain language. No system jargon, no internal IDs, no “how it works.” |
| **Content Architect** (and system/debug) | Ensure the system works; configure and troubleshoot | Full execution detail: execution_mode, IDs, alignment scores, posting_execution_map, resolved_postings, etc. |

---

## 2. Principle: Inform, don’t explain functioning

- **User view:** Answer “What’s happening? Where? When? How often? What do I do?”
  - Use clear labels: e.g. “AI can create this” / “You create this” / “Template unlocks AI” instead of raw `AI_AUTOMATED` / `CREATOR_REQUIRED` / `CONDITIONAL_AI`.
  - Show: topic, content type, platforms, frequency, intent/purpose, CTA, audience, tone — not alignment scores, execution_id, or internal enums.
- **System / Content Architect view:** Can show execution_mode, ai_generated, master_content_id, alignment scores, and other “how it functions” data — either in a dedicated area (e.g. collapsible “Technical details” / “System Execution Intelligence”) or on Content Architect–only surfaces.

---

## 3. What to avoid in the user-facing UI

- Raw enum or technical names: `CREATOR_REQUIRED`, `AI_AUTOMATED`, `execution_mode`, `alignment_score`, `topic_slot_ref`, etc.
- Internal IDs (execution_id, master_content_id) unless the user needs them (e.g. support).
- “Alignment score 8/100” or similar system metrics in the main copy (e.g. in Tone) — either strip for user view or show only in a technical-details block.
- Blocks titled “Execution details” that read like system logs; prefer “Where & how” or “What to create” and keep the copy outcome-focused.

---

## 4. What to show users (enough, not everything)

- **Week / plan:** Theme, phase, which platforms, how many pieces per week, topics with intent (video intent / writing intent), who it’s for, what action we want.
- **Activity / topic card:** What to create (content type), where (platforms), when (week/day), purpose (intent), CTA, tone — and whether “AI can create” / “You create” / “Template unlocks AI.”
- **Calendar / daily:** What, where, when, status (e.g. ready / needs media) — not execution internals.

---

## 5. Implementation notes

- **Content Architect:** Full view of the same data plus system fields (e.g. activity-workspace “System Execution Intelligence” block, or future Content Architect–only screens). No need to hide system detail from them.
- **Dual-view in code:** Today we achieve “user vs system” mainly by **what we show or hide** in the UI (e.g. hide execution_items from weekly cards; show system block only when expanded). A formal schema split (`user_display` vs `execution_intelligence`) can follow later if we want a single API to serve both views.
- **Copy and labels:** Prefer user language everywhere on campaign-details, daily plan, calendar, activity board: “Video intent”, “You create”, “AI can create”, “Template unlocks AI”, “Where & how” — and strip or relocate system-only text (e.g. alignment score in Tone) so users are informed without being bombarded.

---

**Bottom line:** User is not interested in understanding the system’s functioning; they need to be **informed**. Content Architect is responsible for functioning and gets the full picture. Keep user-facing surfaces clear, scannable, and outcome-focused.
