# Remove [campaignId] directory
$path = "pages\api\campaigns\[campaignId]"
if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
    Write-Host "✅ Removed $path"
} else {
    Write-Host "Directory not found"
}

