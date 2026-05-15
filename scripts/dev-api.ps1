param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pythonExe = Join-Path $repoRoot "services/api/.venv/Scripts/python.exe"

if (-not (Test-Path $pythonExe)) {
  Write-Error "Missing API virtualenv python: $pythonExe. Create it first with 'python -m venv services/api/.venv' and install deps."
}

try {
  $existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  if ($existing) {
    $proc = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "PID $($existing.OwningProcess)" }
    Write-Host "API port $Port already in use by $name."
    exit 0
  }
} catch {
}

Push-Location $repoRoot
try {
  Write-Host "Starting API on http://127.0.0.1:$Port"
  & $pythonExe -m uvicorn canwxlab_api.main:app --host 127.0.0.1 --port $Port --reload --app-dir services/api
} finally {
  Pop-Location
}
