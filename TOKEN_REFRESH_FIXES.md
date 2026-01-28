# 🔧 Token Refresh Fixes & Troubleshooting Guide

## Issues Fixed

### 1. **Improved Error Handling**
- ✅ Added detailed error logging with platform-specific error codes
- ✅ Better handling of invalid/expired refresh tokens
- ✅ Clear error messages for missing credentials

### 2. **Enhanced LinkedIn Refresh**
- ✅ Added credential validation
- ✅ Better handling of LinkedIn's token response format
- ✅ Default expiration time (60 days) if not provided

### 3. **Twitter/X Support**
- ✅ Added support for both `TWITTER_*` and `X_*` env vars
- ✅ Better error detection for invalid tokens

### 4. **Facebook Refresh Improvements**
- ✅ Alternative refresh path using refresh_token
- ✅ Better handling of token exchange failures

### 5. **YouTube Error Detection**
- ✅ Detects `invalid_grant` errors (expired refresh tokens)
- ✅ Better logging for debugging

### 6. **Testing Script**
- ✅ Created `scripts/test-token-refresh.js` for debugging

---

## Common Issues & Solutions

### Issue 1: "No refresh token available"

**Problem:** Account doesn't have a refresh token stored.

**Solutions:**
1. **Check OAuth Callback:**
   - Ensure OAuth callbacks save refresh tokens to database
   - Use `tokenStore.setToken()` in callback handlers

2. **Reconnect Account:**
   - User needs to reconnect via OAuth
   - Make sure OAuth flow requests refresh_token scope

3. **Check Database:**
   ```sql
   SELECT id, platform, refresh_token IS NOT NULL as has_refresh_token
   FROM social_accounts
   WHERE platform = 'linkedin';
   ```

### Issue 2: "Token refresh failed"

**Problem:** Refresh token is invalid or expired.

**Solutions:**
1. **Check Environment Variables:**
   ```bash
   # LinkedIn
   echo $LINKEDIN_CLIENT_ID
   echo $LINKEDIN_CLIENT_SECRET
   
   # Twitter
   echo $TWITTER_CLIENT_ID
   echo $TWITTER_CLIENT_SECRET
   
   # Facebook
   echo $FACEBOOK_APP_ID
   echo $FACEBOOK_APP_SECRET
   
   # YouTube
   echo $YOUTUBE_CLIENT_ID
   echo $YOUTUBE_CLIENT_SECRET
   ```

2. **Test Refresh Manually:**
   ```bash
   node scripts/test-token-refresh.js linkedin [account_id]
   ```

3. **Reconnect Account:**
   - If refresh token is expired/invalid, user must reconnect

### Issue 3: "Credentials not configured"

**Problem:** Missing environment variables.

**Solutions:**
1. **Add to `.env.local`:**
   ```env
   LINKEDIN_CLIENT_ID=your_client_id
   LINKEDIN_CLIENT_SECRET=your_client_secret
   TWITTER_CLIENT_ID=your_client_id
   TWITTER_CLIENT_SECRET=your_client_secret
   # ... etc
   ```

2. **Verify in code:**
   - Check that env vars are loaded
   - Use `process.env.VAR_NAME` to verify

### Issue 4: "Token expires_at not set"

**Problem:** Token expiration not tracked in database.

**Solutions:**
1. **Fix OAuth Callbacks:**
   - Ensure callbacks set `token_expires_at` when saving tokens
   - Calculate expiration from `expires_in` (seconds)

2. **Update Existing Tokens:**
   ```sql
   -- Set default expiration for tokens without expires_at
   UPDATE social_accounts
   SET token_expires_at = NOW() + INTERVAL '60 days'
   WHERE token_expires_at IS NULL;
   ```

### Issue 5: "Refresh works but token not saved"

**Problem:** Token refresh succeeds but new token not persisted.

**Solutions:**
1. **Check `setToken()` function:**
   - Verify encryption is working
   - Check database update succeeds

2. **Verify Database Permissions:**
   - Ensure service role key has UPDATE permissions
   - Check RLS policies if enabled

---

## Testing Token Refresh

### Manual Test:
```bash
node scripts/test-token-refresh.js linkedin [account_id]
```

### Check Token Status:
```sql
SELECT 
  id,
  platform,
  account_name,
  token_expires_at,
  token_expires_at < NOW() as is_expired,
  token_expires_at < NOW() + INTERVAL '5 minutes' as expiring_soon,
  refresh_token IS NOT NULL as has_refresh_token
FROM social_accounts
WHERE platform = 'linkedin';
```

### Test in Code:
```typescript
import { getToken } from '../auth/tokenStore';
import { refreshPlatformToken, isTokenExpiringSoon } from '../auth/tokenRefresh';

const token = await getToken(accountId);
if (token && isTokenExpiringSoon(token, 5)) {
  const refreshed = await refreshPlatformToken('linkedin', accountId, token);
  console.log('Refreshed:', refreshed ? 'Success' : 'Failed');
}
```

---

## Platform-Specific Notes

### LinkedIn
- Refresh tokens may not be returned (keep existing)
- Default expiration: 60 days
- Endpoint: `https://www.linkedin.com/oauth/v2/accessToken`

### Twitter/X
- Returns new refresh token on refresh
- Uses Basic Auth with client credentials
- Endpoint: `https://api.twitter.com/2/oauth2/token`

### Facebook
- Uses token exchange (not traditional refresh)
- Long-lived tokens (~60 days)
- Endpoint: `https://graph.facebook.com/v18.0/oauth/access_token`

### Instagram
- Uses Facebook token refresh
- Same as Facebook

### YouTube
- Google OAuth 2.0 standard
- Refresh tokens don't expire
- Endpoint: `https://oauth2.googleapis.com/token`

---

## Debug Checklist

- [ ] Environment variables set correctly
- [ ] OAuth callbacks save refresh tokens
- [ ] `token_expires_at` is set in database
- [ ] Refresh token exists in database
- [ ] Token encryption/decryption working
- [ ] Platform API credentials valid
- [ ] Network connectivity to platform APIs
- [ ] Test script runs successfully

---

## Next Steps

1. **Fix OAuth Callbacks:**
   - Update callbacks to use `tokenStore.setToken()`
   - Ensure refresh tokens are saved

2. **Test Each Platform:**
   - Use test script for each platform
   - Verify refresh works before production

3. **Monitor in Production:**
   - Log token refresh attempts
   - Alert on refresh failures
   - Track token expiration rates

---

**All fixes applied! Use the test script to verify token refresh is working.** ✅

