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
    Write-Host "Using existing web UI at http://127.0.0.1:$Port"
    exit 0
  }
} catch {
}
$line = netstat -ano -p tcp | Select-String -Pattern "LISTENING" | Where-Object {
  $_.Line -match "[:.]$Port\s+.*LISTENING\s+(\d+)\s*$"
} | Select-Object -First 1
if ($line -and $line.Line -match "(\d+)\s*$") {
  $listenerPid = [int]$Matches[1]
  $proc = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
  $name = if ($proc) { "$($proc.ProcessName) PID $listenerPid" } else { "PID $listenerPid" }
  Write-Host "Web port $Port already in use by $name."
  Write-Host "Using existing web UI at http://127.0.0.1:$Port"
  exit 0
}

Push-Location $repoRoot
try {
  Write-Host "Starting web UI on http://127.0.0.1:$Port"
  & corepack pnpm --filter @canwxlab/web dev --host 127.0.0.1 --port $Port
} finally {
  Pop-Location
}
