$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pythonExe = Join-Path $repoRoot "services/api/.venv/Scripts/python.exe"

# Check prerequisites
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo is missing. Please install Rust and cargo."
    exit 1
}
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    Write-Error "corepack is missing. Please install Node.js and enable corepack."
    exit 1
}
if (-not (Test-Path $pythonExe)) {
    Write-Error "Python venv is missing at $pythonExe. Please setup the API venv."
    exit 1
}

$script:FailedSteps = @()

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Script
  )
  Write-Host "`n==> $Name"
  
  $originalErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  
  try {
    & $Script
    $exitCode = $LASTEXITCODE
  } catch {
    $exitCode = 1
    Write-Error $_
  } finally {
    $ErrorActionPreference = $originalErrorActionPreference
  }
  
  if ($exitCode -ne 0 -and $exitCode -ne $null) {
    Write-Host "[FAIL] $Name" -ForegroundColor Red
    $script:FailedSteps += $Name
  } else {
    Write-Host "[PASS] $Name" -ForegroundColor Green
  }
  
  # Reset LASTEXITCODE
  $global:LASTEXITCODE = 0
}

Push-Location $repoRoot
try {
  Invoke-Step "cargo fmt --check" { cargo fmt --check }
  Invoke-Step "cargo clippy --workspace -- -D warnings" { cargo clippy --workspace -- -D warnings }
  Invoke-Step "cargo test" { cargo test }

  Invoke-Step "ruff check services/api" { & $pythonExe -m ruff check services/api }
  Invoke-Step "pytest services/api/tests -q" { & $pythonExe -m pytest services/api/tests -q }

  Invoke-Step "pnpm web test" { corepack pnpm --filter @canwxlab/web test }
  Invoke-Step "pnpm web build" { corepack pnpm --filter @canwxlab/web build }
  Invoke-Step "pnpm web lint" { corepack pnpm --filter @canwxlab/web lint }

  Write-Host "`nValidation Summary:"
  if ($script:FailedSteps.Count -eq 0) {
    Write-Host "All validation steps passed successfully." -ForegroundColor Green
  } else {
    Write-Host "The following steps failed:" -ForegroundColor Red
    foreach ($step in $script:FailedSteps) {
      Write-Host " - $step" -ForegroundColor Red
    }
    exit 1
  }
} finally {
  Pop-Location
}
