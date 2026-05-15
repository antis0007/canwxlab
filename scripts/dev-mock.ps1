$env:CANWXLAB_DATA_MODE = "mock"
$env:CANWXLAB_ENABLE_LIVE_ECCC = "false"

Write-Host "Starting CanWxLab in Stable Mock mode..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "dev.ps1")
