param(
    [Parameter(Mandatory = $true)]
    [string]$RelayOrigin
)

$ErrorActionPreference = 'Stop'
# This script builds local artifacts only. It never signs in or deploys.
if ($RelayOrigin -cnotmatch '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$') {
    throw 'RelayOrigin must be an HTTPS DNS origin without path, port, credentials or trailing slash.'
}
$relayUri = [Uri]$RelayOrigin
if ($relayUri.HostNameType -ne [UriHostNameType]::Dns -or $relayUri.Host -notmatch '\.' -or $relayUri.Host.EndsWith('.local')) {
    throw 'Use the public Relay DNS name.'
}
$projectRoot = Split-Path $PSScriptRoot -Parent
$outputDir = Join-Path $projectRoot '.artifacts/cloudflare-pages'
$oldOrigin = $env:VITE_RELAY_ORIGIN
Push-Location $projectRoot
try {
    $env:VITE_RELAY_ORIGIN = $RelayOrigin
    & pnpm --filter web exec node node_modules/typescript/bin/tsc -b
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    & pnpm --filter web exec node node_modules/vite/bin/vite.js build --outDir $outputDir --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw 'PWA build failed.' }

    # Share the reviewed policy with the Caddy deployment; never add third-party scripts.
    $caddy = Get-Content (Join-Path $projectRoot 'deploy/remote/Caddyfile') -Raw
    $policyMatch = [regex]::Match($caddy, 'Content-Security-Policy "(default-src ''none''; script-src[^"\r\n]+)"')
    if (-not $policyMatch.Success) { throw 'Reviewed APP CSP not found.' }
    $policy = $policyMatch.Groups[1].Value.Replace('{$RELAY_DOMAIN}', $relayUri.Host)
    $headers = @"
/*
  Content-Security-Policy: $policy
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
  Cache-Control: no-cache
"@
    [IO.File]::WriteAllText((Join-Path $outputDir '_headers'), $headers + "`n", [Text.UTF8Encoding]::new($false))
    # Hash routing needs no SPA fallback. Missing /api paths must never become HTML.
    [IO.File]::WriteAllText((Join-Path $outputDir '404.html'), '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found</p>', [Text.UTF8Encoding]::new($false))
    $files = @(Get-ChildItem $outputDir -File -Recurse)
    if ($files.Count -gt 20000 -or @($files | Where-Object Length -gt 25MB).Count) {
        throw 'Cloudflare Pages Free asset limits exceeded.'
    }
    $unsafeFiles = @($files | Where-Object { $_.Name -match '^\.env|\.(pem|key|vault|sqlite3?|db|map)$' })
    if ($unsafeFiles.Count) { throw 'Unexpected private/debug artifact in output. Do not upload.' }
    Write-Output "Prepared only: $outputDir"
    Write-Output "Relay origin: $RelayOrigin"
    Write-Output 'No Cloudflare resources were created or deployed.'
} finally {
    $env:VITE_RELAY_ORIGIN = $oldOrigin
    Pop-Location
}
