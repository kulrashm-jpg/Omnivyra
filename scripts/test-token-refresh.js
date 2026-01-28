/**
 * Test Token Refresh
 * 
 * Script to test token refresh functionality for debugging
 * 
 * Usage: node scripts/test-token-refresh.js [platform] [account_id]
 */

require('dotenv').config({ path: '.env.local' });

const { getToken } = require('../backend/auth/tokenStore');
const { refreshPlatformToken, isTokenExpiringSoon } = require('../backend/auth/tokenRefresh');

async function testTokenRefresh(platform, accountId) {
  console.log(`\n🧪 Testing token refresh for ${platform} (account: ${accountId})\n`);

  try {
    // Get current token
    console.log('1️⃣ Getting current token...');
    const token = await getToken(accountId);

    if (!token) {
      console.error('❌ No token found for this account');
      console.log('\n💡 Make sure:');
      console.log('   - Account is connected via OAuth');
      console.log('   - Token is stored in social_accounts table');
      console.log('   - account_id is correct');
      return;
    }

    console.log('✅ Token found');
    console.log(`   - Has access_token: ${!!token.access_token}`);
    console.log(`   - Has refresh_token: ${!!token.refresh_token}`);
    console.log(`   - Expires at: ${token.expires_at || 'Not set'}`);

    // Check if expiring soon
    if (token.expires_at) {
      const expiringSoon = isTokenExpiringSoon(token, 5);
      console.log(`   - Expiring soon (< 5 min): ${expiringSoon}`);
    }

    if (!token.refresh_token) {
      console.error('\n❌ No refresh token available!');
      console.log('\n💡 This account needs to be reconnected to get a refresh token.');
      return;
    }

    // Test refresh
    console.log('\n2️⃣ Attempting token refresh...');
    const refreshed = await refreshPlatformToken(platform, accountId, token);

    if (refreshed) {
      console.log('\n✅ Token refresh successful!');
      console.log(`   - New access_token: ${refreshed.access_token.substring(0, 20)}...`);
      console.log(`   - New expires_at: ${refreshed.expires_at}`);
      console.log(`   - Has refresh_token: ${!!refreshed.refresh_token}`);
    } else {
      console.log('\n❌ Token refresh failed');
      console.log('\n💡 Common issues:');
      console.log('   - Refresh token expired or invalid');
      console.log('   - Environment variables not set (CLIENT_ID, CLIENT_SECRET)');
      console.log('   - Platform API credentials incorrect');
      console.log('   - Network/API error');
      console.log('\n   Try reconnecting the account via OAuth.');
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  }
}

// Main
const platform = process.argv[2];
const accountId = process.argv[3];

if (!platform || !accountId) {
  console.log('Usage: node scripts/test-token-refresh.js [platform] [account_id]');
  console.log('\nExample:');
  console.log('  node scripts/test-token-refresh.js linkedin abc123-def456-...');
  console.log('  node scripts/test-token-refresh.js twitter abc123-def456-...');
  console.log('\nPlatforms: linkedin, twitter, x, facebook, instagram, youtube, spotify');
  process.exit(1);
}

testTokenRefresh(platform, accountId)
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });

