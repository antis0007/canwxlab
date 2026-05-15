$ErrorActionPreference = "Continue"

$endpoints = @(
  @{ Name = "Health"; Url = "http://127.0.0.1:8787/health" },
  @{ Name = "Sources Status"; Url = "http://127.0.0.1:8787/api/sources/status" },
  @{ Name = "Layers"; Url = "http://127.0.0.1:8787/api/layers" },
  @{ Name = "Plugins"; Url = "http://127.0.0.1:8787/api/plugins" },
  @{ Name = "WMS Capabilities Summary"; Url = "http://127.0.0.1:8787/api/eccc/wms/capabilities-summary" },
  @{ Name = "WMS Layers"; Url = "http://127.0.0.1:8787/api/eccc/wms/layers" },
  @{ Name = "Verification Summary"; Url = "http://127.0.0.1:8787/api/verification/summary" },
  @{ Name = "Simulation Runs"; Url = "http://127.0.0.1:8787/api/simulations/runs" }
)

Write-Host "`nChecking API Endpoints..." -ForegroundColor Cyan

$allPassed = $true

foreach ($ep in $endpoints) {
  try {
    $response = Invoke-WebRequest -Uri $ep.Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
      Write-Host "[PASS] $($ep.Name) ($($ep.Url))" -ForegroundColor Green
    } else {
      Write-Host "[FAIL] $($ep.Name) ($($ep.Url)) - Status $($response.StatusCode)" -ForegroundColor Red
      $allPassed = $false
    }
  } catch {
    Write-Host "[FAIL] $($ep.Name) ($($ep.Url)) - $($_.Exception.Message)" -ForegroundColor Red
    $allPassed = $false
  }
}

Write-Host ""
if ($allPassed) {
  Write-Host "All endpoints passed!" -ForegroundColor Green
} else {
  Write-Host "Some endpoints failed." -ForegroundColor Red
}
