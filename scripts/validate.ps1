$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pythonExe = Join-Path $repoRoot "services/api/.venv/Scripts/python.exe"

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Script
  )
  Write-Host "`n==> $Name"
  & $Script
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

  Write-Host "`nValidation completed successfully."
} finally {
  Pop-Location
}
