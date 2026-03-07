# User-Friendly Error Messages

## Overview

Technical errors are mapped to plain-language messages via the `user_friendly_error_mappings` table. Users never see "ECONNREFUSED" or "Supabase is down" — they see context-aware, actionable messages.

## Database Table

**Table:** `user_friendly_error_mappings`

| Column       | Description |
|-------------|-------------|
| match_type  | `code` \| `contains` \| `regex` \| `fallback` |
| match_value | Error code (ECONNREFUSED) or text to find in message |
| context     | login, campaign, strategic_themes, etc. |
| user_message| Plain-language message for the user |
| suggest_retry | Whether to suggest "try again" |
| guidance    | Optional extra hint |
| priority    | Lower = try first (10, 20, 30...) |
| is_active   | If false, row is skipped |

**Adding a new error:** Insert a row. Re-run the seed file to upsert (updates existing rows by match_type+match_value+context).

**Apply the migration:**
```bash
psql $DATABASE_URL -f database/user_friendly_errors.sql
```
Or run the SQL in Supabase SQL Editor.

## Principle

- **Never expose jargon**: No ECONNREFUSED, ETIMEDOUT, 429, stack traces.
- **Context-aware**: Login vs campaign vs recommendations get different messages.
- **Actionable**: "Try again in a few minutes" vs "You don't have permission" vs "Complete required fields".
- **Preserve friendly messages**: Validation messages like "Please complete the execution bar" pass through unchanged.

## Usage

### Backend (API routes, services)

```typescript
import { getUserFriendlyMessage } from '../backend/utils/userFriendlyErrors';

try {
  // ... operation
} catch (err) {
  const msg = getUserFriendlyMessage(err, 'campaign');
  return res.status(500).json({ error: msg });
}
```

### Contexts

| Context | Use when |
|---------|----------|
| `login` | Sign-in, auth callbacks |
| `company` | Company create, profile, team |
| `campaign` | BOLT, plan generation, scheduling |
| `strategic_themes` | Theme generation |
| `recommendations` | Recommendation engine |
| `publish` | Post publishing |
| `external_api` | Third-party API calls |
| `generic` | Fallback |

### Already integrated

- **BOLT pipeline** (`boltPipelineService.ts`): Stage failures, pipeline failures
- **BOLT execute API** (`pages/api/bolt/execute.ts`): Enqueue errors, general catch

## Adoption checklist

Adopt in these areas for full coverage:

- [ ] Login / auth APIs
- [ ] Company creation / profile APIs
- [ ] Recommendations generate API
- [ ] Strategic themes generation
- [ ] Publish processor (job failure → user notification)
- [ ] External API health / test endpoints

## Adding new patterns

Edit `backend/utils/userFriendlyErrors.ts`:

1. Add a pattern in `PATTERNS` with `test`, `byContext`, and `fallback`
2. Add context-specific fallbacks in `CONTEXT_FALLBACKS` if needed
3. Add friendly prefixes in `FRIENDLY_PREFIXES` for pass-through
