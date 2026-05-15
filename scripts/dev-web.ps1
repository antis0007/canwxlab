param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodeModules = Join-Path $repoRoot "node_modules"

if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  Write-Error "corepack is unavailable. Please install Node.js and enable corepack."
  exit 1
}

if (-not (Test-Path $nodeModules)) {
  Write-Error "Missing node_modules at repo root. Run 'corepack pnpm install' first."
  exit 1
}

try {
  $existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  if ($existing) {
    $proc = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "PID $($existing.OwningProcess)" }
    Write-Host "Web port $Port already in use by $name."
    exit 0
  }
} catch {
}

Push-Location $repoRoot
try {
  Write-Host "Starting web UI on http://127.0.0.1:$Port"
  & corepack pnpm --filter @canwxlab/web dev --host 127.0.0.1 --port $Port
} finally {
  Pop-Location
}
