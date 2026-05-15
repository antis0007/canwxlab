$env:CANWXLAB_DATA_MODE = "hybrid"
$env:CANWXLAB_ENABLE_LIVE_ECCC = "true"
$env:CANWXLAB_ECCC_OGC_API_BASE = "https://api.weather.gc.ca"
$env:CANWXLAB_ECCC_WMS_BASE = "https://geo.weather.gc.ca/geomet"

Write-Host "Starting CanWxLab in Hybrid Live mode..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "dev.ps1")
