# 📋 Pending Items for P0 Implementation

## 🔴 Critical (Required for Testing)

### 1. Jest Configuration
**Status:** Missing  
**Impact:** Cannot run integration tests  
**Location:** Root directory  
**Action Required:**
- Create `jest.config.js` or `jest.config.ts`
- Configure TypeScript support (ts-jest)
- Setup test environment

**Files to create:**
- `jest.config.js` - Jest configuration with TypeScript support

**Dependencies to verify:**
- `ts-jest` may need to be added to devDependencies

---

## ⚠️ Important (Recommended)

### 2. `.env.example` File
**Status:** Template exists, file protected by gitignore  
**Impact:** No reference file for environment setup  
**Location:** Root directory  
**Action Required:**
- Manually create `.env.example` from `ENV_EXAMPLE_TEMPLATE.md`
- Remove markdown formatting
- Ensure it's committed (not in .gitignore)

---

### 3. Database Index Optimization
**Status:** TODO in code  
**Impact:** Performance issue for large datasets  
**Location:** `backend/scheduler/schedulerService.ts:39`  
**Action Required:**
- Add index on `(status, scheduled_for)` columns in `scheduled_posts` table
- Can be added via migration or Supabase SQL Editor

```sql
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_scheduled_for 
ON scheduled_posts(status, scheduled_for) 
WHERE status = 'scheduled';
```

---

## 🟡 Optional (Future Enhancements)

### 4. Platform Adapter TODOs
**Status:** Placeholder implementations (expected)  
**Impact:** Cannot post to Instagram/Facebook/YouTube  
**Files:**
- `backend/adapters/instagramAdapter.ts` - Instagram Graph API
- `backend/adapters/facebookAdapter.ts` - Facebook Graph API  
- `backend/adapters/youtubeAdapter.ts` - YouTube Data API v3

**Note:** These are intentionally placeholders for future implementation.

---

### 5. Media Upload TODOs
**Status:** Media upload not implemented  
**Impact:** Cannot attach images/videos to posts  
**Locations:**
- `backend/adapters/linkedinAdapter.ts:93` - LinkedIn media upload
- `backend/adapters/xAdapter.ts:92` - Twitter media upload

**Note:** Core posting works, media is future enhancement.

---

### 6. Token Refresh Implementation
**Status:** Placeholder in code  
**Impact:** Tokens may expire without refresh  
**Location:** `backend/adapters/platformAdapter.ts:126-134`  
**Action Required:**
- Implement platform-specific token refresh logic
- LinkedIn: Use refresh_token to get new access_token
- Twitter/X: May require re-authentication flow

---

## 📝 Documentation TODOs

### 7. Test Setup Documentation
**Status:** Mentioned in test file comment  
**Location:** `backend/tests/integration/publish_flow.test.ts:36-38`  
**Action Required:**
- Update `README_P0_IMPLEMENTATION.md` with Jest setup instructions
- Add jest.config.js creation steps

---

## ✅ Completed (No Action Needed)

- ✅ All core backend files created
- ✅ Queue infrastructure (BullMQ + Redis)
- ✅ Cron scheduler
- ✅ Token encryption (AES-256-GCM)
- ✅ LinkedIn & X adapters (with mock mode)
- ✅ Setup helper scripts
- ✅ Documentation files
- ✅ Environment setup scripts

---

## 🎯 Priority Order

**Before Testing:**
1. ⚠️ Create `jest.config.js` for running tests
2. ⚠️ Verify `ts-jest` is installed (or add it)

**Before Production:**
3. ⚠️ Create `.env.example` file
4. ⚠️ Add database index for performance
5. 🟡 Implement token refresh logic

**Future Sprints:**
6. 🟡 Implement Instagram/Facebook/YouTube adapters
7. 🟡 Implement media upload support

---

## Quick Fixes

### Fix 1: Create Jest Config
```bash
# Create jest.config.js
```

### Fix 2: Add Database Index
```sql
-- Run in Supabase SQL Editor
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_scheduled_for 
ON scheduled_posts(status, scheduled_for) 
WHERE status = 'scheduled';
```

### Fix 3: Create .env.example
```bash
# Copy from template and format
cp ENV_EXAMPLE_TEMPLATE.md .env.example
# Then edit .env.example to remove markdown formatting
```

---

**Summary:** 
- 🔴 **1 critical item** (Jest config for testing)
- ⚠️ **2 important items** (.env.example, DB index)
- 🟡 **3 optional items** (future enhancements)

