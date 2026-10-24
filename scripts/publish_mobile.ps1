param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskOutput = Join-Path $taskRoot '.artifacts/mobile-pages'
$taskPython = Join-Path $taskRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { $taskPython = 'python' }
& $taskPython (Join-Path $taskRoot 'scripts/mobile_release.py')
if ($LASTEXITCODE -ne 0) { throw 'Mobile release verification failed; refusing deployment.' }
if (-not $env:CLOUDFLARE_API_TOKEN -or -not $env:CLOUDFLARE_ACCOUNT_ID) { throw 'Cloudflare deployment credentials are required.' }
$taskLogs = Join-Path $taskRoot '.artifacts/mobile-deploy'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$env:WRANGLER_LOG_PATH = Join-Path $taskLogs 'wrangler.log'
$env:WRANGLER_SEND_METRICS = 'false'
$env:npm_config_cache = Join-Path $taskRoot '.artifacts/npm-cache'
Push-Location $taskRoot
try {
    & npx --yes wrangler@4.152.0 pages deploy $taskOutput --project-name kyalulu-mobile --branch main --commit-dirty=true
    if ($LASTEXITCODE -ne 0) { throw 'Mobile deployment failed.' }
} finally { Pop-Location }
