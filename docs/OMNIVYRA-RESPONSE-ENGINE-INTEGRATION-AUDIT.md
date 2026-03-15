# OMNIVYRA RESPONSE ENGINE INTEGRATION AUDIT

**Verification of Omnivyra AI Response Engine integration with engagement system**

---

## 1 Database Schema

| Table | Status | Notes |
|-------|--------|-------|
| response_templates | ✅ Exists | `database/response_templates.sql` |
| response_rules | ✅ Exists | `database/response_rules.sql` |
| response_policy_profiles | ✅ Exists | `database/response_policy_profiles.sql` |

### Schema Details

**response_templates**
- Columns: id, organization_id, template_name, platform, template_structure, tone, emoji_policy, created_at, updated_at
- FK: organization_id → companies(id) ON DELETE CASCADE
- Indexes: idx_response_templates_org, idx_response_templates_platform (partial)

**response_rules**
- Columns: id, organization_id, platform, intent_type, template_id, auto_reply, priority, created_at
- FK: organization_id → companies(id) ON DELETE CASCADE
- FK: template_id → response_templates(id) ON DELETE CASCADE ✓
- Indexes: idx_response_rules_org_platform_intent, idx_response_rules_priority

**response_policy_profiles**
- Columns: id, organization_id, platform, default_tone, emoji_usage, response_style, created_at, updated_at
- FK: organization_id → companies(id) ON DELETE CASCADE
- UNIQUE(organization_id, platform)
- Index: idx_response_policy_profiles_org_platform

**Organization scoping:** All tables scoped by organization_id with FK to companies(id). ✓

---

## 2 Message Input Integration

### engagement_messages

**Source:** `pages/api/response/generate.ts` loads from `engagement_messages`.

| Field | Used | Location |
|-------|------|----------|
| message_id (id) | ✅ | Passed to orchestrateResponse |
| content | ✅ | As original_message |
| platform | ✅ | Default 'linkedin' if null |
| thread_id | ✅ | For organization validation via engagement_threads |
| author_id | ❌ | Not loaded; author_name passed as null |

**Gap:** `author_id` exists on engagement_messages but generate API does not load it or resolve author display name from engagement_authors. `author_name` is always null.

### engagement_message_intelligence

**Source:** `pages/api/response/generate.ts` loads from `engagement_message_intelligence`.

| Field | Used | Notes |
|-------|------|-------|
| intent | ✅ | Passed to orchestrateResponse |
| sentiment | ✅ | Passed to orchestrateResponse |
| confidence_score | ❌ | Exists in schema; not loaded or used by response engine |

**Gap:** `confidence_score` exists in engagement_message_intelligence but is not used by the response engine.

---

## 3 Rule Matching Engine

**File:** `backend/services/responsePolicyEngine.ts`

### resolveResponsePolicy()

**Rule selection logic:**
- ✅ Match organization_id: `.eq('organization_id', input.organization_id)`
- ✅ Match platform: `.or(\`platform.eq.${platform},platform.is.null\`)` (platform or platform-agnostic)
- ✅ Match intent_type: `.eq('intent_type', intent)` (after normalizeIntent)
- ✅ Order by priority DESC: `.order('priority', { ascending: false })`
- ✅ Limit 1: `.limit(1)`

**Fallback when no rule matches:** Returns `null`; orchestrator returns `{ ok: false, error: 'No matching response rule found' }`. ✓

**Intent normalization:** Maps raw intent to canonical intents (greeting, introduction, question, product_inquiry, price_inquiry, positive_feedback, negative_feedback, complaint, lead_interest, general_discussion, spam). Unknown intents default to `general_discussion`. ✓

---

## 4 Template Interpreter

**File:** `backend/services/taggedResponseInterpreter.ts`

### Supported Tags

| Tag | Status |
|-----|--------|
| greeting | ✅ |
| introduction | ✅ |
| personal_info | ✅ |
| acknowledgement | ✅ |
| answer | ✅ |
| clarification | ✅ |
| cta | ✅ |
| closing | ✅ |
| thank_user | ✅ |
| appreciate_comment | ✅ |
| invite_dm | ✅ |

### Functions

- `parseTemplateStructure(structure)` — Extracts tagged blocks via regex; returns `ParsedBlock[]`. ✓
- `blocksToPromptStructure(blocks)` — Converts to `[tag]\ncontent` format for prompt. ✓
- `extractVariables(template)` — Finds `{name}`, `{age}`, `{location}` placeholders. ✓

Template blocks are converted to structured prompt input in `responseGenerationService.generateResponse()` via `parseTemplateStructure` → `blocksToPromptStructure`. ✓

---

## 5 LLM Generation

**File:** `backend/services/responseGenerationService.ts`

### generateResponse()

**Prompt includes:**
- ✅ Original message: In userPrompt as "Original message from {author}:"
- ✅ Detected intent: Not explicitly in prompt text; passed via template context (intent affects which rule/template is selected upstream)
- ✅ Template blocks: structurePrompt from blocksToPromptStructure
- ✅ Brand profile variables: brandContext from getProfile (brand_voice_list / brand_voice)
- ✅ Platform: In systemPrompt as "Platform: ${input.platform}" and platform rules

**Generation uses:** `runCompletionWithOperation()` from aiGateway ✓

---

## 6 Platform Formatting

**File:** `backend/services/platformResponseFormatter.ts`

### Platform Rules

| Platform | Status | Rules |
|----------|--------|-------|
| LinkedIn | ✅ | maxLength 1250, professional, emojiAllowed false |
| Instagram | ✅ | maxLength 2200, friendly, emojiAllowed true |
| Twitter/X | ✅ | maxLength 280, concise, emojiAllowed true (x alias) |
| YouTube | ✅ | maxLength 10000, community, emojiAllowed true |
| Facebook | ✅ | maxLength 8000, friendly, emojiAllowed true |
| Reddit | ✅ | maxLength 10000, conversational, emojiAllowed false |

**Emoji policy handling:** `formatForPlatform()` accepts `emojiPolicy` option; strips emojis when `emojiPolicy === 'none'` or `!rules.emojiAllowed`. ✓

---

## 7 Safety Layer

**File:** `backend/services/responseSafetyGuard.ts`

### checkResponseSafety()

**Auto-replies blocked for:**
- ✅ complaint
- ✅ negative_feedback
- ✅ spam
- ✅ sentiment = negative

**Returns:** `requires_human_review: true` when blocked ✓

Orchestrator invokes safety first; when blocked, returns `{ ok: true, requires_human_review: true, reason, executed: false }` without generating or executing. ✓

---

## 8 Execution Integration

**File:** `backend/services/responseOrchestrator.ts`

### Flow

1. ✅ safety check — `checkResponseSafety()`
2. ✅ resolveResponsePolicy — `resolveResponsePolicy()`
3. ✅ generateResponse — `generateResponse()`
4. ✅ formatForPlatform — `formatForPlatform()`
5. If rule.auto_reply = true and input.execute = true: ✅ `executeAction()` via communityAiActionExecutor
6. Otherwise: ✅ returns suggested_text only

**communityAiActionExecutor:** Orchestrator imports and calls `executeAction()` with action_type `reply`, target_id from `engagement_messages.platform_message_id`, suggested_text from formatted output, playbook_id from listPlaybooks. ✓

---

## 9 API Verification

| Endpoint | Method | Auth | Org Scoping | Input Validation |
|----------|--------|------|-------------|------------------|
| /api/response/templates | GET | resolveUserContext, enforceCompanyAccess | ✅ organization_id | platform optional filter |
| /api/response/templates | POST | resolveUserContext, enforceCompanyAccess | ✅ organization_id | template_name, template_structure required |
| /api/response/rules | GET | resolveUserContext, enforceCompanyAccess | ✅ organization_id | platform, intent_type optional |
| /api/response/rules | POST | resolveUserContext, enforceCompanyAccess | ✅ organization_id | intent_type, template_id required |
| /api/response/suggestions | GET | resolveUserContext, enforceCompanyAccess | ✅ organization_id | organization_id required |
| /api/response/generate | POST | resolveUserContext, enforceCompanyAccess | ✅ organization_id + thread validation | organization_id, message_id required |

All endpoints use `enforceCompanyAccess()` for organization scoping. ✓

---

## 10 Engagement UI Integration

**Current behavior:** The engagement UI uses:
- `AISuggestionPanel` → `GET /api/engagement/suggestions?message_id=&organization_id=`
- `ReplyComposer` → `POST /api/engagement/reply` (for sending replies)

**GET /api/engagement/suggestions** uses `engagementAiAssistantService.generateReplySuggestions()`, which calls `omnivyraClientV1.evaluateCommunityAiEngagement()` when OmniVyra is enabled. It does **not** use the Omnivyra Response Engine (responsePolicyEngine, response_templates, response_rules, etc.).

**POST /api/response/generate** exists and returns:
- suggested_text
- executed
- requires_human_review
- reason
- error

**Gap:** The engagement UI (AISuggestionPanel) does **not** call `POST /api/response/generate`. The Omnivyra Response Engine is not wired to the engagement inbox UI.

---

## 11 Integration Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Engagement UI not wired to Response Engine | High | AISuggestionPanel calls GET /api/engagement/suggestions (engagementAiAssistantService), not POST /api/response/generate. Response Engine suggestions are not surfaced in the UI. |
| author_name always null | Low | Generate API does not load author_id or resolve author display name; personalization ({name}) uses "the user". |
| confidence_score not used | Low | engagement_message_intelligence.confidence_score exists but is not loaded or used; no confidence gating. |

---

**Audit complete.** Database schema, services, and APIs are present and correctly integrated with engagement_messages, engagement_message_intelligence, and communityAiActionExecutor. The primary gap is that the engagement UI does not invoke the Response Engine.
