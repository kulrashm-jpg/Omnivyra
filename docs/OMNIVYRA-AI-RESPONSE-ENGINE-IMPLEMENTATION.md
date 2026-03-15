# OMNIVYRA AI RESPONSE ENGINE IMPLEMENTATION

**Rule-based AI response engine for social engagement**

---

## 1 Database Schema

### response_templates
| Column | Type |
|--------|------|
| id | UUID PK |
| organization_id | UUID FK → companies(id) |
| template_name | TEXT |
| platform | TEXT (nullable) |
| template_structure | TEXT |
| tone | TEXT (default: professional) |
| emoji_policy | TEXT (default: minimal) |
| created_at, updated_at | TIMESTAMPTZ |

**File:** `database/response_templates.sql`

### response_rules
| Column | Type |
|--------|------|
| id | UUID PK |
| organization_id | UUID FK → companies(id) |
| platform | TEXT (nullable) |
| intent_type | TEXT |
| template_id | UUID FK → response_templates(id) |
| auto_reply | BOOLEAN (default: false) |
| priority | INT (default: 0) |
| created_at | TIMESTAMPTZ |

**File:** `database/response_rules.sql`

### response_policy_profiles
| Column | Type |
|--------|------|
| id | UUID PK |
| organization_id | UUID FK → companies(id) |
| platform | TEXT |
| default_tone | TEXT |
| emoji_usage | TEXT |
| response_style | TEXT |
| created_at, updated_at | TIMESTAMPTZ |

**File:** `database/response_policy_profiles.sql`

---

## 2 Response Rule Engine

**File:** `backend/services/responsePolicyEngine.ts`

**Function:** `resolveResponsePolicy(message)`

1. Normalize intent from message classification
2. Query `response_rules` matching organization_id, intent_type, platform (or platform IS NULL)
3. Order by priority DESC, take first match
4. Load `response_templates` by template_id
5. Load `response_policy_profiles` for platform modifiers
6. Return template structure + tone + emoji_policy + auto_reply

---

## 3 Tagged Template Interpreter

**File:** `backend/services/taggedResponseInterpreter.ts`

**Supported tags:**
- greeting, introduction, personal_info, acknowledgement
- answer, clarification, cta, closing
- thank_user, appreciate_comment, invite_dm

**Functions:**
- `parseTemplateStructure(structure)` — extracts tagged blocks
- `blocksToPromptStructure(blocks)` — converts to LLM prompt format
- `extractVariables(template)` — finds {name}, {age}, {location}

---

## 4 LLM Generation Service

**File:** `backend/services/responseGenerationService.ts`

**Function:** `generateResponse(message, template, platform)`

- Uses `runCompletionWithOperation` (aiGateway)
- Prompt includes: original message, intent, platform, tone, template tags, brand profile
- Variables: {name} = author_name
- Output: natural reply text

---

## 5 Platform Formatter

**File:** `backend/services/platformResponseFormatter.ts`

| Platform | Tone | Max Length | Emoji |
|----------|------|------------|-------|
| LinkedIn | professional | 1250 | minimal |
| Instagram | friendly | 2200 | allowed |
| Twitter/X | concise | 280 | allowed |
| YouTube | community | 10000 | allowed |
| Facebook | friendly | 8000 | allowed |
| Reddit | conversational | 10000 | minimal |

---

## 6 Safety Layer

**File:** `backend/services/responseSafetyGuard.ts`

**Blocks auto-reply when:**
- intent = complaint
- intent = negative_feedback
- intent = spam
- sentiment = negative

**Returns:** `requires_human_review: true`

---

## 7 Execution Integration

**File:** `backend/services/responseOrchestrator.ts`

**Flow:**
1. `checkResponseSafety()` — if requires_human_review → return suggestion only
2. `resolveResponsePolicy()` — find rule + template
3. `generateResponse()` — LLM generation
4. `formatForPlatform()` — apply platform rules
5. If `auto_reply` and `execute`: `executeAction()` via communityAiActionExecutor

**Integration point:** communityAiActionExecutor.executeAction (existing)

---

## 8 Rule Builder APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/response/templates | GET | List templates |
| /api/response/templates | POST | Create template |
| /api/response/rules | GET | List rules |
| /api/response/rules | POST | Create rule |
| /api/response/suggestions | GET | Propose rules from message patterns |
| /api/response/generate | POST | Generate (and optionally execute) AI reply for a message |

---

## 9 Response Flow

```
Incoming message
    ↓
Intent classification (existing: engagement_message_intelligence)
    ↓
resolveResponsePolicy() → rule + template
    ↓
checkResponseSafety() → blocked? return requires_human_review
    ↓
generateResponse() → LLM
    ↓
formatForPlatform()
    ↓
auto_reply? → executeAction() else return suggested_text
```

---

**Implementation complete.** No changes to engagement ingestion pipeline.
