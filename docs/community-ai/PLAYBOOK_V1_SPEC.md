PLAYBOOK V1 SPEC (Engagement Playbook)

1. Purpose

An Engagement Playbook defines the rules and policies for how Community-AI should behave when engaging on social media.

It governs:

- what actions are allowed
- when automation is permitted
- what requires approval
- tone and style of responses
- safety limits
- execution method (API / RPA / manual UI)

Playbooks do not manage campaigns or content creation.
They only control engagement behavior.

2. Playbook Scope

Each Playbook applies to:

A. Platforms
platforms: ["linkedin", "facebook", "instagram", "x", "youtube", "reddit"]

B. Content Types
content_types: ["text", "image", "video", "banner", "thread", "reel"]

C. Engagement Intent
intents: ["community_engagement", "network_expansion", "brand_protection"]

3. Playbook Core Structure (Schema v1)
Type: EngagementPlaybook
type EngagementPlaybook = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;

  scope: {
    platforms: string[];
    content_types: string[];
    intents: string[];
  };

  tone: {
    style: "professional" | "friendly" | "empathetic";
    emoji_allowed: boolean;
    max_length: number;
  };

  user_rules: {
    first_time_user: "must_reply" | "optional" | "ignore";
    influencer_user: "require_approval" | "reply";
    negative_sentiment: "escalate" | "reply_with_template" | "ignore";
    spam_user: "ignore";
  };

  action_rules: {
    allow_reply: boolean;
    allow_like: boolean;
    allow_follow: boolean;
    allow_share: boolean;
    allow_dm: boolean;
  };

  automation_rules: {
    auto_execute_low_risk: boolean;
    require_human_approval_medium_risk: boolean;
    block_high_risk: boolean;
  };

  limits: {
    max_replies_per_hour: number;
    max_follows_per_day: number;
    max_actions_per_day: number;
  };

  execution_modes: {
    api_allowed: boolean;
    rpa_allowed: boolean;
    manual_only: boolean;
  };

  conflict_policy: {
    primary_wins: boolean;
    max_secondary_playbooks: 1;
  };

  safety: {
    block_urls: boolean;
    block_sensitive_topics: boolean;
    prohibited_words: string[];
  };

  status: "active" | "inactive";

  created_at: string;
  updated_at: string;
};

4. AI Classification Rules (Intent Mapping)

For every post:

AI returns intent scores:

community_engagement: 0.48
network_expansion: 0.46
brand_awareness: 0.06


Rules:

if one intent ≥ 60% → assign single Playbook

if two intents within ±10% → assign:

Primary Playbook = higher score

Secondary Playbook = second

max 2 Playbooks per post

primary always overrides secondary

safety rules override everything

5. Action Flow (Execution Pipeline)
Event (comment / user / post)
   ↓
AI classifies intent
   ↓
Playbook selected (primary + optional secondary)
   ↓
AI generates suggested action + response
   ↓
Playbook validates:
   - allowed action?
   - tone?
   - risk?
   - limits?
   ↓
Execution mode chosen:
   - API
   - RPA
   - Manual UI
   ↓
Action executed
   ↓
Audit log + metrics + notifications

6. UX Separation (Strict)
Engagement Board

- shows posts & actions
- user executes actions
- shows which Playbook applied
- no editing of Playbooks here

Playbook Settings Page

- create/edit Playbooks
- define rules
- enable/disable automation
- no posts shown here

7. RPA Compatibility

Playbook controls RPA by:

- allowing or blocking RPA execution
- setting limits
- defining task constraints
- enforcing approval

Example:

execution_modes: {
  api_allowed: true,
  rpa_allowed: true,
  manual_only: false
}

8. Multi-Tenant Rules

Every Playbook must be tenant-scoped:

tenant_id
organization_id


No Playbook can act across tenants.

9. Versioning

Playbooks are versioned logically:

playbook_version: v1


Future versions may add:

- campaign linkage
- performance learning
- adaptive rules

10. Relationship to other modules

Module	Role
Community-AI	Uses Playbooks
OmniVyra	Generates text within Playbook constraints
API Connectors	Execute if Playbook allows
RPA Workers	Execute if Playbook allows
Virality (future)	Supplies campaign context only

Playbook belongs to Community-AI, not Virality.

11. Where to store this in the repo

This is critical.
It should live inside Community-AI domain, not Virality.

Backend (Schema + logic)
/backend/services/playbooks/
   playbookService.ts
   playbookEvaluator.ts
   playbookTypes.ts

Database
/database/community_ai_playbooks.sql

Table:

community_ai_playbooks

API Routes
/pages/api/community-ai/playbooks/
   index.ts   (CRUD)
   evaluate.ts

UI
/pages/community-ai/playbooks.tsx
/components/community-ai/PlaybookEditor.tsx
/components/community-ai/PlaybookList.tsx

Types (shared)
/components/community-ai/types.ts
   EngagementPlaybook

12. Summary

We agreed that:

- Playbook is the foundation
- It governs automation, tone, safety, execution
- API, RPA, and manual UI are just execution channels
- Architecture must support single-machine PoC and future multi-tenant
- UI must separate Engagement vs Playbook Settings
- Playbooks must be stored under Community-AI domain in repo

Next step for Cursor (execution)

Create DB schema: community_ai_playbooks
Create Playbook service & evaluator
Create CRUD API
Create Playbook Settings UI
Wire Playbook into action pipeline (no RPA yet)
