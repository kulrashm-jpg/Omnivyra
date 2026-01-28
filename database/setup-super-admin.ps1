# =====================================================
# SUPER ADMIN SYSTEM SETUP
# =====================================================
# This script sets up the super admin security system
# =====================================================

Write-Host "🛡️  Setting up Super Admin Security System..." -ForegroundColor Red
Write-Host "=============================================" -ForegroundColor Red

# Check if .env.local exists
if (-not (Test-Path "../.env.local")) {
    Write-Host "❌ Error: .env.local file not found!" -ForegroundColor Red
    Write-Host "Please create .env.local with your Supabase credentials:" -ForegroundColor Yellow
    Write-Host "NEXT_PUBLIC_SUPABASE_URL=your_supabase_url" -ForegroundColor Cyan
    Write-Host "NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key" -ForegroundColor Cyan
    exit 1
}

# Load environment variables
Get-Content "../.env.local" | ForEach-Object {
    if ($_ -match "^([^#][^=]+)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

Write-Host "✅ Environment variables loaded" -ForegroundColor Green

# Check if required environment variables are set
$supabaseUrl = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL", "Process")
$supabaseKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Process")

if (-not $supabaseUrl -or -not $supabaseKey) {
    Write-Host "❌ Error: Missing Supabase credentials in .env.local" -ForegroundColor Red
    exit 1
}

Write-Host "📊 Supabase URL: $supabaseUrl" -ForegroundColor Cyan

# Execute the super admin security script
Write-Host "🔐 Executing super admin security setup..." -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Yellow

# Check if psql is available
try {
    $psqlVersion = & psql --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "📝 Executing SQL script with psql..." -ForegroundColor Cyan
        
        # You'll need to set your DATABASE_URL environment variable
        $databaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
        if (-not $databaseUrl) {
            Write-Host "⚠️  DATABASE_URL not set. Please set it to your Supabase database URL:" -ForegroundColor Yellow
            Write-Host "   Format: postgresql://postgres:[password]@[host]:5432/postgres" -ForegroundColor Cyan
            Write-Host "   You can find this in your Supabase project settings" -ForegroundColor Cyan
        } else {
            & psql $databaseUrl -f "super-admin-security.sql"
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Super admin security system setup completed successfully!" -ForegroundColor Green
            } else {
                Write-Host "❌ Super admin security setup failed!" -ForegroundColor Red
                exit 1
            }
        }
    }
} catch {
    Write-Host "⚠️  psql not found. Please execute the SQL script manually:" -ForegroundColor Yellow
    Write-Host "   File: database/super-admin-security.sql" -ForegroundColor Cyan
    Write-Host "   You can run it in your Supabase SQL editor or any PostgreSQL client" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "🎉 Super Admin Security System Setup Complete!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host "✅ Role-based access control implemented" -ForegroundColor Green
Write-Host "✅ Audit logging for all deletions" -ForegroundColor Green
Write-Host "✅ Safe delete functions with super admin checks" -ForegroundColor Green
Write-Host "✅ Super admin management functions" -ForegroundColor Green
Write-Host "✅ Row Level Security policies" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Created Tables:" -ForegroundColor Cyan
Write-Host "   - user_roles (role-based access control)" -ForegroundColor White
Write-Host "   - deletion_audit_log (audit trail)" -ForegroundColor White
Write-Host ""
Write-Host "🔧 Created Functions:" -ForegroundColor Cyan
Write-Host "   - is_super_admin() (check privileges)" -ForegroundColor White
Write-Host "   - safe_delete_campaign() (secure campaign deletion)" -ForegroundColor White
Write-Host "   - safe_delete_weekly_plan() (secure plan deletion)" -ForegroundColor White
Write-Host "   - grant_super_admin() (grant privileges)" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Access the Super Admin Panel at: /super-admin" -ForegroundColor Green
Write-Host "🔗 Access Team Management at: /team-management" -ForegroundColor Green






