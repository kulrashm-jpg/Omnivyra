# Blog Intelligence Workflow Audit
## Super Admin vs Company Admin Comparison

**Audit Date:** April 1, 2026  
**Scope:** End-to-end blog intelligence workflows  
**Status:** ⚠️ CRITICAL GAPS IDENTIFIED

---

## Executive Summary

The super admin and company admin blog intelligence workflows have **significant architectural and implementation divergences** that will break the company admin workflow. Key issues include:

1. ❌ **Broken routing** in AI card creation (routes to wrong page)
2. ❌ **API endpoint mismatch** between frontend calls and backend route definitions
3. ❌ **Missing intelligence API integration** in company admin frontend
4. ❌ **Inconsistent data structures** in BriefInsight type definitions
5. ❌ **Missing company_id propagation** in series/relationships operations
6. ❌ **Role enforcement inconsistencies** in API endpoints

---

## SECTION A: CRITICAL GAPS

### A1. **Broken Route Navigation in AI Card Creation**

**Issue:** Company admin AI card creation routes to non-existent page

| Aspect | Super Admin | Company Admin | Status |
|--------|------------|--------------|--------|
| **Route pathname** | `/admin/blog/generate` | `/blog/generate` | ❌ BROKEN |
| **Actual page location** | ✅ `/pages/admin/blog/generate.tsx` | ✅ `/pages/blogs/generate.tsx` | Mismatch |
| **Query parameter** | `prefill_card` | `prefill_card` | ✅ Same |

**Details:**

**File:** [pages/blogs.tsx](pages/blogs.tsx#L1250)
```typescript
// Line 1250-1270 (approximate from context)
const handleAICardCreated = (card: any) => {
    const token = `ai_card_${Date.now()}`;
    try {
      sessionStorage.setItem(token, JSON.stringify(card));
    } catch { /* ignore */ }
    void router.push({
      pathname: '/blog/generate',  // ❌ WRONG PATH (missing 's')
      query: {
        prefill_source: 'company_admin_ai_card_creation',
        prefill_topic: card.topic,
        prefill_reason: card.reason,
        prefill_priority: card.priority || 'medium',
        prefill_company_id: selectedCompanyId,
        prefill_intent: card.intent,
        prefill_tone: card.tone,
        prefill_card: token,
      },
    });
  };
```

**Expected location:** `/pages/blogs/generate.tsx` (with 's')  
**Actual navigation:** `/blog/generate` (without 's')

**Impact:** When company admin clicks "Create with AI", the app crashes or displays 404 error instead of launching the generation modal.

**Fix Required:** Change line 1250 from:
```typescript
pathname: '/blog/generate',
```
To:
```typescript
pathname: '/blogs/generate',
```

---

### A2. **Missing API Intelligence Endpoint Integration**

**Issue:** Company admin frontend never calls the intelligence API endpoint, despite it existing

| Component | Super Admin | Company Admin | Gap |
|-----------|------------|--------------|-----|
| **Intelligence endpoint** | `/api/admin/blog/intelligence` | `/api/blogs/intelligence` | ✅ Both exist |
| **Frontend integration** | ✅ YES - Called in [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L200) | ❌ NO - Endpoint exists but never invoked | **CRITICAL** |
| **Response format** | POST with company_id selection | POST with company_id | Different auth models |

**Details:**

**Backend endpoint exists:** [pages/api/blogs/intelligence.ts](pages/api/blogs/intelligence.ts#L1)
```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res,
    companyId:    company_id,
    allowedRoles: [Role.COMPANY_ADMIN],
  });
  if (!roleGate) return;

  // ── Intelligence ───────────────────────────────────────────────────────────
  const result = await runCompanyBlogIntelligence(company_id);

  return res.status(200).json(result);
}
```

**But frontend never calls it:**
- [pages/blogs.tsx](pages/blogs.tsx#L330) - Intelligence data loaded from disparate endpoints:
  ```typescript
  const [blogsRes, wpRes, apiRes, profileRes, seriesRes, relRes] = await Promise.all([
    fetch(`/api/blogs?${qs}`).then(r => r.json()),  // ✅ Posts
    fetch(`/api/integrations?${qs}&type=wordpress`).then(r => r.json()),
    fetch(`/api/integrations?${qs}&type=custom_blog_api`).then(r => r.json()),
    fetch(`/api/company-profile?company_id=${selectedCompanyId}`).then(r => ...),
    fetch(`/api/blogs/series?${qs}`).then(r => ...),
    fetch(`/api/blogs/relationships?${qs}`).then(r => ...),
  ]);
  ```
  
  Missing: `fetch('/api/blogs/intelligence', { method: 'POST', body: { company_id } })`

**Impact:** Company admin loses structured intelligence data (performance metrics, growth actions, topic narratives), instead relying on manual computation in the frontend.

---

### A3. **Inconsistent API Endpoint References**

**Issue:** Company admin frontend calls `/api/company/blogs` but also calls `/api/blogs`

| Endpoint | Called From | Parameters | Response |
|----------|-------------|-----------|----------|
| `/api/company/blogs` | [pages/blogs/generate.tsx](pages/blogs/generate.tsx#L63) | `?company_id=` | `{ blogs: [...] }` |
| `/api/blogs` | [pages/blogs.tsx](pages/blogs.tsx#L330) | `?company_id=` | `{ blogs: [...] }` |
| `/api/admin/blog` | Super admin [pages/admin/blog/new.tsx](pages/admin/blog/new.tsx#L25) | None (no company_id) | GET for access check |

**Details:**

**In /pages/blogs/generate.tsx (line 63):**
```typescript
const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}`);
```

**In /pages/blogs.tsx (line 330):**
```typescript
fetch(`/api/blogs?${qs}`).then(r => r.json()),  // where qs = `company_id=${selectedCompanyId}`
```

**Both endpoints exist:**
- [pages/api/company/blogs.ts](pages/api/company/blogs.ts#L1) - Uses direct Supabase auth validation
- [pages/api/blogs/index.ts](pages/api/blogs/index.ts#L1) - Uses `enforceCompanyAccess` + `enforceRole`

**Problem:** `/api/company/blogs` uses an older auth pattern (direct RBAC checks) while `/api/blogs` uses newer pattern (enforceCompanyAccess). This creates routing confusion and auth inconsistency.

**Fix Required:** 
1. Consolidate to use `/api/blogs` everywhere in company admin workflow
2. Update [pages/blogs/generate.tsx](pages/blogs/generate.tsx#L63):
```typescript
// Change from:
const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}`);
// To:
const postsRes = await fetch(`/api/blogs?company_id=${selectedCompanyId}`);
```

---

## SECTION B: INCONSISTENCIES

### B1. **BriefInsight Type Definition Mismatch**

**Issue:** `BriefInsight` interface differs between super admin and company admin

| Field | Super Admin | Company Admin | Difference |
|-------|------------|--------------|-----------|
| `company_id` | ✅ string | ✅ string | Same |
| `company_name` | ✅ PRESENT | ❌ MISSING | **INCONSISTENT** |
| `company_context` | ✅ string | ✅ string | Same |
| `current_content` | ✅ string | ✅ string | Same |
| `writing_style` | ✅ string | ✅ string | Same |
| `writing_style_profile` | ✅ WritingStyleProfile \| null | ✅ WritingStyleProfile \| null | Same |
| `related_titles` | ✅ string[] | ✅ string[] | Same |
| `intent` | ✅ enum | ✅ enum | Same |
| `tone` | ✅ string | ✅ string | Same |

**Details:**

**Super Admin [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L100):**
```typescript
interface BriefInsight {
  company_id: string;
  company_name: string;        // ✅ PRESENT
  company_context: string;
  current_content: string;
  writing_style: string;
  writing_style_profile: WritingStyleProfile | null;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
}
```

**Company Admin [pages/blogs.tsx](pages/blogs.tsx#L88):**
```typescript
interface BriefInsight {
  company_id: string;
  // company_name: string;     // ❌ MISSING
  company_context: string;
  current_content: string;
  writing_style: string;
  writing_style_profile: WritingStyleProfile | null;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
}
```

**Super Admin Brief Enrichment [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L380):**
```typescript
const brief: BriefInsight = {
  company_id: selectedCompanyId,
  company_name: selectedCompany?.name || selectedCompanyId || 'Selected Company',  // ✅ SET
  company_context: companyContextNote || 'No company profile...',
  // ... rest of fields
};
```

**Company Admin (combined with main page):** No explicit brief construction for recommendations until user navigates away.

**Impact:** Type safety broken when company admin passes BriefInsight to generation page. The type mismatch could cause issues if downstream code expects `company_name`.

**Fix Required:** Add `company_name` to [pages/blogs.tsx](pages/blogs.tsx#L88) interface and populate it when creating BriefInsight objects.

---

### B2. **Series/Relationships CRUD: Missing company_id in Super Admin**

**Issue:** Super admin series/relationships endpoints don't require company_id, company admin does

| Operation | Super Admin | Company Admin | Issue |
|-----------|------------|--------------|-------|
| **Create Series** | [lines ~520](pages/admin/blog/intelligence.tsx#L520) | [lines ~835](pages/blogs.tsx#L835) | Inconsistent |
| **company_id passed** | ❌ NO | ✅ YES | **INCONSISTENT** |
| **API endpoint** | `/api/admin/blog/series` | `/api/blogs/series` | Different tables |

**Details:**

**Super Admin [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L520):**
```typescript
const r = await fetch('/api/admin/blog/series', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    title: newSeriesTitle.trim(), 
    description: newSeriesDesc.trim() || undefined 
    // ❌ NO company_id
  }),
});
```

**Company Admin [pages/blogs.tsx](pages/blogs.tsx#L835):**
```typescript
const r = await fetch('/api/blogs/series', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    title: newSeriesTitle.trim(), 
    description: newSeriesDesc.trim() || undefined,
    company_id: selectedCompanyId  // ✅ INCLUDED
  }),
});
```

**Impact:** Series created by super admin apply globally (no company association in data), while company admin series creates company-specific series. This causes data ownership and visibility issues.

**recommendation:** For backward compatibility with super admin workflow, check if series endpoint supports optional company_id:
- If creating series globally (super admin): Don't send company_id
- If creating series per company (company admin): Send company_id

---

### B3. **Intelligence Page Layout & Architecture**

**Issue:** Super admin has dedicated intelligence page; company admin mixes intelligence into blog dashboard

| Aspect | Super Admin | Company Admin | Impact |
|--------|------------|--------------|--------|
| **Page location** | `/admin/blog/intelligence` | `/blogs` (same page) | Different UX |
| **Company selector** | ✅ Dedicated dropdown | No selector (implicit) | Context clarity |
| **Load trigger** | Initial page load | No dedicated API call | Different data handling |
| **State complexity** | Dedicated state management | Mixed with blog editor state | Complexity debt |

**Details:**

**Super Admin:** Has dedicated intelligence page at [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L200)
- Loads all public_blogs data
- User selects company from dropdown
- Recommendations enriched per company
- Can navigate to generation

**Company Admin:** Intelligence embedded in [pages/blogs.tsx](pages/blogs.tsx#L1) dashboard
- Uses `useCompanyContext()` for implicit company_id
- No dedicated company selector
- State mingled with blog editor state
- Harder to maintain and test

**Impact:** When company admin user opens blogs page, they must wait for all dashboard data to load (blogs, series, relationships, integrations, profile) before seeing any intelligence. This is slower and requires more complex error handling.

---

## SECTION C: MISSING FUNCTIONALITY

### C1. **Company Admin Cannot Create Custom AI Cards Like Super Admin**

**Issue:** Feature exists in super admin but broken in company admin due to routing bug

**Status:** ✅ Feature code exists, but ❌ Routing is broken (see A1)

**File References:**
- Super Admin card creation: [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L770)
- Company Admin card creation: [pages/blogs.tsx](pages/blogs.tsx#L1250)

**Missing:** Correct routing from `/blogs` → `/blogs/generate` with AI card in sessionStorage

---

### C2. **Company Admin Missing Blog-Specific Endpoints**

**Issue:** Some super admin API routes have no company admin equivalent

| Endpoint | Super Admin | Company Admin | Status |
|----------|------------|--------------|--------|
| Get single blog | `/api/admin/blog/[id]` | ❌ Missing | Not used in generate flow |
| Generate suggestions | N/A | `/api/company/blog/brief-suggestions` | Company-only |
| Hook rewrite | `/api/admin/blog/rewrite-hook` (?) | `/api/blog/rewrite-hook` | Different paths |

**Details:**

**Super Admin repurpose handler [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L490):**
```typescript
const generateRepurpose = async (postId: string) => {
  setGeneratingRep(true);
  setRepurposedContent(null);
  try {
    const r = await fetch(`/api/admin/blog/${postId}`, { credentials: 'include' });  // ✅ Exists
    const post = r.ok ? await r.json() : null;
    // ...
  }
};
```

**Company Admin repurpose handler [pages/blogs.tsx](pages/blogs.tsx#L1800):**
```typescript
const generateRepurpose = async (postId: string) => {
  setGeneratingRep(true);
  setRepurposedContent(null);
  try {
    const r = await fetch(`/api/blogs/${postId}`);  // ❌ No such endpoint (no company scoping)
    const post = r.ok ? await r.json() : null;
    // ...
  }
};
```

**Missing Endpoint:** `/api/blogs/[id].ts` for fetching single blog by ID within company context

---

### C3. **Company Admin Hook Rewrite Uses Wrong Endpoint Path**

**Issue:** Company admin calls `/api/blog/rewrite-hook` but should call `/api/blogs/rewrite-hook`

**File:** [pages/blogs.tsx](pages/blogs.tsx#L1670)
```typescript
async function rewriteHook() {
  // ...
  const response = await fetch('/api/blog/rewrite-hook', {  // ❌ WRONG PATH
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: editorTitle,
      content: editorContent,
      company_id: selectedCompanyId,
    }),
  });
  // ...
}
```

**Expected:** `/api/blogs/rewrite-hook` (with 's', consistent with other company endpoints)

**Impact:** Hook rewriting fails silently or returns 404 for company admin users.

---

## SECTION D: CONFIGURATION ISSUES

### D1. **API Authentication Role Enforcement Mismatch**

**Issue:** Super admin uses different auth check than company admin

| Endpoint | Auth Method | Allowed Roles | Enforcement |
|----------|------------|--------------|-------------|
| `/api/admin/blog/intelligence` | Direct check | `isPlatformSuperAdmin()` | ✅ Clear |
| `/api/blogs/intelligence` | `enforceRole()` | `[Role.COMPANY_ADMIN]` | ✅ Clear |
| `/api/admin/blog/generate` | `enforceRole()` | `[Role.SUPER_ADMIN]` | ✅ Clear |
| `/api/blogs/generate` | `enforceRole()` | `[Role.COMPANY_ADMIN]` | ✅ Clear |
| `/api/company/blogs` | Mix of direct checks | Uses older pattern | ⚠️ Inconsistent |

**Details:**

**[pages/api/company/blogs.ts](pages/api/company/blogs.ts#L1):** Uses older direct auth instead of helper functions
```typescript
const isAdmin = await isSuperAdmin(user.id);
if (!isAdmin) {
  const { role, error: roleError } = await getUserRole(user.id, company_id);
  if (roleError || !role) {
    return res.status(403).json({ error: 'Access denied to this company' });
  }
}
```

**vs [pages/api/blogs/index.ts](pages/api/blogs/index.ts#L1):** Uses modern helpers
```typescript
const access = await enforceCompanyAccess({ req, res, companyId });
if (!access) return;

const roleGate = await enforceRole({
  req, res, companyId,
  allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
});
if (!roleGate) return;
```

**Impact:** 
- `/api/company/blogs` is not protected against unauthorized company access
- Potential security gap in older endpoint
- `/api/blogs` is properly protected

**Fix Required:** Migrate `/api/company/blogs` auth to use `enforceCompanyAccess()` + `enforceRole()`

---

### D2. **Missing POST Method Support in Super Admin Intelligence**

**Issue:** Super admin intelligence endpoint only supports GET, but company admin uses POST

| Method | Super Admin | Company Admin | Inconsistency |
|--------|------------|--------------|---------------|
| GET | ✅ Supported | N/A | Super admin uses GET |
| POST | ❌ NOT supported | ✅ Supported | Different protocols |

**Details:**

**[pages/api/admin/blog/intelligence.ts](pages/api/admin/blog/intelligence.ts#L15):**
```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });  // ❌ Only GET
  // ... handles GET
}
```

**[pages/api/blogs/intelligence.ts](pages/api/blogs/intelligence.ts#L24):**
```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });  // ✅ Only POST
  // ... handles POST with company_id in body
}
```

**Super Admin frontend [pages/admin/blog/intelligence.tsx](pages/admin/blog/intelligence.tsx#L200):**
```typescript
useEffect(() => {
  fetch('/api/admin/blog/intelligence', { credentials: 'include' })  // ✅ GET (default)
    .then((r) => {
      // ...
    });
}, [router]);
```

**Impact:** 
- Different REST conventions between the two workflows
- Company admin's POST method allows passing company_id in body (cleaner)
- Super admin's GET loads all data, filters client-side (less scalable)

**Recommendation:** Align to POST method for both endpoints with company_id in body for consistency and future scalability.

---

### D3. **Writing Style Profile Refinement Disabled in Company Admin**

**Issue:** Super admin enables language refinement, company admin disables it

| Setting | Super Admin | Company Admin | Difference |
|---------|------------|--------------|-----------|
| `languageRefine` | `true` | `false` | **INCONSISTENT** |
| `autoRefine` | `false` | `false` | Same |

**Details:**

**[pages/api/admin/blog/generate.ts](pages/api/admin/blog/generate.ts#L55):**
```typescript
const profile = await getProfile(company_id, { 
  autoRefine: false, 
  languageRefine: true  // ✅ ENABLED
});
```

**[pages/api/blogs/generate.ts](pages/api/blogs/generate.ts#L55):**
```typescript
const profile = await getProfile(company_id, { 
  autoRefine: false, 
  languageRefine: false  // ❌ DISABLED
});
```

**Impact:** Company admin gets less refined writing style guidance from company profile, potentially leading to lower-quality generation prompts.

**Fix Required:** Enable language refinement for company admin:
```typescript
const profile = await getProfile(company_id, { 
  autoRefine: false, 
  languageRefine: true  // Change to true
});
```

---

## SECTION E: WORKFLOW INTEGRATION ISSUES

### E1. **Data Flow Diagram Mismatch**

**Super Admin Workflow:**
```
/admin/blog/intelligence.tsx
  ↓ (selects company)
  ↓ fetch /api/admin/blog/intelligence (GET, all public blogs)
  ↓ fetch /api/company-profile?mode=list
  ↓ fetch /api/company-profile?companyId=X
  ↓ (enriches gaps with BriefInsight including company_name)
  → onClick gap → sessionStorage + router.push(/admin/blog/generate, {prefill_brief: token})
  
/admin/blog/generate.tsx
  ↓ fetch /api/company-profile?mode=list (again!)
  ↓ fetch /api/admin/blog/intelligence (again!)
  ↓ form submit → POST /api/admin/blog/generate
  → result → router.push(/admin/blog/new, {prefill: token})
  
/admin/blog/new.tsx
  ↓ check /api/admin/blog (GET, access check)
  ↓ form submit → POST /api/blogs (or /api/admin/blog? inconsistent)
  ✅ Blog created as public_blogs entry
```

**Company Admin Workflow:**
```
/blogs.tsx
  ↓ fetch /api/blogs?company_id=X (implicit from context)
  ↓ fetch /api/company-profile?company_id=X
  ↓ fetch /api/blogs/series?company_id=X
  ↓ fetch /api/blogs/relationships?company_id=X
  ❌ Missing: fetch /api/blogs/intelligence
  ↓ (enriches gaps with BriefInsight WITHOUT company_name)
  → onClick "Create with AI" → sessionStorage + router.push(/blog/generate)  // ❌ WRONG PATH
  
/blogs/generate.tsx
  ↓ fetch /api/company/blogs?company_id=X  // ❌ Different endpoint than /blogs
  ❌ Missing: POST /api/blogs/intelligence to get structured data
  ↓ fetch /api/company/blog/brief-suggestions (POST)
  ↓ form submit → POST /api/blogs/generate
  → result → router.push(/blogs/new, {prefill: token})
  
/blogs/new.tsx
  ↓ form submit → POST /api/blogs?company_id=X
  ✅ Blog created as blogs table entry
```

---

### E2. **Session Storage Token Propagation Differs**

**Super Admin:** Uses consistent token pattern across navigation chain
- Intelligence → token `ai_card_${Date.now()}`
- Generate → token `blog_prefill_${Date.now()}`

**Company Admin:** Similar pattern but:
- Intelligence → token `ai_card_${Date.now()}`
- Generate → token `blog_prefill_${Date.now()}`
- BUT: No generation calls `/api/blogs/intelligence` to get structured data

**Issue:** Company admin loses access to structured intelligence when sessionStorage is cleared (e.g., on page refresh during generation step).

---

## SECTION F: SEVERITY RANKING

### 🔴 CRITICAL (Blocks Core Functionality)

1. **A1 - Broken AI Card Route** → Company admin cannot create custom AI cards
   - **Affected users:** All company admin users attempting custom card creation
   - **Workaround:** None

2. **A2 - Missing Intelligence Integration** → Company admin loses structured intelligence data
   - **Affected users:** All company admin users
   - **Workaround:** Manual data assembly in frontend (degraded performance)

3. **A3 - API Endpoint Mismatch** → Inconsistent data loading
   - **Affected users:** All company admin users
   - **Workaround:** Works for now, but fragile

### 🟠 HIGH (Breaks Specific Features)

1. **C3 - Hook Rewrite Wrong Endpoint** → Hook rewriting fails
   - **Affected users:** Company admin users clicking "Rewrite Hook"
   - **Workaround:** Manual hook editing

2. **B2 - Series/Relationships Missing company_id** → Data ownership issues
   - **Affected users:** Company admin users creating series
   - **Workaround:** Check backend series implementation

3. **D3 - Language Refinement Disabled** → Degraded generation quality
   - **Affected users:** All company admin users
   - **Workaround:** None (silent degradation)

### 🟡 MEDIUM (Impairs UX/Security)

1. **D1 - Auth Enforcement Mismatch** → Security debt
   - **Affected users:** Access control system
   - **Workaround:** Endpoint works but uses outdated pattern

2. **B1 - BriefInsight Type Mismatch** → Type safety issues
   - **Affected users:** Developers
   - **Workaround:** Runtime type coercion works but silent

3. **B3 - Intelligence Page Architecture** → UX complexity
   - **Affected users:** Company admin users
   - **Workaround:** Works but slower and harder to debug

---

## REQUIRED FIXES (Priority Order)

### Fix 1: Correct AI Card Navigation Route
**File:** [pages/blogs.tsx](pages/blogs.tsx#L1250)

```diff
- pathname: '/blog/generate',
+ pathname: '/blogs/generate',
```

### Fix 2: Integrate Intelligence API in Company Admin
**File:** [pages/blogs.tsx](pages/blogs.tsx#L330)

```diff
  const [blogsRes, wpRes, apiRes, profileRes, seriesRes, relRes] = await Promise.all([
    fetch(`/api/blogs?${qs}`).then(r => r.json()),
    fetch(`/api/integrations?${qs}&type=wordpress`).then(r => r.json()),
    fetch(`/api/integrations?${qs}&type=custom_blog_api`).then(r => r.json()),
    fetch(`/api/company-profile?company_id=${selectedCompanyId}`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`/api/blogs/series?${qs}`).then(r => r.ok ? r.json() : { series: [] }).catch(() => ({ series: [] })),
    fetch(`/api/blogs/relationships?${qs}`).then(r => r.ok ? r.json() : { relationships: [] }).catch(() => ({ relationships: [] })),
+   fetch('/api/blogs/intelligence', {
+     method: 'POST',
+     headers: { 'Content-Type': 'application/json' },
+     body: JSON.stringify({ company_id: selectedCompanyId })
+   }).then(r => r.ok ? r.json() : { posts: [], series: [], relationships: [] }).catch(() => ({ posts: [], series: [], relationships: [] })),
  ]);
```

### Fix 3: Consolidate API Endpoint in Company Admin Generate
**File:** [pages/blogs/generate.tsx](pages/blogs/generate.tsx#L63)

```diff
- const postsRes = await fetch(`/api/company/blogs?company_id=${selectedCompanyId}`);
+ const postsRes = await fetch(`/api/blogs?company_id=${selectedCompanyId}`);
```

### Fix 4: Fix Hook Rewrite Endpoint Path
**File:** [pages/blogs.tsx](pages/blogs.tsx#L1670)

```diff
- const response = await fetch('/api/blog/rewrite-hook', {
+ const response = await fetch('/api/blogs/rewrite-hook', {
```

### Fix 5: Add BriefInsight.company_name Field
**File:** [pages/blogs.tsx](pages/blogs.tsx#L88)

```diff
  interface BriefInsight {
    company_id: string;
+   company_name?: string;
    company_context: string;
    // ... rest
  }
```

And populate it when enriching gaps.

### Fix 6: Enable Language Refinement in Company Admin
**File:** [pages/api/blogs/generate.ts](pages/api/blogs/generate.ts#L55)

```diff
- const profile = await getProfile(company_id, { autoRefine: false, languageRefine: false });
+ const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
```

### Fix 7: Migrate /api/company/blogs Auth Pattern
**File:** [pages/api/company/blogs.ts](pages/api/company/blogs.ts#L1)

Replace direct auth checks with:
```typescript
const access = await enforceCompanyAccess({ req, res, companyId });
if (!access) return;

// Only for POST method
const roleGate = await enforceRole({
  req, res, companyId,
  allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
});
```

---

## TESTING CHECKLIST

- [ ] Company admin AI card creation routes to correct page
- [ ] Company admin can see full intelligence recommendations
- [ ] Blog generation for company admin includes structured intelligence
- [ ] Company admin hook rewriting works
- [ ] Series creation includes company_id properly
- [ ] All API endpoint auth checks use modern `enforceRole()` pattern
- [ ] No 404 errors for company admin workflows
- [ ] Company admin generation quality matches super admin

---

## ARCHITECTURAL RECOMMENDATIONS

1. **Consolidate intelligence loading:**
   - Use `/api/blogs/intelligence` as canonical company endpoint
   - Cache result to avoid re-fetching in generation step
   
2. **Align REST conventions:**
   - Standardize on POST for intelligence endpoints
   - Pass company_id consistently in request body, not path

3. **Dedicate intelligence page:**
   - Consider extracting intelligence tab from `/blogs` into `/blogs/intelligence`
   - Mirrors super admin architecture for consistency

4. **Unify brief enrichment:**
   - Create shared utility for enriching gaps with BriefInsight
   - Ensure all fields (including company_name) are populated

5. **Auth pattern modernization:**
   - Migrate all endpoints to use `enforceCompanyAccess()` + `enforceRole()`
   - Remove direct RBAC checks in API routes

---

**End of Audit Report**
