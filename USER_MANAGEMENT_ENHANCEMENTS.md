# User Management & Company Registration Enhancements

**Date**: March 21, 2026  
**Changes**: Unassigned user deletion + Company name collection for free credits

---

## 1. DELETE Unassigned Users from Super Admin

### What Changed

**File**: `/pages/api/super-admin/users.ts`  
**Enhancement**: DELETE endpoint now handles two scenarios

#### Before (Required companyId)
```
DELETE /api/super-admin/users
Body: { userId, companyId }
â†’ Only deleted user from company
â†’ Required BOTH userId and companyId
```

#### After (Optional companyId)
```
DELETE /api/super-admin/users
Body: { userId } â€” delete unassigned user
Body: { userId, companyId } â€” delete from company (original behavior)
```

### Behavior

**Route 1: Delete User from Company**
```typescript
POST /api/super-admin/users
Body: { userId: "xyz", companyId: "abc" }

â†’ Removes user_company_roles entry
â†’ User may still appear if unassigned elsewhere
```

**Route 2: Delete Unassigned User Entirely**
```typescript
POST /api/super-admin/users
Body: { userId: "xyz" }  // NO companyId

â†’ Deletes from users table
â†’ Attempts to delete from Supabase Auth
â†’ User is completely removed from system
```

### Audit Logging
- Logged as `SUPER_ADMIN_USER_DELETE` (from company)
- Logged as `SUPER_ADMIN_USER_DELETE_UNASSIGNED` (from system)

### Error Handling
- `400 MISSING_REQUIRED_PARAMETER` if userId missing
- `404 USER_NOT_FOUND` if user not found
- `500 FAILED_TO_DELETE_*` if database error

---

## 2. Company Name Collection & Uniqueness

### New Files Created

#### `/pages/api/onboarding/validate-company-name.ts`
Public endpoint for validating company name uniqueness

**Request**:
```typescript
POST /api/onboarding/validate-company-name
Body: { companyName: string }
```

**Response**:
```typescript
// Success - name available
{ available: true }

// Failure - name taken
{ available: false, reason: "..."  }
```

**Validation Rules**:
- âœ… Minimum 2 characters
- âœ… Maximum 100 characters
- âœ… Case-insensitive search (Acme â‰  ACME = duplicate)
- âœ… Checks both `companies` and `company_profiles` tables
- âœ… User-friendly error messages

**Example**:
```typescript
// Request
{ companyName: "Acme Corp" }

// Response
{ available: true }

// Request
{ companyName: "Acme Corp" }  // Already exists

// Response
{
  available: false,
  reason: "Company name \"Acme Corp\" is already taken. Please choose a different name."
}
```

---

### Modified Files

#### `/pages/onboarding/phone.tsx`
**Changes**:
1. **New step**: `'company'` (Step 1 of 3)
   - Collects company name before phone
   - Real-time validation with debounce (500ms)
   - Shows availability status with visual feedback

2. **New state variables**:
   ```typescript
   const [step, setStep] = useState<Step>('company');  // Start with company
   const [companyName, setCompanyName] = useState('');
   const [companyNameError, setCompanyNameError] = useState<string | null>(null);
   const [checkingCompanyName, setCheckingCompanyName] = useState(false);
   const [companyNameAvailable, setCompanyNameAvailable] = useState(false);
   ```

3. **Real-time validation effect**:
   ```typescript
   useEffect(() => {
     // As user types, validate company name
     // Shows "Checking..." indicator
     // Displays âœ“ when available
     // Shows error message when taken
   }, [companyName])
   ```

4. **Step flow**:
   ```
   company (NEW) â†’ phone â†’ otp â†’ done
   Step 1 of 3 â†’ Step 2 of 3 â†’ Almost thereâ€¦ â†’ Done
   ```

5. **Company name form UI**:
   - Input field with real-time feedback
   - Checkmark icon when available
   - Error message when taken
   - Button disabled until name is available
   - Continue â†’ Phone verification

6. **Pass company name to API**:
   ```typescript
   const resp = await fetch('/api/onboarding/complete', {
     method: 'POST',
     body: JSON.stringify({
       phoneNumber,
       companyName: companyName.trim(),  // NEW
       intentGoals,
       intentTeam,
       intentChallenges,
     }),
   });
   ```

---

#### `/pages/api/onboarding/complete.ts`
**Changes**:
1. **Validate company name input**:
   ```typescript
   if (!companyName || companyName.trim().length < 2) {
     return res.status(400).json({ 
       error: 'Company name is required and must be at least 2 characters' 
     });
   }
   ```

2. **New Step 0: Create or retrieve company**:
   ```typescript
   // Check if company exists (case-insensitive)
   const { data: existingCompanies } = await supabase
     .from('companies')
     .select('id')
     .ilike('name', trimmedCompanyName)
     .limit(1);

   // If exists: use it
   // If not: create new company
   if (existingCompanies.length === 0) {
     const { data: newCompany } = await supabase
       .from('companies')
       .insert({ name: trimmedCompanyName })
       .select('id')
       .single();
     companyId = newCompany.id;
   }
   ```

3. **Store company name in free_credit_profiles**:
   ```typescript
   await supabase.from('free_credit_profiles').insert({
     user_id: user.id,
     phone_number: phoneNumber,
     company_name: trimmedCompanyName,  // NEW
     organization_id: companyId,        // NEW
     // ... rest of fields
   });
   ```

4. **Create user_company_roles if missing**:
   ```typescript
   // Auto-assign user to their new company
   const { error: roleErr } = await supabase
     .from('user_company_roles')
     .insert({
       user_id: user.id,
       company_id: companyId,
       role: 'COMPANY_ADMIN',
       status: 'active',
     });
   ```

---

## 3. Data Flow

### Free Credits Signup Flow (Updated)

```
User starts signup
  â†“
/create-account
  â†’ Email validation
  â†’ Send magic link
  â†“
Click magic link â†’ /auth/callback
  â†’ PKCE code exchange
  â†’ Redirect to /onboarding/phone
  â†“
[NEW STEP] Company name entry
  â†’ User enters "Acme Corp"
  â†’ Real-time validation: "Checking..."
  â†’ âœ“ Available
  â†’ Click Continue
  â†“
Phone verification
  â†’ Enter phone number
  â†’ Get SMS OTP
  â†’ Enter 6-digit code
  â†“
Call /api/onboarding/complete
  â†’ âœ“ Validate company name (must exist)
  â†’ Create company if not exists
  â†’ Create free_credit_profiles
  â†’ Create user_company_roles
  â†’ Grant 300 credits to organization
  â†’ Log claim
  â†“
Success page
  â†’ Show 300 credits claimed
  â†’ Show ways to earn more
  â†’ Continue to dashboard
```

### Database Changes

**companies table**:
- New row created when user signs up with new company name
- Name is unique (case-insensitive)

**free_credit_profiles**:
- New field: `company_name` (string)
- Updated: `organization_id` (now always set)

**user_company_roles**:
- New row created for user
- Role: `COMPANY_ADMIN`
- Status: `active`

**Example after signup**:
```
companies {
  id: "company-123",
  name: "Acme Corp"
}

users {
  id: "user-456",
  email: "john@example.com"
}

user_company_roles {
  user_id: "user-456",
  company_id: "company-123",
  role: "COMPANY_ADMIN",
  status: "active"
}

free_credit_profiles {
  user_id: "user-456",
  organization_id: "company-123",
  company_name: "Acme Corp",
  phone_number: "+44...",
  initial_credits: 300
}
```

---

## 4. API Changes Summary

### New Endpoints
- `POST /api/onboarding/validate-company-name` â€” Check company name availability

### Modified Endpoints
- `DELETE /api/super-admin/users` â€” Now handles unassigned users
- `POST /api/onboarding/complete` â€” Now requires + validates company name

### Request/Response Changes

**DELETE unassigned user** (NEW):
```
POST /api/super-admin/users
Content-Type: application/json

{
  "userId": "uuid-of-user"
  // companyId NOT provided
}

Response:
{
  "success": true,
  "message": "Unassigned user deleted from system"
}
```

**Validate company name** (NEW):
```
POST /api/onboarding/validate-company-name
Content-Type: application/json

{
  "companyName": "Acme Corporation"
}

Response:
{
  "available": true
}
```

**Onboarding complete** (UPDATED):
```
POST /api/onboarding/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "phoneNumber": "+44...",
  "companyName": "Acme Corp",  // NEW - REQUIRED
  "intentGoals": [],
  "intentTeam": "",
  "intentChallenges": []
}

Response:
{
  "success": true,
  "credits": 300,
  "expiresAt": "2026-04-04T...",
  "alreadyClaimed": false
}
```

---

## 5. Testing Scenarios

### Scenario 1: Delete Unassigned User
```
Setup:
- User "support@drishiq.com" in users table
- No company_roles entry (UNASSIGNED status)

Test:
POST /api/super-admin/users
Body: { userId: "user-id" }

Expected:
- User deleted from users table
- User deleted from auth
- Response: 200 { success, message }
```

### Scenario 2: Company Name Uniqueness
```
Scenario A: New company name
User enters: "TechStartup Inc"
Validate: Available âœ“
Create company: YES
Company created in database

Scenario B: Existing company name (different case)
User 1 creates: "Acme Corp"
User 2 enters: "acme corp"
Validate: Not available (case-insensitive match)
Create company: NO
Uses existing company
```

### Scenario 3: Free Credits Signup with Company
```
1. Email: john@company.com â†’ Magic link
2. Company: "Acme Corp" â†’ Validation âœ“
3. Phone: +44 7911 123456 â†’ SMS OTP
4. Verify: 123456 â†’ Success
5. Result:
   - User created in Supabase Auth
   - Company "Acme Corp" created
   - User attached to company as COMPANY_ADMIN
   - 300 credits granted to organization
   - Redirect to earnings (claim more credits)
```

---

## 6. Configuration

### Environment Variables
No new env vars required. Uses existing:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Database Requirements
```
companies table:
  - id (UUID, primary key)
  - name (TEXT, NOT NULL, UNIQUE)
  - created_at (TIMESTAMP)
  - updated_at (TIMESTAMP)

free_credit_profiles:
  - company_name (TEXT) â€” NEW FIELD
  - organization_id (UUID) â€” ENSURE NOT NULL

user_company_roles:
  - Already exists, no changes needed
```

---

## 7. Known Limitations & Future Enhancements

### Current Limitations
- Company name uniqueness is case-insensitive (by design)
- Cannot change company name after signup (requires company edit feature)
- Super admin cannot assign existing company to new user during signup

### Future Enhancements
1. Allow super admin to select existing company during user invite
2. Company name editing with conflict resolution
3. Company logo/branding during signup
4. Company verification (domain check, business registration)
5. Multi-company support for users

---

## 8. Support & Troubleshooting

### User deletion not showing in UI
â†’ Refresh the page or clear browser cache
â†’ Check that both users table and auth deletion completed

### Company name validation timeout
â†’ Check that `/api/onboarding/validate-company-name` is accessible
â†’ Verify Supabase is responding (check network tab)

### User cannot proceed past company name
â†’ Ensure company name is at least 2 characters
â†’ Try a different company name (may already be taken)
â†’ Check for typos or special characters

### Credits not granted
â†’ Check that organization_id is set in free_credit_profiles
â†’ Verify user_company_roles entry exists
â†’ Check RPC `apply_credit_transaction` permissions

