# Extension 1.5.0 contract (P1)

**Owner:** Outreach (virality-6f).
**Approved:** by the owner, 2026-11-10 (E-1 to E-4, D7b).
**Status:** LOCAL ONLY.

**Consumers:**
- the server routes under `pages/api/extension/*` (Outreach);
- extension 1.5.0 (`C:/tmp/omvx-ext`);
- PI `ingestCapturedSavedLeads` (virality-e1, Sales Navigator capture only).

## 0. Scope (launch slice, E-4)

| Capability | Command | State at launch |
|---|---|---|
| Comments and reactions on the bound member's OWN LinkedIn posts | `li.collect.own_post_comments` | Built; enabled when the owner lifts R-3 for version ≥ 1.5.0 |
| The bound member's OWN LinkedIn inbox | `li.collect.own_inbox` | Built; **never issued** until PI's B-7 recipient proof exists (E-3): DMs are not stored |
| Sales Navigator saved-lead capture | `li.salesnav.capture_saved_leads` | Built; **dark** behind PI's `SALESNAV_EXTENSION_CAPTURE_ENABLED = false` plus a tenant flag, until the owner accepts the terms risk in writing (E-2) |
| Approved reply to a comment on the member's own post | `li.comment.reply` | Built; requires a human approval bound to the text hash (D-01/D-02) |
| Like on a comment on the member's own post | `li.reaction.like` | Built; requires human approval |

**Out of scope:**
- Facebook, Instagram and YouTube go through the official API connectors (E-1).
- X comes later.
- The extension never opens a lead's or member's profile (D7b).
- No background crawling or polling of platform pages: a platform page is read only to answer a live server-issued command, on a tab the user has open.

## 1. Versions

| Item | Value |
|---|---|
| `COMMAND_SCHEMA_VERSION` | `2026-11-10.1` (server `extensionCommandSchema.ts` and the extension mirror, kept in lockstep) |
| `EXTENSION_MIN_VERSION` | `1.5.0` (`lib/extension/version.ts`). Every 1.5 route refuses an older or missing version with **426** `EXTENSION_UPGRADE_REQUIRED` |
| Version transport | `extension_version` inside the SIGNED request body on every 1.5 route, so the request signature covers it. 1.4.x routes and their signature canonical form are unchanged |

## 2. Request authentication (extension to server)

This is unchanged from today: `requireExtensionAuth` checks the session token, then `X-Omnivyra-Timestamp` (±5 min), `X-Omnivyra-Nonce`, and `X-Omnivyra-Signature` = HMAC-SHA256(secret, `METHOD\nPATH\nTS\nNONCE\nsha256(body)`).

**Changed in 1.5:** the request-nonce store becomes SHARED.
- It uses Redis (`SET nonce NX PX 600000`) through the shared client, but only while that client reports `ready`.
- Otherwise it falls back to the existing per-instance map, which is never weaker than today.
- It never falls back to "accept".
- The pairing claim-code store moves to the same pattern.

## 3. Account binding (new)

Session tokens are stateless and carry only `{userId, orgId, expiresAt, hmacNonce}`. A command must be bound to the LinkedIn member that the extension is actually logged in as.

**`POST /api/extension/bind-account`** (signed, version ≥ 1.5.0). Body: `{ platform: "linkedin", acting_member_urn, extension_version }`.
- `acting_member_urn` is the logged-in member's `urn:li:fsd_profile:<id>`, read by the extension from linkedin.com. It is never typed by the user.
- The server stores one active binding per (org, user, platform) in `extension_account_bindings`.
- **A different URN for an existing active binding is REFUSED** (409 `ACCOUNT_BINDING_CONFLICT`). An org admin must revoke the old binding first, and both events are audited.
- **Residual risk (recorded):** the URN is self-reported by the extension. LinkedIn's OAuth `sub` and the page-level member id are different namespaces, so the server cannot cross-check it against `social_accounts` today (PI C-PI-1). The binding-conflict rule plus the audit limit the damage, and the risk is the owner's to accept.

## 4. Commands (server to extension)

Every command is a row in the existing `extension_commands` table: `status` pending → dispatched → completed | failed | refused | uncertain, plus `expires_at`. It is issued ONLY by a user action in Omnivyra (inbox "Sync", the Sales Navigator "Capture" button, or an approved reply), never by a background job.

`GET /api/extension/commands` offers a 1.5 command only to a session whose (org, user) issued it AND whose active binding matches `payload.acting_member_urn`.

**The signed command envelope** is HMAC-SHA256 with the session's derived secret, over the canonical JSON of the fields below. The extension verifies it before acting and refuses on any mismatch.

```
{ command_id, schema_version, org_id, user_id, platform: "linkedin",
  acting_member_urn, action, params, expires_at,
  approval_id?, text_sha256?, target? }            // write commands only
```

**Canonical form (normative; both sides implement it identically):**
- `canonical(v)`:
  - objects: keys sorted by UTF-16 code unit, encoded as `{"k":canonical(v),...}`, with `undefined`-valued keys omitted;
  - arrays: `[canonical(e),...]`;
  - strings, numbers, booleans and `null`: `JSON.stringify(v)`;
  - no whitespace anywhere.
- `envelope_signature = hex(HMAC-SHA256(hmac_secret, "omnivyra.ext.cmd.v1\n" + canonical(envelope_without_signature)))`.
- The extension compares signatures in constant time.
- `expires_at` is epoch milliseconds. The extension refuses `Date.now() > expires_at`, and also refuses a `schema_version` other than `2026-11-10.1`.
- Shared test vector: `{"a":1,"b":[true,null,"x"]}` canonicalises to exactly that string. Both suites also pin the signature of one fixed envelope with a fixed secret, using the vector file `lib/extension/envelopeVectors.json` (server repo), copied to `tests/fixtures/envelopeVectors.json` (extension repo).

| `action` | `params` | Write? |
|---|---|---|
| `li.collect.own_post_comments` | `{ post_urns?: string[≤10], max_items: ≤200 }` | no |
| `li.collect.own_inbox` | `{ max_threads: ≤20 }` | no (never issued before B-7) |
| `li.salesnav.capture_saved_leads` | `{ list_kind: "saved_leads"\|"lead_list", max_leads: ≤25 }` | no |
| `li.comment.reply` | `target = { post_urn, parent_comment_urn }`; `text_sha256`, `approval_id` | yes |
| `li.reaction.like` | `target = { post_urn, comment_urn }`; `approval_id` | yes |

## 5. Results (extension to server; all signed, version ≥ 1.5.0, `command_id` required)

The server checks every result against the command row: same org, user and binding; status `dispatched`; not expired. A mismatch is 409, and a result is never accepted twice.

### 5.1 Collection: `POST /api/extension/events/comments` (1.5 form)
`{ command_id, extension_version, items: [{ post_urn, post_author_urn, comment_urn, parent_comment_urn?, author_urn, author_name, text, created_at?, reaction_counts? }] }`.
- **Own-content rule:** the server REJECTS any item whose `post_author_urn` ≠ the bound `acting_member_urn`.
- Accepted items go through the existing `validateSyncRecord` into `engagement_threads` / `engagement_messages`, which is the canonical store; there is no second inbox.
- The request carries at most 200 items.

### 5.2 Inbox: `POST /api/extension/events/dms` (1.5 form)
Refused with 403 `DM_STORAGE_DISABLED` until B-7. Nothing is stored.

### 5.3 Sales Navigator capture: `POST /api/extension/capture/leads`
This is the thin Outreach route; the contract was agreed with virality-e1 on 2026-11-10.
- **Body:** `{ command_id, extension_version, provider: "linkedin_salesnav_extension", contract_version: 1, provisional: true, captured_at, source: { surface: "sales_navigator", list_kind, list_name?, page_index }, leads: [≤25 × { lead_key, raw_urn?, public_profile_url?, full_name, headline?, title?, company_name?, account_external_id?, company_linkedin_url?, location?, connection_degree?, saved_at? }] }`.
- **`lead_key`:** the member-scoped id only, i.e. the first element of the `fs_salesProfile` tuple, never the full tuple. `raw_urn` is evidence only.
- **`public_profile_url`:** only an `/in/` URL actually displayed, verbatim. It is never constructed, and **never a `/sales/` URL**.
- The route verifies everything, builds `VerifiedCaptureContext` (`lib/extension/captureContext.ts`, branded, constructible only by the verifier), and calls PI's `ingestCapturedSavedLeads(ctx, payload)`.
- The response is per lead: `{ key, status: created|updated|unchanged|rejected, reason? }`. It contains no ids and no PII.
- Profile-URL classification uses PI's shared `lib/linkedin/profileUrl.ts` and its fixtures (`classifyLinkedinProfile`).

### 5.4 Write outcome: `POST /api/extension/action-result` (1.5 form)
**`POST /api/extension/authorize-submit`** must succeed before the click. It runs these rechecks:
- the kill switch;
- the approval is still valid and bound to `text_sha256`;
- the binding;
- the own-content rule;
- opt-out and suppression;
- usage.

It then writes `community_ai_actions.submit_attempted_at`. Without it, the extension must not submit.

| Situation | Server state | Retry |
|---|---|---|
| Refused before `submit_attempted_at` | `refused` (terminal for this command) | A new command may follow |
| `submit_attempted_at` written, then a timeout, lost reply, lost lease or closed tab | `uncertain` | **Never**; a human reconciles |
| A new comment URN by the acting member under the target, with a matching text hash (pre/post diff) | `executed` + `post_submit_evidence` | — |
| A like goes from not-reacted to reacted-by-the-member, read back afresh | `executed` + evidence (weaker; recorded as such) | — |
| Success reported without that evidence | `uncertain`, never `executed` | Never |

## 6. Migration (one; version from virality-83)

**New table `extension_account_bindings`:**
- columns: `id`, `org_id`, `user_id`, `platform`, `acting_member_urn`, `bound_at`, `revoked_at`, `revoked_by`;
- a unique partial index on (org, user, platform) WHERE `revoked_at` IS NULL;
- RLS enabled, with its own `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT` to service_role only, and a `has_table_privilege` / `has_any_column_privilege` postcondition.

**`community_ai_actions`:** add `submit_attempted_at timestamptz`, `acting_member_urn text`, `pre_submit_evidence jsonb`, `post_submit_evidence jsonb`.

Additive and re-runnable, with a slug-named rollback.

## 7. Tests (per change, under #27)

**Server unit tests:**
- version gate: 426 below 1.5.0 and when missing;
- shared nonce: replay refused across two simulated instances;
- binding: conflict refused;
- the command offer is filtered by binding;
- own-content rejection;
- DMs refused;
- capture: lead_key tuple refused, `/sales/` URL refused, cap of 25, per-lead status, no PII echoed;
- authorize-submit: each recheck;
- the truthful-state table;
- the shared profile-URL fixtures, every row.

**Real-schema** (the migration changed): binding uniqueness, column grants, rollback and re-apply.

**Extension unit tests:**
- envelope verification: tamper, expiry and wrong session;
- the binding recheck;
- the token never reaches a platform page;
- collectors produce the contract shapes from synthetic DOM fixtures;
- Sales Navigator: lead_key extraction, and the profile-URL classification that stores ONLY the class;
- the reply: never retried after submit; a missing confirmation becomes `uncertain`.
